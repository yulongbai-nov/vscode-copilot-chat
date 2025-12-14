/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type WorkType = 'feature' | 'fix' | 'docs' | 'ci' | 'chore' | 'refactor' | 'test' | 'perf';

export type WorkflowContext = {
	query?: string;
	workType?: WorkType;
	git: {
		branch: string;
		isMainBranch: boolean;
		upstream?: string;
		stagedFiles: number;
		unstagedFiles: number;
		untrackedFiles: number;
		ahead: number;
		behind: number;
		changedPaths: string[];
	};
	gh?: {
		hasAuth: boolean;
		prNumber?: number;
		prUrl?: string;
	};
	previous?: {
		lastRunAt?: string;
		lastWorkType?: WorkType;
		lastActiveSpec?: string;
		lastDetectedState?: string;
	};
	spec?: {
		inferredFromBranch?: string;
		inferredFromChanges?: string;
		active?: string;
		hasRequiredDocs?: boolean;
		hasSpecChanges?: boolean;
	};
};

export type Recommendation = {
	id: string;
	title: string;
	why: string;
	commands?: string[];
	severity: 'info' | 'warn';
};

export type CoachResult = {
	detectedState: string;
	suggestedNextState: string;
	warnings: Recommendation[];
	nextActions: Recommendation[];
};

export type WorkflowCoachOptions = {
	defaultBranch?: string;
};

export function inferWorkType(query: string | undefined, explicitType?: string): WorkType | undefined {
	if (explicitType) {
		return normalizeWorkType(explicitType);
	}

	const normalized = (query ?? '').toLowerCase();
	if (!normalized) {
		return undefined;
	}

	if (/\b(readme|docs|documentation|markdown)\b/.test(normalized)) {
		return 'docs';
	}
	if (/\b(ci|pipeline|release|vsix)\b/.test(normalized) || /\bgithub action(s)?\b/.test(normalized) || /\bgithub workflow(s)?\b/.test(normalized)) {
		return 'ci';
	}
	if (/\b(test|vitest|unit test|e2e)\b/.test(normalized)) {
		return 'test';
	}
	if (/\b(perf|performance|optimiz)\b/.test(normalized)) {
		return 'perf';
	}
	if (/\b(refactor|cleanup|restructure|rename)\b/.test(normalized)) {
		return 'refactor';
	}
	if (/\b(fix|bug|crash|regression|broken)\b/.test(normalized)) {
		return 'fix';
	}
	if (/\b(chore|deps|dependency|bump)\b/.test(normalized)) {
		return 'chore';
	}

	return 'feature';
}

function normalizeWorkType(type: string): WorkType | undefined {
	const normalized = type.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}

	switch (normalized) {
		case 'feature':
		case 'fix':
		case 'docs':
		case 'ci':
		case 'chore':
		case 'refactor':
		case 'test':
		case 'perf':
			return normalized;
		default:
			return undefined;
	}
}

type ScopeBucket = 'code' | 'docs' | 'ci' | 'specs' | 'build' | 'other';

function bucketForPath(filePath: string): ScopeBucket {
	if (filePath.startsWith('src/') || filePath.startsWith('chat-lib/')) {
		return 'code';
	}
	if (filePath.startsWith('.github/workflows/')) {
		return 'ci';
	}
	if (filePath.startsWith('.specs/')) {
		return 'specs';
	}
	if (filePath.startsWith('docs/') || filePath === 'README.md' || filePath.endsWith('.md')) {
		return 'docs';
	}
	if (
		filePath === 'package.json' ||
		filePath === 'package-lock.json' ||
		filePath.endsWith('.config.js') ||
		filePath.endsWith('.config.mjs') ||
		filePath.startsWith('script/')
	) {
		return 'build';
	}
	return 'other';
}

function detectScopeBuckets(changedPaths: readonly string[]): ScopeBucket[] {
	const buckets = new Set<ScopeBucket>();
	for (const changedPath of changedPaths) {
		buckets.add(bucketForPath(changedPath));
	}
	return Array.from(buckets.values()).sort();
}

