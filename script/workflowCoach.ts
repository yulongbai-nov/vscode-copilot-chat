/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { evaluateWorkflow, inferWorkType, type CoachResult, type WorkflowContext } from './workflowCoachCore.ts';

type CliArgs = {
	query?: string;
	type?: string;
	json?: boolean;
	'no-gh'?: boolean;
	help?: boolean;
};

function main() {
	const args = parseCliArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const git = collectGitState();
	const workType = inferWorkType(args.query, args.type);
	const gh = args['no-gh'] ? { hasAuth: false } : collectGitHubState(git.branch);

	const context: WorkflowContext = {
		query: args.query,
		workType,
		git,
		gh,
	};

	const result = evaluateWorkflow(context, { defaultBranch: 'main' });
	if (args.json) {
		process.stdout.write(`${JSON.stringify({ context, result }, null, 2)}\n`);
		return;
	}

	renderText(context, result);
}

function parseCliArgs(argv: string[]): CliArgs {
	const { values } = parseArgs({
		args: argv,
		options: {
			query: { type: 'string' },
			type: { type: 'string' },
			json: { type: 'boolean' },
			'no-gh': { type: 'boolean' },
			help: { type: 'boolean' },
		},
		allowPositionals: false,
	});

	return values as CliArgs;
}

function printHelp() {
	process.stdout.write(`Workflow Coach (advisory)

Usage:
  node --experimental-strip-types script/workflowCoach.ts --query "..." [--type fix] [--json] [--no-gh]
  npm run workflow:coach -- --query "..."

Options:
  --query   Current user request (advisory)
  --type    Explicit work type: feature|fix|docs|ci|chore|refactor|test|perf
  --no-gh   Skip GitHub PR lookup (faster/offline)
  --json    Emit machine-readable JSON
  --help    Show this help
`);
}

function collectGitState(): WorkflowContext['git'] {
	const repoRoot = execGit(['rev-parse', '--show-toplevel']);
	if (!repoRoot) {
		process.stderr.write('workflow-coach: not a git repository\n');
		process.exit(2);
	}

	const status = execGit(['status', '-sb', '--porcelain=v1']);
	const lines = status.split(/\r?\n/).filter(Boolean);
	const header = lines[0] ?? '## (unknown)';
	const parsed = parseStatusHeader(header);

	const fileLines = lines.slice(1);
	const { stagedFiles, unstagedFiles, untrackedFiles, changedPaths } = parseStatusFiles(fileLines);

	return {
		branch: parsed.branch,
		isMainBranch: parsed.branch === 'main',
		upstream: parsed.upstream,
		stagedFiles,
		unstagedFiles,
		untrackedFiles,
		ahead: parsed.ahead,
		behind: parsed.behind,
		changedPaths,
	};
}

function parseStatusHeader(line: string): { branch: string; upstream?: string; ahead: number; behind: number } {
	// Examples:
	// ## main...origin/main [ahead 1, behind 2]
	// ## feature/foo...origin/feature/foo [ahead 1]
	// ## HEAD (no branch)
	const cleaned = line.startsWith('## ') ? line.slice(3) : line;
	const match = /^([^\s.]+)(?:\.\.\.([^\s]+))?(?:\s+\[(.+)\])?$/.exec(cleaned);
	if (!match) {
		return { branch: cleaned.split(/\s+/)[0] ?? 'unknown', ahead: 0, behind: 0 };
	}

	const branch = match[1] ?? 'unknown';
	const upstream = match[2];
	const trailer = match[3] ?? '';

	let ahead = 0;
	let behind = 0;
	for (const part of trailer.split(',').map(s => s.trim()).filter(Boolean)) {
		const aheadMatch = /^ahead\s+(\d+)$/.exec(part);
		if (aheadMatch) {
			ahead = Number(aheadMatch[1]);
			continue;
		}
		const behindMatch = /^behind\s+(\d+)$/.exec(part);
		if (behindMatch) {
			behind = Number(behindMatch[1]);
		}
	}

	return { branch, upstream, ahead, behind };
}

