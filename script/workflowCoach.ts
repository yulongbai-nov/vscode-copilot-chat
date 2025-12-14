/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

import { evaluateWorkflow, inferPhase, inferWorkType, type CoachResult, type Phase, type WorkType, type WorkflowContext } from './workflowCoachCore.ts';

type CliArgs = {
	query?: string;
	type?: string;
	json?: boolean;
	'no-gh'?: boolean;
	'no-persist'?: boolean;
	help?: boolean;
};

type PersistedBranchState = {
	lastRunAt?: string;
	lastWorkType?: WorkType;
	lastActiveSpec?: string;
	lastDetectedState?: string;
	lastPhase?: Phase;
};

type PersistedStateFile = {
	version: 1;
	branches: Record<string, PersistedBranchState>;
};

function main() {
	const args = parseCliArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const { repoRoot, gitCommonDir } = collectRepoPaths();
	const git = collectGitState();
	const workType = inferWorkType(args.query, args.type);
	const gh = args['no-gh'] ? { hasAuth: false } : collectGitHubState(git.branch);

	const previous = args['no-persist'] ? undefined : loadPersistedBranchState(gitCommonDir, git.branch);
	const spec = inferSpecContext(repoRoot, git, previous);

	const context: WorkflowContext = {
		query: args.query,
		workType,
		git,
		gh,
		previous,
		spec,
	};

	const phase = inferPhase(context);
	context.phase = phase;

	const result = evaluateWorkflow(context, { defaultBranch: 'main' });
	if (!args['no-persist']) {
		savePersistedBranchState(gitCommonDir, git.branch, {
			lastRunAt: new Date().toISOString(),
			lastWorkType: workType,
			lastActiveSpec: spec?.active,
			lastDetectedState: result.detectedState,
			lastPhase: phase,
		});
	}
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
			'no-persist': { type: 'boolean' },
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
  --no-persist  Skip reading/writing local per-branch metadata
  --json    Emit machine-readable JSON
  --help    Show this help
`);
}

function collectRepoPaths(): { repoRoot: string; gitCommonDir: string } {
	const repoRoot = execGit(['rev-parse', '--show-toplevel']);
	if (!repoRoot) {
		process.stderr.write('workflow-coach: not a git repository\n');
		process.exit(2);
	}

	const gitCommonDirRaw = execGit(['rev-parse', '--git-common-dir']);
	const gitCommonDir = resolvePath(repoRoot, gitCommonDirRaw || path.join(repoRoot, '.git'));

	return { repoRoot, gitCommonDir };
}

function resolvePath(baseDir: string, maybeRelativePath: string): string {
	if (!maybeRelativePath) {
		return baseDir;
	}
	if (path.isAbsolute(maybeRelativePath)) {
		return maybeRelativePath;
	}
	return path.resolve(baseDir, maybeRelativePath);
}

function collectGitState(): WorkflowContext['git'] {
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

function inferSpecContext(
	repoRoot: string,
	git: WorkflowContext['git'],
	previous: WorkflowContext['previous'] | undefined,
): WorkflowContext['spec'] | undefined {
	const inferredFromBranch = inferSpecFromBranch(git.branch);
	const inferredFromChanges = inferSpecFromChanges(git.changedPaths);
	const hasSpecChanges = git.changedPaths.some(p => p.startsWith('.specs/'));

	const active = inferredFromChanges ?? inferredFromBranch ?? previous?.lastActiveSpec;
	if (!active && !hasSpecChanges && !inferredFromBranch && !inferredFromChanges) {
		return undefined;
	}

	const hasRequiredDocs = active ? hasRequiredSpecDocs(repoRoot, active) : undefined;

	return {
		inferredFromBranch,
		inferredFromChanges,
		active,
		hasRequiredDocs,
		hasSpecChanges,
	};
}

function inferSpecFromBranch(branch: string): string | undefined {
	const parts = branch.split('/').filter(Boolean);
	if (parts.length < 2) {
		return undefined;
	}

	const type = inferWorkType(undefined, parts[0]);
	if (!type) {
		return undefined;
	}

	return parts[1];
}

function inferSpecFromChanges(changedPaths: readonly string[]): string | undefined {
	const names = new Set<string>();
	for (const changedPath of changedPaths) {
		if (!changedPath.startsWith('.specs/')) {
			continue;
		}
		const rest = changedPath.slice('.specs/'.length);
		const name = rest.split('/')[0];
		if (name) {
			names.add(name);
		}
	}

	if (names.size === 1) {
		return Array.from(names.values())[0];
	}
	return undefined;
}

function hasRequiredSpecDocs(repoRoot: string, specName: string): boolean {
	const specDir = path.join(repoRoot, '.specs', specName);
	return (
		existsSync(path.join(specDir, 'design.md')) &&
		existsSync(path.join(specDir, 'requirements.md')) &&
		existsSync(path.join(specDir, 'tasks.md'))
	);
}

function persistedStatePath(gitCommonDir: string): string {
	return path.join(gitCommonDir, 'workflow-coach', 'state.json');
}

function loadPersistedBranchState(gitCommonDir: string, branch: string): WorkflowContext['previous'] | undefined {
	const stateFilePath = persistedStatePath(gitCommonDir);
	if (!existsSync(stateFilePath)) {
		return undefined;
	}

	try {
		const contents = readFileSync(stateFilePath, 'utf8');
		const parsed = JSON.parse(contents) as Partial<PersistedStateFile>;
		if (parsed.version !== 1 || typeof parsed.branches !== 'object' || parsed.branches === null) {
			return undefined;
		}

		const stored = (parsed.branches as Record<string, PersistedBranchState>)[branch];
		if (!stored) {
			return undefined;
		}

		const rawWorkType = (stored as { lastWorkType?: unknown }).lastWorkType;
		const lastWorkType = typeof rawWorkType === 'string' ? inferWorkType(undefined, rawWorkType) : undefined;
		const rawPhase = (stored as { lastPhase?: unknown }).lastPhase;
		const lastPhase: Phase | undefined = rawPhase === 'design' || rawPhase === 'implementation' ? rawPhase : undefined;

		return {
			lastRunAt: typeof stored.lastRunAt === 'string' ? stored.lastRunAt : undefined,
			lastWorkType,
			lastActiveSpec: typeof stored.lastActiveSpec === 'string' ? stored.lastActiveSpec : undefined,
			lastDetectedState: typeof stored.lastDetectedState === 'string' ? stored.lastDetectedState : undefined,
			lastPhase,
		};
	} catch {
		return undefined;
	}
}

function savePersistedBranchState(gitCommonDir: string, branch: string, next: PersistedBranchState): void {
	try {
		const stateFilePath = persistedStatePath(gitCommonDir);
		const dir = path.dirname(stateFilePath);
		mkdirSync(dir, { recursive: true });

		const current = readPersistedStateFile(stateFilePath);
		const nextFile: PersistedStateFile = {
			version: 1,
			branches: {
				...current.branches,
				[branch]: {
					...current.branches[branch],
					...next,
				},
			},
		};

		writeFileAtomic(stateFilePath, `${JSON.stringify(nextFile, null, 2)}\n`);
	} catch {
		// Best-effort persistence; never fail the run.
	}
}

function readPersistedStateFile(stateFilePath: string): PersistedStateFile {
	if (!existsSync(stateFilePath)) {
		return { version: 1, branches: {} };
	}

	try {
		const contents = readFileSync(stateFilePath, 'utf8');
		const parsed = JSON.parse(contents) as Partial<PersistedStateFile>;
		if (parsed.version === 1 && typeof parsed.branches === 'object' && parsed.branches !== null) {
			return { version: 1, branches: parsed.branches as Record<string, PersistedBranchState> };
		}
	} catch {
		// Ignore malformed state.
	}
	return { version: 1, branches: {} };
}

function writeFileAtomic(filePath: string, contents: string): void {
	const tmpPath = `${filePath}.tmp-${process.pid}`;
	writeFileSync(tmpPath, contents, 'utf8');
	renameSync(tmpPath, filePath);
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
	if (context.previous?.lastRunAt) {
		const parts: string[] = [context.previous.lastRunAt];
		if (context.previous.lastDetectedState) {
			parts.push(`state: ${context.previous.lastDetectedState}`);
		}
		if (context.previous.lastActiveSpec) {
			parts.push(`spec: ${context.previous.lastActiveSpec}`);
		}
		if (context.previous.lastPhase) {
			parts.push(`phase: ${context.previous.lastPhase}`);
		}
		lines.push(`Previous: ${parts.join(' | ')}`);
	}
	if (git.upstream) {
		lines.push(`Upstream delta: ahead ${git.ahead} | behind ${git.behind}`);
	}
	if (context.phase) {
		lines.push(`Phase: ${context.phase}`);
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
	if (context.spec?.active) {
		const specParts: string[] = [];
		if (context.spec.inferredFromBranch) {
			specParts.push(`branch→${context.spec.inferredFromBranch}`);
		}
		if (context.spec.inferredFromChanges) {
			specParts.push(`changes→${context.spec.inferredFromChanges}`);
		}
		if (context.spec.hasRequiredDocs === true) {
			specParts.push('docs: ok');
		} else if (context.spec.hasRequiredDocs === false) {
			specParts.push('docs: missing');
		}
		lines.push(`Active spec: ${context.spec.active}${specParts.length ? ` (${specParts.join(' | ')})` : ''}`);
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
