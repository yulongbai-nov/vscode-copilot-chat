# Design: Nightly Upstream Merge Workflow

## Overview
We will introduce a new workflow named `fork-nightly-merge.yml` that schedules a nightly job to merge upstream `main` into the fork's `main` branch. The job delegates git and PR orchestration to a new helper script (`script/sync-fork-main-merge.sh`) that uses the GitHub CLI.

## Workflow Structure
- **Triggers**: `schedule` (`15 2 * * *`) and `workflow_dispatch`.
- **Permissions**: `contents: write`, `pull-requests: write` (required for pushing branches and opening PRs).
- **Environment**: `GH_TOKEN` secret provided by the repository owner; passed to both the workflow step and the helper script.
- **Steps**:
  1. Checkout repository with `fetch-depth: 0` so merge base info is available.
  2. Configure git author (`github-actions[bot]`).
  3. Authenticate `gh`: `echo "$GH_TOKEN" | gh auth login --with-token`; verify with `gh auth status --show-token-scopes` to give clearer failures when the token lacks `repo` scope.
  4. Run `script/sync-fork-main-merge.sh` to perform the automation and produce structured output variables for the summary.
  5. Append run summary (success/no-op/failure) to `$GITHUB_STEP_SUMMARY`.

## Helper Script Responsibilities
`script/sync-fork-main-merge.sh` (bash, `set -euo pipefail`):
- Validate required commands (`git`, `gh`).
- Ensure upstream remote points to `microsoft/vscode-copilot-chat` (override-able via env vars).
- Sync references: fetch upstream `main` and origin `main`.
- Create/update working branch `automation/nightly-upstream-merge` from `origin/main`.
- Merge upstream branch via `git merge --no-edit`.
- Detect no-op merges (diff clean against origin main) and set `SYNC_OUTCOME=no_changes` before exiting 0.
- Push branch to origin when changes exist.
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

## Risks & Mitigations
- **Token misconfiguration**: early `gh auth status` check yields clear failure.
- **Merge conflicts**: script commits conflicted state to a dedicated conflict branch, creates a PR with conflict details and instructions for manual resolution, and requests review from repository owner and AI agent.
- **Branch churn**: using single predictable branch prevents branch proliferation for successful merges; conflict branches include upstream hash to track specific conflict scenarios; branch deleted when PR merged (script handles via `gh pr view` check).
