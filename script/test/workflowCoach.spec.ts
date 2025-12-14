/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, suite, test } from 'vitest';

import { evaluateWorkflow, inferWorkType, type WorkflowContext } from '../workflowCoachCore';

function createContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
	return {
		query: overrides.query,
		workType: overrides.workType,
		git: {
			branch: 'feature/example',
			isMainBranch: false,
			stagedFiles: 0,
			unstagedFiles: 0,
			untrackedFiles: 0,
			ahead: 0,
			behind: 0,
			changedPaths: [],
			...overrides.git,
		},
		gh: overrides.gh,
		previous: overrides.previous,
		spec: overrides.spec,
	};
}

suite('Workflow Coach', () => {
	suite('inferWorkType', () => {
		test('infers docs from query', () => {
			expect(inferWorkType('please update the README', undefined)).toBe('docs');
		});

		test('honors explicit type', () => {
			expect(inferWorkType('whatever', 'fix')).toBe('fix');
		});

		test('returns undefined for unknown explicit type', () => {
			expect(inferWorkType('whatever', 'banana')).toBeUndefined();
		});
	});

	suite('evaluateWorkflow', () => {
		test('warns on dirty main', () => {
			const result = evaluateWorkflow(
				createContext({
					workType: 'fix',
					git: { branch: 'main', isMainBranch: true, unstagedFiles: 1, changedPaths: ['src/a.ts'] },
				}),
			);

			expect(result.detectedState).toBe('dirty-main');
			expect(result.warnings.some(w => w.id === 'dirty-main')).toBe(true);
		});

		test('recommends quad + commit format when staged changes exist', () => {
			const result = evaluateWorkflow(
				createContext({
					git: { stagedFiles: 2, changedPaths: ['docs/a.md'] },
				}),
			);

			expect(result.detectedState).toBe('staged-changes');
			expect(result.nextActions.some(a => a.id === 'quad-before-commit')).toBe(true);
			expect(result.nextActions.some(a => a.id === 'commit-format')).toBe(true);
		});

		test('recommends pushing when ahead of upstream', () => {
			const result = evaluateWorkflow(
				createContext({
					git: { ahead: 1, upstream: 'origin/feature/example' },
				}),
			);

			expect(result.detectedState).toBe('unpushed-commits');
			expect(result.nextActions.some(a => a.id === 'push-branch')).toBe(true);
		});

		test('warns when changes span multiple scopes', () => {
			const result = evaluateWorkflow(
				createContext({
					git: {
						unstagedFiles: 2,
						changedPaths: ['src/a.ts', '.github/workflows/ci.yml'],
					},
				}),
			);

			expect(result.warnings.some(w => w.id === 'mixed-scope')).toBe(true);
		});

		test('treats .specs paths as a separate scope bucket', () => {
			const result = evaluateWorkflow(
				createContext({
					git: {
						unstagedFiles: 2,
						changedPaths: ['.specs/workflow-coach/design.md', 'docs/workflow-coach.md'],
					},
				}),
			);

			const mixedScopeWarning = result.warnings.find(w => w.id === 'mixed-scope');
			expect(mixedScopeWarning?.why).toContain('docs');
			expect(mixedScopeWarning?.why).toContain('specs');
		});

		test('warns when spec inferred from branch mismatches spec inferred from changes', () => {
			const result = evaluateWorkflow(
				createContext({
					spec: {
						inferredFromBranch: 'expected-spec',
						inferredFromChanges: 'actual-spec',
						active: 'actual-spec',
						hasRequiredDocs: true,
						hasSpecChanges: true,
					},
				}),
			);

			expect(result.warnings.some(w => w.id === 'spec-mismatch')).toBe(true);
		});

		test('warns when active spec is missing core docs', () => {
			const result = evaluateWorkflow(
				createContext({
					spec: {
						active: 'workflow-coach',
						hasRequiredDocs: false,
						hasSpecChanges: true,
					},
				}),
			);

			expect(result.warnings.some(w => w.id === 'spec-incomplete')).toBe(true);
		});

		test('warns when code changes exist without any .specs changes', () => {
			const result = evaluateWorkflow(
				createContext({
					git: {
						unstagedFiles: 1,
						changedPaths: ['src/a.ts'],
					},
					spec: {
						active: 'workflow-coach',
						hasRequiredDocs: true,
						hasSpecChanges: false,
					},
				}),
			);

			expect(result.warnings.some(w => w.id === 'spec-not-updated')).toBe(true);
		});

		test('recommends opening PR when authenticated and missing', () => {
			const result = evaluateWorkflow(
				createContext({
					gh: { hasAuth: true },
					git: { branch: 'feature/example', isMainBranch: false },
				}),
			);

			expect(result.nextActions.some(a => a.id === 'open-pr')).toBe(true);
		});
	});
});