export function evaluateWorkflow(context: WorkflowContext, options: WorkflowCoachOptions = {}): CoachResult {
	const defaultBranch = options.defaultBranch ?? 'main';
	const warnings: Recommendation[] = [];
	const nextActions: Recommendation[] = [];

	const { git, gh, workType } = context;
	const hasWorkingChanges = git.stagedFiles + git.unstagedFiles + git.untrackedFiles > 0;
	const scopeBuckets = detectScopeBuckets(git.changedPaths);

	const activeSpec = context.spec?.active;
	const inferredSpecFromBranch = context.spec?.inferredFromBranch;
	const inferredSpecFromChanges = context.spec?.inferredFromChanges;

	if (inferredSpecFromBranch && inferredSpecFromChanges && inferredSpecFromBranch !== inferredSpecFromChanges) {
		warnings.push({
			id: 'spec-mismatch',
			severity: 'warn',
			title: 'Active spec does not match branch',
			why: `Branch suggests spec "${inferredSpecFromBranch}", but working changes touch ".specs/${inferredSpecFromChanges}/...". Consider splitting the work or aligning the branch/spec.`,
			commands: [
				'# If this is a scope shift, start a new branch/worktree for the new spec:',
				`git fetch origin && git worktree add -b <type>/<spec> ../<repo>.worktrees/<branchSlug> origin/${defaultBranch}`,
				'# If this is accidental drift, move the edits back into the expected spec folder.',
			],
		});
	}

	if (activeSpec && context.spec?.hasRequiredDocs === false) {
		warnings.push({
			id: 'spec-incomplete',
			severity: 'warn',
			title: 'Spec folder is missing core docs',
			why: `The active spec ".specs/${activeSpec}/" is missing one or more of: design.md, requirements.md, tasks.md.`,
			commands: [
				`mkdir -p .specs/${activeSpec}`,
				`# Create: .specs/${activeSpec}/design.md`,
				`# Create: .specs/${activeSpec}/requirements.md`,
				`# Create: .specs/${activeSpec}/tasks.md`,
			],
		});
	}

	if (
		activeSpec &&
		hasWorkingChanges &&
		context.spec?.hasSpecChanges === false &&
		(scopeBuckets.includes('code') || scopeBuckets.includes('ci') || scopeBuckets.includes('build'))
	) {
		warnings.push({
			id: 'spec-not-updated',
			severity: 'warn',
			title: 'Spec may be stale for current changes',
			why: `Working changes touch ${scopeBuckets.join(', ')} but no ".specs/..." changes were detected. Consider updating ".specs/${activeSpec}/" to keep spec-first workflow aligned.`,
			commands: [`$EDITOR .specs/${activeSpec}/tasks.md`, `$EDITOR .specs/${activeSpec}/design.md`],
		});
	}

	if (git.isMainBranch && (hasWorkingChanges || git.ahead > 0)) {
		warnings.push({
			id: 'dirty-main',
			severity: 'warn',
			title: `Avoid working directly on ${defaultBranch}`,
			why: `You are on ${defaultBranch} with local changes/commits; prefer a topic branch to keep main clean and to open a PR.`,
			commands: [
				`git checkout -b ${workType ?? '<type>'}/<scope>`,
				`# (optional) git fetch origin && git rebase origin/${defaultBranch}`,
			],
		});
	}

	if (git.behind > 0) {
		warnings.push({
			id: 'behind-upstream',
			severity: 'warn',
			title: 'Branch is behind upstream',
			why: `Your branch is behind ${git.upstream ?? 'its upstream'} by ${git.behind} commit(s); consider syncing before pushing new work.`,
			commands: ['git fetch', `git rebase ${git.upstream ?? `origin/${defaultBranch}`}`],
		});
	}

	if (scopeBuckets.length >= 2 && hasWorkingChanges) {
		warnings.push({
			id: 'mixed-scope',
			severity: 'warn',
			title: 'Changes span multiple scopes',
			why: `Changed paths touch multiple areas (${scopeBuckets.join(', ')}). Consider splitting work into separate branches/PRs.`,
			commands: [
				`git fetch origin && git worktree add -b <type>/<scope> ../<repo>.worktrees/<branchSlug> origin/${defaultBranch}`,
				`# Or: git stash push -p -u -m \"wip: <scope>\"`,
			],
		});
	}

	if (git.stagedFiles > 0) {
		nextActions.push({
			id: 'quad-before-commit',
			severity: 'info',
			title: 'Run verification before committing',
			why: 'The workflow expects lint/typecheck/compile (and relevant tests) before commit/push.',
			commands: ['npm run lint', 'npm run typecheck', 'npm run compile'],
		});
		nextActions.push({
			id: 'commit-format',
			severity: 'info',
			title: 'Commit with consistent subject format',
			why: 'Use a short, scoped subject line so history stays readable.',
			commands: [`git commit -m \"<area>: <summary>\"`, '# Examples: fix(lre): ... | docs(readme): ... | ci(upstream): ...'],
		});
	}

	if (git.ahead > 0) {
		nextActions.push({
			id: 'push-branch',
			severity: 'info',
			title: 'Push commits to origin',
			why: `You are ${git.ahead} commit(s) ahead of ${git.upstream ?? 'upstream'}; push so CI/PR can run.`,
			commands: [git.upstream ? 'git push' : `git push -u origin ${git.branch}`],
		});
	}

	if (!git.isMainBranch && gh?.hasAuth && !gh.prUrl) {
		nextActions.push({
			id: 'open-pr',
			severity: 'info',
			title: 'Open a PR for this branch',
			why: 'An open PR makes review/CI tracking easier and avoids “forgot to PR” drift.',
			commands: [`gh pr create --base ${defaultBranch} --head ${git.branch}`],
		});
	}

	if (workType) {
		nextActions.push({
			id: 'branch-format',
			severity: 'info',
			title: 'Branch naming reminder',
			why: 'Keep branch names consistent and searchable.',
			commands: [`# Suggested format: ${workType}/<short-scope-name>`],
		});
	}

	const detected = computeDetectedState(git, warnings, nextActions);
	const suggestedNextState = computeSuggestedNextState(git, gh, warnings, nextActions, defaultBranch);

	return {
		detectedState: detected,
		suggestedNextState,
		warnings,
		nextActions,
	};
}

