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

if [[ -z "${GH_TOKEN:-}" ]]; then
	printf 'GH_TOKEN is not set; provide a token with `repo` scope.\n' >&2
	exit 2
fi

check_gh_token() {
	set +e
	auth_output="$(gh auth status 2>&1)"
	status=$?
	set -e

	if [[ "$status" -ne 0 ]]; then
		printf '%s\n' "$auth_output" >&2
		printf 'GitHub CLI is not authenticated. Run `gh auth login --scopes repo` locally or supply GH_TOKEN with repo scope in the workflow.\n' >&2
		exit 2
	fi
}

check_gh_token

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

sync_branch="${SYNC_BRANCH:-automation/nightly-upstream-merge}"
target_branch="${TARGET_BRANCH:-main}"
fork_remote="${FORK_REMOTE:-origin}"
upstream_remote="${UPSTREAM_REMOTE:-upstream}"
upstream_repo="${UPSTREAM_REPO:-microsoft/vscode-copilot-chat}"
upstream_branch="${UPSTREAM_BRANCH:-main}"
pr_title="${PR_TITLE:-Nightly upstream merge}"
pr_body_header="${PR_BODY:-Automated nightly merge of upstream main into fork main.}"
pr_reviewer="${PR_REVIEWER:-github-copilot}"
cleanup_branch="${CLEANUP_BRANCH_ON_MERGE:-1}"
cleanup_on_no_changes="${CLEANUP_BRANCH_ON_NO_CHANGES:-1}"
log_dir="${SYNC_LOG_DIR:-$repo_root/.github/tmp}"

mkdir -p "$log_dir"
merge_log="$log_dir/merge-${sync_branch//\//-}-$(date +%s).log"

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

log "Merging $upstream_remote/$upstream_branch into $sync_branch"
set +e
git merge --no-ff --no-edit "$upstream_remote/$upstream_branch" 2>&1 | tee "$merge_log"
merge_status=${PIPESTATUS[0]}
set -e

if [[ "$merge_status" -ne 0 ]]; then
	log "Merge failed; aborting and preserving log at $merge_log"
	git merge --abort >/dev/null 2>&1 || true
	echo "MERGE_LOG_PATH=$merge_log" >>"$GITHUB_ENV"
	echo "SYNC_OUTCOME=merge_conflict" >>"$GITHUB_ENV"
	exit 90
fi

if git diff --quiet "$fork_remote/$target_branch"...HEAD; then
	log "No updates required after merge; branch matches $fork_remote/$target_branch"
	existing_pr="$(gh pr list --head "$sync_branch" --base "$target_branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)"
	if [[ -n "$existing_pr" ]]; then
		log "Closing stale PR #$existing_pr"
		gh pr close "$existing_pr" --comment "Automation closed this PR because no changes are required." >/dev/null 2>&1 || true
		if [[ "$cleanup_on_no_changes" == "1" ]]; then
			log "Deleting remote branch $sync_branch"
			git push "$fork_remote" --delete "$sync_branch" >/dev/null 2>&1 || true
		fi
	fi

	echo "SYNC_OUTCOME=no_changes" >>"$GITHUB_ENV"
	exit 0
fi

log "Pushing $sync_branch to $fork_remote"
git push "$fork_remote" "$sync_branch" --force-with-lease

changes="$(git log --oneline "$fork_remote/$target_branch"..HEAD | sed 's/^/- /')"
pr_body="$pr_body_header"
if [[ -n "$changes" ]]; then
	pr_body="$pr_body"$'\n\n'"Upstream commits included:"$'\n'"$changes"
fi

pr_number="$(gh pr list --head "$sync_branch" --base "$target_branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)"
sync_outcome="pr_updated"

if [[ -n "$pr_number" ]]; then
	log "Updating existing PR #$pr_number"
	gh pr edit "$pr_number" --title "$pr_title" --body "$pr_body" >/dev/null
else
	log "Creating PR from $sync_branch to $target_branch"
	gh pr create --base "$target_branch" --head "$sync_branch" --title "$pr_title" --body "$pr_body" >/dev/null
	pr_number="$(gh pr view "$sync_branch" --json number --jq '.number')"
	sync_outcome="pr_created"
fi

pr_url="$(gh pr view "$pr_number" --json url --jq '.url')"
echo "PR_NUMBER=$pr_number" >>"$GITHUB_ENV"
echo "PR_URL=$pr_url" >>"$GITHUB_ENV"

if [[ -n "$pr_reviewer" ]]; then
	log "Requesting review from $pr_reviewer"
	gh pr review-request "$pr_number" --add "$pr_reviewer" >/dev/null 2>&1 || true
fi

if [[ "$cleanup_branch" == "1" ]]; then
	is_merged="$(gh pr view "$pr_number" --json merged --jq '.merged' 2>/dev/null || echo false)"
	if [[ "$is_merged" == "true" ]]; then
		log "PR #$pr_number merged; deleting remote branch $sync_branch"
		git push "$fork_remote" --delete "$sync_branch" >/dev/null 2>&1 || true
	fi
fi

echo "SYNC_OUTCOME=$sync_outcome" >>"$GITHUB_ENV"
echo "MERGE_LOG_PATH=$merge_log" >>"$GITHUB_ENV"
log "Sync completed successfully for PR #$pr_number ($pr_url)"
