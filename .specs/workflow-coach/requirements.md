# Requirements Document

## Introduction

This feature introduces a **Workflow Coach** command that inspects the repo’s current state and the current user request, then prints actionable reminders about the spec-first workflow, branching, verification, and PR hygiene.

The coach can also persist **local-only** per-branch metadata (under the git common directory) so it can provide better reminders across restarts and git worktrees without modifying tracked files.

## Glossary

- **Workflow Coach** — A CLI script that produces workflow reminders and next-step recommendations.
- **Detected State** — The script’s classification of the current working situation (dirty main, unpushed commits, etc.).
- **Suggested Next State** — A short description of the next “good” situation (clean branch, PR opened, etc.).
- **Active Spec** — The spec folder (`.specs/<name>/`) the current work is expected to correspond to.
- **Persisted State** — Local-only metadata saved by the coach (e.g. last run time, last inferred Active Spec), stored under the git common directory to work across git worktrees.

## Requirements

### Requirement 1 — Run coach and print state summary

**User Story:** As a developer/agent, I want a single command to summarize workflow status so that I don’t forget required steps.

#### Acceptance Criteria

1.1 WHEN invoked from a git worktree, THE Workflow_Coach SHALL print the current branch and change counts (staged/unstaged/untracked).  
1.2 THE Workflow_Coach SHALL print a Detected State and Suggested Next State.  
1.3 THE Workflow_Coach SHALL exit with code `0` for normal operation and non-zero only for operational failures (e.g. not a git repo), OR when enforcement is explicitly requested (e.g. via `--fail-on`).  
1.4 THE Workflow_Coach SHALL be advisory-only and SHALL NOT modify git history or tracked files (no commits, no pushes, no branch changes).  

### Requirement 2 — Accept user request input

**User Story:** As a developer/agent, I want to pass the current user request so the coach can tailor advice to the intended scope.

#### Acceptance Criteria

2.1 THE Workflow_Coach SHALL accept a `--query` argument.  
2.2 WHEN `--query` is provided, THE Workflow_Coach SHOULD infer a probable work type (`feature`, `fix`, `docs`, `ci`, `chore`) and surface it as advisory output.  
2.3 THE Workflow_Coach SHALL allow explicitly setting the type via `--type <...>` and SHALL prefer the explicit value over inference.  

### Requirement 3 — Best-effort PR awareness

**User Story:** As a developer/agent, I want the coach to tell me if I forgot to open a PR.

#### Acceptance Criteria

3.1 WHEN `gh` is installed and authenticated, THE Workflow_Coach SHOULD detect whether the current branch has an open PR and print the PR URL if present.  
3.2 WHEN `gh` is missing or unauthenticated, THE Workflow_Coach SHALL continue and SHALL not fail the run.  
3.3 THE Workflow_Coach SHALL support a `--no-gh` option that disables PR lookups for faster/offline runs.  
3.4 WHEN the current branch’s PR is `MERGED` (best-effort) AND new work exists on the branch, THE Workflow_Coach SHOULD remind to open a new PR for the follow-up changes.  

### Requirement 4 — Recommend actions (commands)

**User Story:** As a developer/agent, I want concrete next commands so that I can follow the workflow reliably.

#### Acceptance Criteria

4.1 WHEN on `main` with uncommitted changes, THE Workflow_Coach SHALL recommend creating a new branch.  
4.2 WHEN there are staged changes, THE Workflow_Coach SHALL recommend running the “quad verification” before committing/pushing.  
4.3 WHEN commits are ahead of upstream, THE Workflow_Coach SHALL recommend pushing.  
4.4 WHEN on a non-main branch without an open PR (best-effort), THE Workflow_Coach SHOULD recommend opening a PR.  
4.5 WHEN the diff spans multiple coarse scopes (e.g. code + docs + CI), THE Workflow_Coach SHOULD recommend splitting work using `git worktree` (preferred) or stash/cherry-pick.  
4.6 THE Workflow_Coach SHOULD remind the recommended branch naming format (`<type>/<scope>`) and commit subject format (`<area>: <summary>`) when suggesting next actions.  

### Requirement 5 — Machine-readable output

**User Story:** As a developer/agent, I want a JSON output mode so that future automation can consume the coach’s recommendations.

#### Acceptance Criteria

5.1 THE Workflow_Coach SHALL support `--json` to output a JSON object containing detected state, suggested next state, warnings, and next actions.  