function computeDetectedState(
	git: WorkflowContext['git'],
	warnings: readonly Recommendation[],
	nextActions: readonly Recommendation[],
): string {
	if (warnings.some(w => w.id === 'dirty-main')) {
		return 'dirty-main';
	}
	if (warnings.some(w => w.id === 'mixed-scope')) {
		return 'mixed-scope';
	}
	if (git.stagedFiles > 0) {
		return 'staged-changes';
	}
	if (git.unstagedFiles + git.untrackedFiles > 0) {
		return 'working-tree-dirty';
	}
	if (nextActions.some(a => a.id === 'push-branch')) {
		return 'unpushed-commits';
	}
	return 'clean';
}

function computeSuggestedNextState(
	git: WorkflowContext['git'],
	gh: WorkflowContext['gh'] | undefined,
	warnings: readonly Recommendation[],
	nextActions: readonly Recommendation[],
	defaultBranch: string,
): string {
	if (warnings.some(w => w.id === 'dirty-main')) {
		return `On a topic branch (not ${defaultBranch})`;
	}

	if (warnings.some(w => w.id === 'mixed-scope')) {
		return 'Separate branches/PRs per scope';
	}

	if (warnings.some(w => w.id === 'spec-mismatch')) {
		return 'Spec folder aligned with active work';
	}

	if (warnings.some(w => w.id === 'spec-incomplete')) {
		return 'Spec docs present (design/requirements/tasks)';
	}

	if (warnings.some(w => w.id === 'spec-not-updated')) {
		return 'Spec updated to match current changes';
	}

	if (git.stagedFiles > 0) {
		return 'Clean commit created after verification';
	}

	if (nextActions.some(a => a.id === 'push-branch') && !git.isMainBranch) {
		return 'Branch pushed to origin';
	}

	if (!git.isMainBranch && gh?.hasAuth && !gh.prUrl) {
		return 'PR opened for current branch';
	}

	return 'No immediate workflow action required';
}
