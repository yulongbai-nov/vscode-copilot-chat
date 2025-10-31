#!/usr/bin/env bash
set -euo pipefail

log() {
	printf '==> %s\n' "$1"
}

require_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf 'Missing required command: %s\n' "$1" >&2
		exit 1
	fi
}

require_cmd git
require_cmd gh

check_gh_token() {
	set +e
	auth_output="$(gh auth status 2>&1)"
	status=$?
	set -e

	if [[ "$status" -ne 0 ]]; then
		printf '%s\n' "$auth_output" >&2
		printf 'GitHub CLI is not authenticated. Run `gh auth login --scopes repo` or export GH_TOKEN with a repo-scoped PAT (the default GITHUB_TOKEN from forked workflows is read-only).\n' >&2
		exit 2
	fi

	# Note: Token scope information may not be available in all authentication methods
	# (e.g., when using GH_TOKEN environment variable). If operations fail due to
	# missing scopes, they will fail with clear error messages at runtime.
}

check_gh_token

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

sync_branch="${SYNC_BRANCH:-automation/sync-main}"
target_branch="${TARGET_BRANCH:-main}"
fork_remote="${FORK_REMOTE:-origin}"
upstream_remote="${UPSTREAM_REMOTE:-upstream}"
upstream_repo="${UPSTREAM_REPO:-microsoft/vscode-copilot-chat}"
upstream_branch="${UPSTREAM_BRANCH:-main}"
strategy_option="${REBASE_STRATEGY_OPTION:-ours}"
pr_title="${PR_TITLE:-Sync fork main with upstream}"
pr_body="${PR_BODY:-Automated rebase of fork main onto upstream main.}"
reviewer="${PR_REVIEWER:-github-copilot}"
watch_checks="${WATCH_PR_CHECKS:-1}"
enable_auto_merge="${ENABLE_AUTO_MERGE:-1}"
cleanup_branch="${CLEANUP_BRANCH_ON_MERGE:-1}"
log_dir="${SYNC_LOG_DIR:-$repo_root/.github/tmp}"

mkdir -p "$log_dir"
rebase_log="$log_dir/rebase-${sync_branch//\//-}-$(date +%s).log"

log "Ensuring upstream remote $upstream_remote -> $upstream_repo"
upstream_url="https://github.com/${upstream_repo}.git"
if git remote get-url "$upstream_remote" >/dev/null 2>&1; then
	git remote set-url "$upstream_remote" "$upstream_url"
else
	git remote add "$upstream_remote" "$upstream_url"
fi

log "Fetching $upstream_remote/$upstream_branch"
git fetch "$upstream_remote" "$upstream_branch"

log "Fetching $fork_remote/$target_branch"
git fetch "$fork_remote" "$target_branch"

log "Preparing branch $sync_branch from $fork_remote/$target_branch"
git switch -C "$sync_branch" "$fork_remote/$target_branch"

log "Rebasing $sync_branch onto $upstream_remote/$upstream_branch with -X $strategy_option"
set +e
git rebase "-X" "$strategy_option" "$upstream_remote/$upstream_branch" 2>&1 | tee "$rebase_log"
rebase_status=${PIPESTATUS[0]}
set -e
if [[ "$rebase_status" -ne 0 ]]; then
	log "Rebase failed; aborting and preserving log at $rebase_log"
	git rebase --abort >/dev/null 2>&1 || true
	echo "REBASE_LOG_PATH=$rebase_log" >>"$GITHUB_ENV"
	echo "SYNC_OUTCOME=rebase_failed" >>"$GITHUB_ENV"
	exit 90
fi

# Check if there are actual commits to merge
commit_count=$(git rev-list --count "$fork_remote/$target_branch"..HEAD)
if [[ "$commit_count" -eq 0 ]]; then
	log "No commits to merge after rebase; $sync_branch is at same commit as $fork_remote/$target_branch"
	existing_pr="$(gh pr list --head "$sync_branch" --base "$target_branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)"
	if [[ -n "$existing_pr" ]]; then
		log "Closing stale PR #$existing_pr"
		gh pr close "$existing_pr" --comment "Automation closed this PR because no changes are required." >/dev/null 2>&1 || true
		if [[ "$cleanup_branch" == "1" ]]; then
			log "Deleting remote branch $sync_branch"
			git push "$fork_remote" --delete "$sync_branch" >/dev/null 2>&1 || true
		fi
	fi
	exit 0
fi

log "Pushing $sync_branch to $fork_remote ($commit_count commit(s) ahead)"
git push "$fork_remote" "$sync_branch" --force-with-lease

pr_number="$(gh pr list --head "$sync_branch" --base "$target_branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)"

if [[ -n "$pr_number" ]]; then
	log "Updating existing PR #$pr_number"
	gh pr edit "$pr_number" --title "$pr_title" --body "$pr_body" >/dev/null
else
	log "Creating PR from $sync_branch to $target_branch"
	gh pr create --base "$target_branch" --head "$sync_branch" --title "$pr_title" --body "$pr_body" >/dev/null
	pr_number="$(gh pr view "$sync_branch" --json number --jq '.number')"
fi

pr_url="$(gh pr view "$pr_number" --json url --jq '.url')"
echo "PR_NUMBER=$pr_number" >>"$GITHUB_ENV"
echo "PR_URL=$pr_url" >>"$GITHUB_ENV"

if [[ "$enable_auto_merge" == "1" ]]; then
	log "Enabling auto-merge (rebase) for PR #$pr_number"
	set +e
	gh pr merge "$pr_number" --auto --rebase >/dev/null
	merge_status=$?
	set -e
	if [[ "$merge_status" -ne 0 ]]; then
		log "Failed to enable auto-merge for PR #$pr_number (exit $merge_status)"
	fi
fi

if [[ "$watch_checks" == "1" ]]; then
	log "Watching status checks for PR #$pr_number"
	set +e
	gh pr checks "$pr_number" --watch
	check_status=$?
	set -e
	if [[ "$check_status" -ne 0 ]]; then
		log "Checks failed for PR #$pr_number"
		if [[ -n "$reviewer" ]]; then
			log "Requesting review from $reviewer"
			gh pr review-request "$pr_number" --add "$reviewer" >/dev/null 2>&1 || true
		fi
		echo "PR_CHECKS_FAILED=1" >>"$GITHUB_ENV"
		echo "SYNC_OUTCOME=checks_failed" >>"$GITHUB_ENV"
		exit 91
	fi
fi

if [[ "$cleanup_branch" == "1" ]]; then
	is_merged="$(gh pr view "$pr_number" --json merged --jq '.merged')"
	if [[ "$is_merged" == "true" ]]; then
		log "PR #$pr_number merged; deleting remote branch $sync_branch"
		git push "$fork_remote" --delete "$sync_branch" >/dev/null 2>&1 || true
	fi
fi

echo "SYNC_OUTCOME=success" >>"$GITHUB_ENV"
log "Sync completed successfully for PR #$pr_number ($pr_url)"
