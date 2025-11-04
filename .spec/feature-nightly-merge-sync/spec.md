# Feature Spec: Nightly Merge Sync

## Background & Motivation
- Current `.github/workflows/fork-main-sync.yml` performs a rebase-based PR sync which is more complex than needed and has been cumbersome to operate.
- `.github/workflows/type-hierarchy-maintenance.yml` runs stack maintenance that is no longer necessary for the nightly upstream sync objective.
- Desired state is a lighter workflow that merges upstream changes into the fork on a nightly schedule, with automation requesting review from an AI agent when human approval is not needed.

## Goals
- Replace the rebase-and-PR sync with a merge-based workflow that runs on a nightly cron and can also be dispatched manually.
- Ensure the workflow uses the GitHub CLI (`gh`) authenticated via a `GH_TOKEN` secret that carries `repo` scope.
- Automatically prepare a PR (when updates exist) and request review from the AI agent account so the owner can rely on automated review.
- Remove obsolete workflows (`fork-main-sync.yml`, `type-hierarchy-maintenance.yml`).

## Non-Goals
- Refactoring the existing shell scripts beyond what is necessary for the merge-based flow.
- Introducing new simulation or CI tasks; validation stays limited to the workflow itself.
- Automatically merging the PR—owner can decide after AI review.

## User Stories
1. As the fork maintainer, I get a nightly automation that merges upstream `main` into my fork without manual rebase steps.
2. As the maintainer, I can manually dispatch the workflow to resync on demand.
3. When upstream changes exist, the automation opens/updates a PR and pings the AI agent reviewer automatically.

## Requirements
- Trigger schedule: nightly at 02:15 UTC, plus `workflow_dispatch`.
- Git operations must be merge-based (`git merge`), preserving upstream commits and creating merge commits only when required.
- Workflow must authenticate `gh` via an exported `GH_TOKEN` secret. The doc should note that this secret must be added to the repo with `repo` permissions; GITHUB_TOKEN is insufficient for fork writes.
- Workflow must safely handle "no changes" scenario (graceful exit without error).
- Job summary should report outcome (e.g., `Skipped`, `Merge PR #123`, failures with pointer to logs).

## Acceptance Criteria
- Old workflows removed from `.github/workflows`.
- New workflow file checked in and passes `act --list` syntax check (local validation we can document).
- Repository documentation/spec references the requirement for `GH_TOKEN` secret.
- Pull request opened by workflow includes review request to `github-copilot` (AI agent) and uses a stable branch name (`automation/nightly-upstream-merge`).

## Open Questions
- Should the workflow auto-merge once checks pass? (Default assumption: **No**, to keep human control; can be revisited.)
- Should we persist the helper shell script under `script/` or inline commands in YAML? (Plan: introduce a lightweight script to keep logic testable.)

## Timeline & Rollout
- Implementation target: current iteration. No staged rollout required; new workflow replaces old ones immediately upon merge.