### Requirement 6 — Persist local-only per-branch metadata

**User Story:** As a developer/agent, I want the coach to remember basic context across runs so that it can detect drift and give better reminders across restarts and git worktrees.

#### Acceptance Criteria

6.1 BY DEFAULT, THE Workflow_Coach SHALL persist per-branch metadata under the git common directory so it is shared across git worktrees.  
6.2 THE persisted metadata SHALL NOT modify tracked files and SHALL NOT change git history.  
6.3 THE Workflow_Coach SHALL support `--no-persist` to skip reading/writing persisted metadata.  
6.4 WHEN prior metadata exists for the current branch, THE Workflow_Coach SHOULD surface a short “previous run” summary (e.g. timestamp, last inferred Active Spec, last Detected State).  

### Requirement 7 — Deterministic spec cross-check (“spec drift” warnings)

**User Story:** As a developer/agent, I want the coach to warn when my code changes don’t match the expected spec folder so that I don’t silently drift away from spec-first workflow.

#### Acceptance Criteria

7.1 WHEN the branch name matches `<type>/<spec>` (or `<type>/<spec>/...`), THE Workflow_Coach SHOULD infer an expected Active Spec name from the branch.  
7.2 WHEN the working changes touch a single `.specs/<name>/...` subtree, THE Workflow_Coach SHOULD treat that as the Active Spec and cross-check it against the branch-inferred spec (if any).  
7.3 WHEN an expected Active Spec is inferred and code/build/CI changes exist without any `.specs/...` changes in the current working changes, THE Workflow_Coach SHOULD warn that the spec may be stale.  
7.4 WHEN an expected Active Spec is inferred but `.specs/<name>/{design,requirements,tasks}.md` are missing, THE Workflow_Coach SHOULD warn that the spec is incomplete.  

### Requirement 8 — Heuristic phase reminders (design vs implementation)

**User Story:** As a developer/agent, I want the coach to infer whether I’m in a design or implementation phase so that it can surface the right reminders at the right time.

#### Acceptance Criteria

8.1 WHEN working changes touch `.specs/...` and do not touch code/build/CI paths, THE Workflow_Coach SHOULD treat the current phase as “design” and SHOULD remind to clarify vague requirements with the human.  
8.2 WHEN working changes touch code/build/CI paths, THE Workflow_Coach SHOULD treat the current phase as “implementation”.  
8.3 WHEN the inferred phase changes compared to the previous persisted run for the branch, THE Workflow_Coach SHOULD surface a short advisory “phase changed” reminder.  
8.4 WHEN the phase cannot be inferred (e.g. clean tree with no previous phase), THE Workflow_Coach SHOULD remind to explicitly decide whether the next step is design (clarify + update spec) or implementation (follow tasks + verify).  

### Requirement 9 — Documentation code-link formatting reminder

**User Story:** As a developer/agent, I want documentation to contain navigable code references so that reviewers can click through to the exact implementation quickly (both locally and on GitHub).

#### Acceptance Criteria

9.1 WHEN the work type is `docs` OR the working changes include Markdown docs/spec changes, THE Workflow_Coach SHOULD remind to use relative Markdown links with GitHub-style line anchors, e.g. `[src/foo.ts#L42](src/foo.ts#L42)` or `[src/foo.ts#L42-L55](src/foo.ts#L42-L55)`.  

### Requirement 10 — Optional git hook integration (commit/push checkpoints)

**User Story:** As a developer/agent, I want the coach reminders to run automatically at commit/push checkpoints so that I don’t forget to run it.

#### Acceptance Criteria

10.1 THE repository SHALL provide a `workflow:install-hooks` script that sets `core.hooksPath` to `.githooks`.  
10.2 THE repository SHALL include `.githooks/pre-commit` and `.githooks/pre-push` scripts that run Workflow Coach at the respective checkpoint.  
10.3 The hook scripts SHALL be non-blocking by default (advisory only).  
10.4 WHEN enforcement is requested, the hook scripts SHOULD be able to block by setting an environment variable and selecting one or more warning IDs (e.g. `dirty-main`, `spec-mismatch`) or `warn` (any warning).  
10.5 THE Workflow_Coach SHALL support a `--fail-on` option to exit non-zero when selected warnings are present (enables enforcement in hooks/CI).  
