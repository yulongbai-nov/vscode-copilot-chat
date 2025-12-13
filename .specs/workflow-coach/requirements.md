# Requirements Document

## Introduction

This feature introduces a **Workflow Coach** command that inspects the repo’s current state and the current user request, then prints actionable reminders about the spec-first workflow, branching, verification, and PR hygiene.

## Glossary

- **Workflow Coach** — A CLI script that produces workflow reminders and next-step recommendations.
- **Detected State** — The script’s classification of the current working situation (dirty main, unpushed commits, etc.).
- **Suggested Next State** — A short description of the next “good” situation (clean branch, PR opened, etc.).

## Requirements

### Requirement 1 — Run coach and print state summary

**User Story:** As a developer/agent, I want a single command to summarize workflow status so that I don’t forget required steps.

#### Acceptance Criteria

1.1 WHEN invoked from a git worktree, THE Workflow_Coach SHALL print the current branch and change counts (staged/unstaged/untracked).  
1.2 THE Workflow_Coach SHALL print a Detected State and Suggested Next State.  
1.3 THE Workflow_Coach SHALL exit with code `0` for normal operation and non-zero only for operational failures (e.g. not a git repo).  

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

### Requirement 4 — Recommend actions (commands)

**User Story:** As a developer/agent, I want concrete next commands so that I can follow the workflow reliably.

#### Acceptance Criteria

4.1 WHEN on `main` with uncommitted changes, THE Workflow_Coach SHALL recommend creating a new branch.  
4.2 WHEN there are staged changes, THE Workflow_Coach SHALL recommend running the “quad verification” before committing/pushing.  
4.3 WHEN commits are ahead of upstream, THE Workflow_Coach SHALL recommend pushing.  
4.4 WHEN on a non-main branch without an open PR (best-effort), THE Workflow_Coach SHOULD recommend opening a PR.  
4.5 WHEN the diff spans multiple coarse scopes (e.g. code + docs + CI), THE Workflow_Coach SHOULD recommend splitting work using `git worktree` (preferred) or stash/cherry-pick.  

### Requirement 5 — Machine-readable output

**User Story:** As a developer/agent, I want a JSON output mode so that future automation can consume the coach’s recommendations.

#### Acceptance Criteria

5.1 THE Workflow_Coach SHALL support `--json` to output a JSON object containing detected state, suggested next state, warnings, and next actions.  