function parseStatusFiles(lines: string[]): {
	stagedFiles: number;
	unstagedFiles: number;
	untrackedFiles: number;
	changedPaths: string[];
} {
	let stagedFiles = 0;
	let unstagedFiles = 0;
	let untrackedFiles = 0;
	const paths = new Set<string>();

	for (const rawLine of lines) {
		if (rawLine.length < 3) {
			continue;
		}

		const x = rawLine[0];
		const y = rawLine[1];
		const rest = rawLine.slice(3).trim();

		if (x === '?' && y === '?') {
			untrackedFiles += 1;
			if (rest) {
				paths.add(rest);
			}
			continue;
		}

		if (x !== ' ') {
			stagedFiles += 1;
		}
		if (y !== ' ') {
			unstagedFiles += 1;
		}

		for (const filePath of splitRenamePaths(rest)) {
			paths.add(filePath);
		}
	}

	return {
		stagedFiles,
		unstagedFiles,
		untrackedFiles,
		changedPaths: Array.from(paths.values()).sort(),
	};
}

function splitRenamePaths(rest: string): string[] {
	if (!rest) {
		return [];
	}
	const arrow = ' -> ';
	const arrowIndex = rest.indexOf(arrow);
	if (arrowIndex === -1) {
		return [rest];
	}
	return [rest.slice(0, arrowIndex).trim(), rest.slice(arrowIndex + arrow.length).trim()].filter(Boolean);
}

function collectGitHubState(branch: string): WorkflowContext['gh'] {
	if (!hasCommand('gh')) {
		return { hasAuth: false };
	}

	try {
		execFileSync('gh', ['auth', 'status', '-h', 'github.com'], { stdio: 'ignore' });
	} catch {
		return { hasAuth: false };
	}

	try {
		const output = execFileSync('gh', ['pr', 'view', '--json', 'number,url'], { encoding: 'utf8' }).trim();
		const parsed = JSON.parse(output) as { number?: number; url?: string };
		return {
			hasAuth: true,
			prNumber: typeof parsed.number === 'number' ? parsed.number : undefined,
			prUrl: typeof parsed.url === 'string' ? parsed.url : undefined,
		};
	} catch {
		// No PR for current branch (or API error); keep best-effort behavior.
		return { hasAuth: true };
	}
}

function hasCommand(cmd: string): boolean {
	try {
		execFileSync(cmd, ['--version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

function execGit(args: string[]): string {
	try {
		return execFileSync('git', args, { encoding: 'utf8' }).trim();
	} catch {
		return '';
	}
}

function renderText(context: WorkflowContext, result: CoachResult) {
	const { git, gh, query, workType } = context;

	const lines: string[] = [];
	lines.push('Workflow Coach (advisory)');
	lines.push('');
	lines.push(`Branch: ${git.branch}${git.upstream ? ` (upstream: ${git.upstream})` : ''}`);
	lines.push(`Changes: staged ${git.stagedFiles} | unstaged ${git.unstagedFiles} | untracked ${git.untrackedFiles}`);
	if (git.upstream) {
		lines.push(`Upstream delta: ahead ${git.ahead} | behind ${git.behind}`);
	}
	if (typeof query === 'string' && query.trim()) {
		lines.push(`Query: ${JSON.stringify(query)}${workType ? ` (type: ${workType})` : ''}`);
	}
	if (gh) {
		if (!gh.hasAuth) {
			lines.push('PR: (skipped/unavailable)');
		} else if (gh.prUrl) {
			lines.push(`PR: ${gh.prUrl}`);
		} else {
			lines.push('PR: (none)');
		}
	}

	lines.push('');
	lines.push(`Detected state: ${result.detectedState}`);
	lines.push(`Suggested next state: ${result.suggestedNextState}`);

	if (result.warnings.length > 0) {
		lines.push('');
		lines.push('Warnings:');
		for (const warning of result.warnings) {
			lines.push(`- ${warning.title}`);
			lines.push(`  Why: ${warning.why}`);
			for (const cmd of warning.commands ?? []) {
				lines.push(`  ${cmd}`);
			}
		}
	}

	if (result.nextActions.length > 0) {
		lines.push('');
		lines.push('Next actions:');
		for (const action of result.nextActions) {
			lines.push(`- ${action.title}`);
			lines.push(`  Why: ${action.why}`);
			for (const cmd of action.commands ?? []) {
				lines.push(`  ${cmd}`);
			}
		}
	}

	process.stdout.write(`${lines.join('\n')}\n`);
}

main();
