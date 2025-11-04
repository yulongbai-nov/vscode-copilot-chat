# Design: Nightly Upstream Merge Workflow

## Overview
We will introduce a new workflow named `fork-nightly-merge.yml` that schedules a nightly job to merge upstream `main` into the fork's `main` branch. The job delegates git and PR orchestration to a new helper script (`script/sync-fork-main-merge.sh`) that uses the GitHub CLI.

## Workflow Structure
- **Triggers**: 
  - `schedule` (`15 2 * * *`) - runs automatically every night
  - `workflow_dispatch` - can be triggered manually from any branch with customizable inputs:
    - `target_branch`: Branch to merge into (default: main)
    - `sync_branch`: Name of the sync branch (default: automation/nightly-upstream-merge)
    - `upstream_repo`: Upstream repository (default: microsoft/vscode-copilot-chat)
    - `upstream_branch`: Upstream branch to merge from (default: main)
    - `dry_run`: Test mode that stops before creating PR (default: false)
- **Permissions**: `contents: write`, `pull-requests: write` (required for pushing branches and opening PRs).
- **Environment**: `GH_TOKEN` secret provided by the repository owner; passed to both the workflow step and the helper script.
- **Testing**: Can be triggered from non-default branches using `gh workflow run fork-nightly-merge.yml --ref <branch-name>` with custom parameters.
- **Steps**:
  1. Checkout repository with `fetch-depth: 0` so merge base info is available.
  2. Configure git author (`github-actions[bot]`).
  3. Authenticate `gh`: `echo "$GH_TOKEN" | gh auth login --with-token`; verify with `gh auth status --show-token-scopes` to give clearer failures when the token lacks `repo` scope.
  4. Run `script/sync-fork-main-merge.sh` to perform the automation and produce structured output variables for the summary.
  5. Append run summary (success/no-op/failure) to `$GITHUB_STEP_SUMMARY` with configuration details.

## Helper Script Responsibilities
`script/sync-fork-main-merge.sh` (bash, `set -euo pipefail`):
- Validate required commands (`git`, `gh`).
- Configure Git to allow incomplete LFS pushes (`git config lfs.allowincompletepush true`) to avoid upload failures when LFS objects are not available locally after `GIT_LFS_SKIP_SMUDGE` fetch.
- Ensure upstream remote points to `microsoft/vscode-copilot-chat` (override-able via env vars).
- Sync references: fetch upstream `main` and origin `main` using `GIT_LFS_SKIP_SMUDGE=1` to skip downloading LFS files.
- Create/update working branch `automation/nightly-upstream-merge` from `origin/main`.
- Merge upstream branch via `git merge --no-edit`.
- Detect no-op merges (diff clean against origin main) and set `SYNC_OUTCOME=no_changes` before exiting 0.
- Push branch to origin when changes exist (incomplete LFS pushes allowed to prevent failures).
- Create or update PR targeting `main`:
  - Title: `Nightly upstream merge` (configurable via env).
  - Body includes timestamp + summary of upstream commits (`git log --oneline`).
  - Request review from AI agent via `gh pr review-request --add github-copilot` (configurable `PR_REVIEWER`).
- Export key outputs through `$GITHUB_ENV` (e.g., `SYNC_OUTCOME`, `PR_URL`, `MERGE_LOG`) for the workflow summary step.
- On merge conflicts, capture conflict details, commit the conflicted state to a new branch `automation/nightly-sync-conflict-{upstream-hash}`, create a PR with conflict information, request review from repository owner and AI agent, set `SYNC_OUTCOME=merge_conflict_pr_created`, exit successfully.

## Secret & Auth Handling
- Document that `GH_TOKEN` must be a classic PAT (or a GitHub App token) with `repo` scope and stored as an Actions secret.
- In workflow, set `GH_TOKEN: ${{ secrets.GH_TOKEN }}` for the script step and guard early if unset.
- Script will call `gh auth status` to confirm `repo` scope and produce actionable error messages.

## Removal Plan
- Delete `.github/workflows/fork-main-sync.yml` and `.github/workflows/type-hierarchy-maintenance.yml`.
- No other references exist (confirmed via `rg` before implementation).

## Validation Plan
- `act` dry-run for the new workflow (syntax validation) if feasible.
- Manual test script invocation locally (optional) documented in PR notes.
- Ensure `npm run lint` still passes (though TypeScript untouched, good hygiene before merge).
- **Manual workflow testing**: Use `gh workflow run fork-nightly-merge.yml --ref <branch-name>` with custom inputs to test different scenarios without affecting the main branch.
- **LFS handling**: Verify that incomplete LFS pushes are allowed to prevent upload failures during merge operations.

## Recent Improvements

### Git LFS Push Failure Fix
- **Problem**: Script was failing with "Git LFS upload failed" errors when pushing branches due to missing LFS objects after `GIT_LFS_SKIP_SMUDGE` fetch.
- **Solution**: Added `git config lfs.allowincompletepush true` in the script to allow pushes even when LFS objects are not fully available locally.
- **Rationale**: Since the script uses `GIT_LFS_SKIP_SMUDGE=1` during fetch/merge to avoid downloading large files, LFS objects may not be available locally. The `allowincompletepush` setting allows the push operation to succeed without requiring local LFS objects.

### Manual Testing Capability
- **Enhancement**: Added comprehensive `workflow_dispatch` inputs to enable testing from non-default branches.
- **Inputs Available**:
  - `target_branch`: Customize the target branch for testing
  - `sync_branch`: Use a different sync branch name
  - `upstream_repo`: Test with different upstream repositories
  - `upstream_branch`: Merge from different upstream branches
  - `dry_run`: Test mode (currently documented, implementation optional)
- **Benefits**:
  - Fast iteration during development and testing
  - No impact on main branch during testing
  - Can verify workflow behavior before merging changes
  - Useful for testing with GH_TOKEN in different environments

## Risks & Mitigations
- **Token misconfiguration**: early `gh auth status` check yields clear failure.
- **Merge conflicts**: script commits conflicted state to a dedicated conflict branch, creates a PR with conflict details and instructions for manual resolution, and requests review from repository owner and AI agent.
- **Branch churn**: using single predictable branch prevents branch proliferation for successful merges; conflict branches include upstream hash to track specific conflict scenarios; branch deleted when PR merged (script handles via `gh pr view` check).
