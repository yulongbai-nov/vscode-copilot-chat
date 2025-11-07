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

extract_github_slug() {
	local url="${1:-}"
	url="${url%.git}"
	if [[ "$url" =~ github\.com[:/]+([^/]+/[^/]+)$ ]]; then
		echo "${BASH_REMATCH[1]}"
	fi
}

require_cmd git
require_cmd gh
require_cmd git-lfs

if [[ -z "${GH_TOKEN:-}" ]]; then
	printf 'GH_TOKEN is not set; provide a token with `repo` scope.\n' >&2
	exit 2
fi

if [[ -z "${GITHUB_ENV:-}" ]]; then
	export GITHUB_ENV="${repo_root:-$(pwd)}/.github/tmp/github-env-$(date +%s)"
	mkdir -p "$(dirname "$GITHUB_ENV")"
	log "Using local GITHUB_ENV at $GITHUB_ENV"
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
fork_repo_slug="${FORK_REPO_SLUG:-}"
pr_title="${PR_TITLE:-Nightly upstream merge}"
pr_body_header="${PR_BODY:-Automated nightly merge of upstream main into fork main.}"
pr_reviewer="${PR_REVIEWER:-github-copilot}"
cleanup_branch="${CLEANUP_BRANCH_ON_MERGE:-1}"
cleanup_on_no_changes="${CLEANUP_BRANCH_ON_NO_CHANGES:-1}"
log_dir="${SYNC_LOG_DIR:-$repo_root/.github/tmp}"
cache_cleanup_commit_msg="${CACHE_CLEANUP_COMMIT_MSG:-Strip simulation cache artifacts}"

if [[ -z "${GITHUB_ENV:-}" ]]; then
	GITHUB_ENV="$log_dir/github-env-$(date +%s).log"
	mkdir -p "$(dirname "$GITHUB_ENV")"
	log "Using local GITHUB_ENV at $GITHUB_ENV"
fi

log "Configuring Git LFS for pointer-only workflow"
git lfs install --local --skip-smudge >/dev/null 2>&1 || true

if [[ -z "$fork_repo_slug" ]]; then
	fork_remote_url="$(git remote get-url "$fork_remote" 2>/dev/null || true)"
	if [[ -n "$fork_remote_url" ]]; then
		fork_repo_slug="$(extract_github_slug "$fork_remote_url")"
	fi
fi

if [[ -n "$fork_repo_slug" && -z "${GH_REPO:-}" ]]; then
	export GH_REPO="$fork_repo_slug"
	log "Using GH_REPO=$GH_REPO for GitHub CLI operations"
fi

strip_simulation_cache_payloads() {
	local commit_mode="${1:-amend}"
	local commit_msg="${2:-$cache_cleanup_commit_msg}"
	local removed=0
	STRIP_SIM_CACHE_REMOVED=0
	while IFS= read -r -d '' path; do
		if [[ -n "$path" ]]; then
			log "Removing simulation cache LFS artifact $path"
			git rm -f -- "$path" >/dev/null
			removed=1
		fi
	done < <(git ls-files -z -- 'test/simulation/cache/*.sqlite' 'test/simulation/cache/layers/*.sqlite')

	if [[ "$removed" -eq 1 ]]; then
		mkdir -p test/simulation/cache/layers
		case "$commit_mode" in
			commit)
				log "Creating dedicated cache cleanup commit"
				git commit -m "$commit_msg" >/dev/null
				;;
			none)
				log "Staged simulation cache cleanup without committing"
				;;
			*)
				log "Amending merge commit to drop simulation cache LFS artifacts"
				git commit --amend --no-edit >/dev/null
				;;
		esac
		STRIP_SIM_CACHE_REMOVED=1
	else
		log "No simulation cache LFS artifacts detected"
	fi

	return 0
}

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
GIT_LFS_SKIP_SMUDGE=1 git switch -C "$sync_branch" "$fork_remote/$target_branch"


snapshot_patch="$log_dir/upstream-snapshot-$(date +%s).patch"
upstream_commit_log="$log_dir/upstream-commits-$(date +%s).log"
git log --oneline "$fork_remote/$target_branch".."$upstream_remote/$upstream_branch" >"$upstream_commit_log"
git diff --binary "$fork_remote/$target_branch" "$upstream_remote/$upstream_branch" -- . ':!test/simulation/cache/**' >"$snapshot_patch"

if [[ ! -s "$snapshot_patch" ]]; then
	log "No changes detected between fork and upstream (excluding simulation cache)"
	strip_simulation_cache_payloads

	if git diff --quiet "$fork_remote/$target_branch"...HEAD; then
		log "Branch already matches target; nothing to push"
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
fi

log "Applying upstream snapshot onto $sync_branch"
if git apply --3way "$snapshot_patch"; then
	log "Patch applied cleanly"
	git add -A
	strip_simulation_cache_payloads
	if git diff --cached --quiet; then
		log "No staged changes after applying upstream snapshot"
		echo "SYNC_OUTCOME=no_changes" >>"$GITHUB_ENV"
		exit 0
	fi
	upstream_hash="$(git rev-parse --short "$upstream_remote/$upstream_branch")"
	commit_msg="Sync upstream snapshot ${upstream_hash}"
	git commit -m "$commit_msg"
