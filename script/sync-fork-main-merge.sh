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
require_cmd git-lfs

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

# Configure git to allow incomplete LFS pushes to avoid upload failures
# when LFS objects are not available locally after GIT_LFS_SKIP_SMUDGE fetch
git config lfs.allowincompletepush true

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
GIT_LFS_SKIP_SMUDGE=1 git fetch "$upstream_remote" "$upstream_branch"

log "Fetching $fork_remote/$target_branch"
GIT_LFS_SKIP_SMUDGE=1 git fetch "$fork_remote" "$target_branch"

log "Preparing branch $sync_branch from $fork_remote/$target_branch"
git switch -C "$sync_branch" "$fork_remote/$target_branch"

log "Merging $upstream_remote/$upstream_branch into $sync_branch"
set +e
GIT_LFS_SKIP_SMUDGE=1 git merge --no-ff --no-edit "$upstream_remote/$upstream_branch" 2>&1 | tee "$merge_log"
merge_status=${PIPESTATUS[0]}
set -e

if [[ "$merge_status" -ne 0 ]]; then
	log "Merge has conflicts; will push conflicted branch for review"

	# Get the upstream commit hash for branch naming
	upstream_hash="$(git rev-parse --short "$upstream_remote/$upstream_branch")"
	conflict_branch="automation/nightly-sync-conflict-${upstream_hash}"

	log "Creating conflict branch: $conflict_branch"

	# Get list of conflicted files before staging
	conflicted_files="$(git diff --name-only --diff-filter=U | sed 's/^/- /' || echo '- error: could not detect conflicted files')"

	# Add all files (including conflicted ones) to stage the conflict markers
	git add -A

	# Commit the conflicted state
	conflict_msg="Merge conflicts from upstream ${upstream_hash}

This is an automated merge that encountered conflicts.
Please review and resolve the conflicts manually.

Conflicted files:
${conflicted_files}

Source: ${upstream_remote}/${upstream_branch} (${upstream_hash})
Target: ${fork_remote}/${target_branch}"

	if ! git commit -m "$conflict_msg" --no-edit; then
		log "Failed to commit conflicted state; repository may be in inconsistent state"
		echo "SYNC_OUTCOME=merge_conflict_commit_failed" >>"$GITHUB_ENV"
		exit 91
	fi

	log "Pushing conflict branch $conflict_branch to $fork_remote (LFS pointers only)"
	if ! git push "$fork_remote" "HEAD:$conflict_branch" --force-with-lease; then
		log "Failed to push conflict branch with force-with-lease; trying with --force"
		if ! git push "$fork_remote" "HEAD:$conflict_branch" --force; then
			log "Failed to push conflict branch; cannot create PR without remote branch"
			echo "SYNC_OUTCOME=merge_conflict_push_failed" >>"$GITHUB_ENV"
			exit 92
		fi
	fi

	# Prepare PR body with conflict information
	conflict_pr_title="[CONFLICT] ${pr_title} (${upstream_hash})"
	conflict_pr_body="⚠️ **This PR contains merge conflicts that need manual resolution.**

${pr_body_header}

## Conflict Details

**Upstream commit**: \`${upstream_hash}\`
**Source**: \`${upstream_remote}/${upstream_branch}\`
**Target**: \`${fork_remote}/${target_branch}\`

### Conflicted Files

${conflicted_files}

### Next Steps

1. Check out this branch locally
2. Resolve the merge conflicts in the listed files
3. Test the changes
4. Commit and push the resolution
5. Merge this PR once conflicts are resolved

### Merge Log

See the workflow artifacts for the full merge log."

	# Check if a PR already exists for this conflict branch
	pr_number="$(gh pr list --head "$conflict_branch" --base "$target_branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)"

	if [[ -n "$pr_number" ]]; then
		log "Updating existing conflict PR #$pr_number"
		gh pr edit "$pr_number" --title "$conflict_pr_title" --body "$conflict_pr_body" >/dev/null
	else
		log "Creating conflict PR from $conflict_branch to $target_branch"
		gh pr create --base "$target_branch" --head "$conflict_branch" --title "$conflict_pr_title" --body "$conflict_pr_body" >/dev/null
		# Try multiple methods to get the PR number
		pr_number="$(gh pr view "$conflict_branch" --json number --jq '.number' 2>/dev/null || gh pr list --head "$conflict_branch" --base "$target_branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)"
		if [[ -z "$pr_number" ]]; then
			log "Warning: Could not retrieve PR number immediately after creation"
		fi
	fi

	# Get PR URL and export environment variables
	if [[ -n "$pr_number" ]]; then
		pr_url="$(gh pr view "$pr_number" --json url --jq '.url' 2>/dev/null || echo '')"
		echo "PR_NUMBER=$pr_number" >>"$GITHUB_ENV"
		if [[ -n "$pr_url" ]]; then
			echo "PR_URL=$pr_url" >>"$GITHUB_ENV"
		fi
	else
		# Fallback: try to get URL by branch name
		pr_url="$(gh pr view "$conflict_branch" --json url --jq '.url' 2>/dev/null || echo '')"
		if [[ -n "$pr_url" ]]; then
			echo "PR_URL=$pr_url" >>"$GITHUB_ENV"
		fi
	fi

	# Request review from owner and copilot
	if [[ -n "$pr_number" ]]; then
		log "Requesting review from repository owner and $pr_reviewer"
		repo_owner="$(gh repo view --json owner --jq '.owner.login' 2>/dev/null || echo '')"
		current_user="$(gh api user --jq '.login' 2>/dev/null || echo '')"

		# Request review from owner only if they're not the current user
		if [[ -n "$repo_owner" && -n "$current_user" && "$repo_owner" != "$current_user" ]]; then
			gh pr review-request "$pr_number" --add "$repo_owner" >/dev/null 2>&1 || true
		fi

		# Request review from configured reviewer (e.g., github-copilot)
		if [[ -n "$pr_reviewer" && "$pr_reviewer" != "$current_user" ]]; then
			gh pr review-request "$pr_number" --add "$pr_reviewer" >/dev/null 2>&1 || true
		fi
	fi

	echo "MERGE_LOG_PATH=$merge_log" >>"$GITHUB_ENV"
	echo "SYNC_OUTCOME=merge_conflict_pr_created" >>"$GITHUB_ENV"

	if [[ -n "$pr_url" ]]; then
		log "Conflict PR created: $pr_url"
	else
		log "Conflict PR created for branch $conflict_branch"
	fi
	exit 0
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

log "Pushing $sync_branch to $fork_remote (LFS pointers only)"
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