else
	log "Patch application encountered conflicts; preparing conflict branch"
	upstream_hash="$(git rev-parse --short "$upstream_remote/$upstream_branch")"
	conflict_branch="automation/nightly-sync-conflict-${upstream_hash}"
	git status --short
	conflicted_files="$(git status --short | awk '$1 ~ /U|AA|DD/ {print $2}' | sed 's/^/- /' || echo '- error: could not detect conflicted files')"
	git add -A
	conflict_msg="Upstream snapshot conflicts from ${upstream_hash}

This automated snapshot encountered conflicts while applying upstream changes.
Please review and resolve the conflicts manually.

Conflicted files:
${conflicted_files}

Source: ${upstream_remote}/${upstream_branch} (${upstream_hash})
Target: ${fork_remote}/${target_branch}"

	if ! git commit -m "$conflict_msg" --no-edit; then
		log "Failed to commit conflicted snapshot"
		echo "SYNC_OUTCOME=snapshot_conflict_commit_failed" >>"$GITHUB_ENV"
		exit 91
	fi

	strip_simulation_cache_payloads commit "$cache_cleanup_commit_msg"

	log "Pushing conflict branch $conflict_branch to $fork_remote"
	if ! git push "$fork_remote" "HEAD:$conflict_branch" --force-with-lease; then
		log "Failed to push conflict branch with force-with-lease; trying with --force"
		if ! git push "$fork_remote" "HEAD:$conflict_branch" --force; then
			log "Failed to push conflict branch; cannot create PR without remote branch"
			echo "SYNC_OUTCOME=snapshot_conflict_push_failed" >>"$GITHUB_ENV"
			exit 92
		fi
	fi

	conflict_pr_title="[CONFLICT] ${pr_title} (${upstream_hash})"
	conflict_pr_body="⚠️ **This PR contains conflicts that need manual resolution.**

${pr_body_header}

## Conflict Details

**Upstream commit**: \`${upstream_hash}\`
**Source**: \`${upstream_remote}/${upstream_branch}\`
**Target**: \`${fork_remote}/${target_branch}\`

### Conflicted Files

${conflicted_files}

### Upstream commits included

$(sed 's/^/- /' "$upstream_commit_log")

### Next Steps

1. Check out this branch locally
2. Resolve the conflicts in the listed files
3. Test the changes
4. Commit and push the resolution
5. Merge this PR once conflicts are resolved
"

	pr_number="$(gh pr list --head "$conflict_branch" --base "$target_branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)"

	if [[ -n "$pr_number" ]]; then
		log "Updating existing conflict PR #$pr_number"
		gh pr edit "$pr_number" --title "$conflict_pr_title" --body "$conflict_pr_body" >/dev/null
	else
		log "Creating conflict PR from $conflict_branch to $target_branch"
		gh pr create --base "$target_branch" --head "$conflict_branch" --title "$conflict_pr_title" --body "$conflict_pr_body" >/dev/null
		pr_number="$(gh pr view "$conflict_branch" --json number --jq '.number' 2>/dev/null || gh pr list --head "$conflict_branch" --base "$target_branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)"
		if [[ -z "$pr_number" ]]; then
			log "Warning: Could not retrieve PR number immediately after creation"
		fi
	fi

	if [[ -n "$pr_number" ]]; then
		pr_url="$(gh pr view "$pr_number" --json url --jq '.url' 2>/dev/null || echo '')"
		echo "PR_NUMBER=$pr_number" >>"$GITHUB_ENV"
		if [[ -n "$pr_url" ]]; then
			echo "PR_URL=$pr_url" >>"$GITHUB_ENV"
		fi
	fi

	if [[ -n "$pr_reviewer" && -n "$pr_number" ]]; then
		log "Requesting review from $pr_reviewer"
		gh pr review-request "$pr_number" --add "$pr_reviewer" >/dev/null 2>&1 || true
	fi

	echo "SYNC_OUTCOME=snapshot_conflict_pr_created" >>"$GITHUB_ENV"
	echo "MERGE_LOG_PATH=$merge_log" >>"$GITHUB_ENV"
	echo "UPSTREAM_LOG_PATH=$upstream_commit_log" >>"$GITHUB_ENV"
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

log "Pushing $sync_branch to $fork_remote (snapshot commit)"
git push "$fork_remote" "$sync_branch" --force-with-lease

changes="$(git log --oneline "$fork_remote/$target_branch"..HEAD | sed 's/^/- /')"
pr_body="$pr_body_header"
if [[ -n "$changes" ]]; then
	pr_body="$pr_body"$'\n\n'"Upstream snapshot commit:"$'\n'"$changes"
fi

upstream_context="$(sed 's/^/- /' "$upstream_commit_log")"
if [[ -n "$upstream_context" ]]; then
	pr_body="$pr_body"$'\n\n'"Upstream history:"$'\n'"$upstream_context"
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
