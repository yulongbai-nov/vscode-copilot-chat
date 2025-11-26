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

commit_without_hooks() {
	HUSKY=0 LINT_STAGED=0 git commit "$@"
}

gh_repo_cmd() {
	if [[ -n "$fork_repo_slug" ]]; then
		GH_REPO="$fork_repo_slug" gh "$@"
	else
		gh "$@"
	fi
}

append_env() {
	printf '%s=%s\n' "$1" "$2" >>"$GITHUB_ENV"
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

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ -z "${GITHUB_ENV:-}" ]]; then
	export GITHUB_ENV="$repo_root/.github/tmp/github-env-$(date +%s)"
	mkdir -p "$(dirname "$GITHUB_ENV")"
	log "Using local GITHUB_ENV at $GITHUB_ENV"
fi

log_dir="${SYNC_LOG_DIR:-$repo_root/.github/tmp/sync-logs}"
mkdir -p "$log_dir"

sync_branch="${SYNC_BRANCH:-automation/nightly-upstream-merge}"
sanitized_branch="${sync_branch//\//-}"
merge_log="$log_dir/merge-${sanitized_branch}-$(date +%s).log"
touch "$merge_log"
append_env MERGE_LOG_PATH "$merge_log"
append_env SYNC_LOG_DIR "$log_dir"
exec > >(tee -a "$merge_log")
exec 2>&1

upstream_commit_log="$log_dir/upstream-commits-${sanitized_branch}-$(date +%s).log"
: >"$upstream_commit_log"
append_env UPSTREAM_LOG_PATH "$upstream_commit_log"

target_branch="${TARGET_BRANCH:-main}"
fork_remote="${FORK_REMOTE:-origin}"
upstream_remote="${UPSTREAM_REMOTE:-upstream}"
upstream_repo="${UPSTREAM_REPO:-microsoft/vscode-copilot-chat}"
upstream_branch="${UPSTREAM_BRANCH:-main}"
fork_repo_slug="${FORK_REPO_SLUG:-}"
pr_title="${PR_TITLE:-Nightly upstream merge sync}"
pr_body_header="${PR_BODY:-Automated nightly merge of upstream main into fork main.}"
pr_reviewer="${PR_REVIEWER:-github-copilot}"
cleanup_branch="${CLEANUP_BRANCH_ON_MERGE:-1}"
cleanup_on_no_changes="${CLEANUP_BRANCH_ON_NO_CHANGES:-1}"
conflict_mode="${MERGE_CONFLICT_MODE:-commit}"

dry_run_flag="${DRY_RUN:-false}"
dry_run_flag="${dry_run_flag,,}"

if [[ "$conflict_mode" != "commit" && "$conflict_mode" != "report" ]]; then
	printf 'Unsupported MERGE_CONFLICT_MODE value: %s (expected commit or report)\n' "$conflict_mode" >&2
	exit 3
fi

check_gh_token() {
	set +e
	local auth_output
	auth_output="$(gh auth status 2>&1)"
	local status=$?
	set -e
	if [[ "$status" -ne 0 ]]; then
		printf '%s\n' "$auth_output" >&2
		printf 'GitHub CLI is not authenticated. Provide GH_TOKEN with repo scope.\n' >&2
		exit 2
	fi
}

check_gh_token

log "Configuring Git for pointer-only sync"
git config lfs.allowincompletepush true
GIT_LFS_SKIP_SMUDGE=1 git lfs install --local --skip-smudge >/dev/null 2>&1 || true
export GIT_LFS_SKIP_SMUDGE=1

if [[ -z "$fork_repo_slug" ]]; then
	fork_remote_url="$(git remote get-url "$fork_remote" 2>/dev/null || true)"
	if [[ -n "$fork_remote_url" ]]; then
		fork_repo_slug="$(extract_github_slug "$fork_remote_url")"
	fi
fi

append_env SYNC_OUTCOME ""

ensure_upstream_remote() {
	local upstream_url="https://github.com/${upstream_repo}.git"
	if git remote get-url "$upstream_remote" >/dev/null 2>&1; then
		git remote set-url "$upstream_remote" "$upstream_url"
	else
		git remote add "$upstream_remote" "$upstream_url"
	fi
}

cleanup_sim_cache_artifacts() {
	local removed=0
	while IFS= read -r -d '' path; do
		log "Dropping simulation cache artifact from index: $path"
		git rm --cached -f -- "$path" >/dev/null
		removed=1
	done < <(git ls-files -z -- 'test/simulation/cache/*.sqlite' 'test/simulation/cache/layers/*.sqlite')

	if [[ -d test/simulation/cache/layers ]]; then
		find test/simulation/cache/layers -type f -name '*.sqlite' -print -delete 2>/dev/null | while IFS= read -r file; do
			log "Removed untracked simulation cache layer $file"
		done || true
		git clean -fd -- test/simulation/cache/layers >/dev/null 2>&1 || true
	fi

	if [[ "$removed" -eq 1 ]]; then
		log "Simulation cache artifacts stripped from index"
	else
		log "No simulation cache artifacts staged"
	fi
}

cleanup_tmp_artifacts() {
	if git ls-files -z -- '.github/tmp' '.github/tmp/*' | grep -q .; then
		log "Removing .github/tmp artifacts from index"
		git rm -r --cached --force -- '.github/tmp' >/dev/null 2>&1 || true
	fi
}

close_stale_pr() {
	local existing_pr
	existing_pr="$(gh_repo_cmd pr list --head "$sync_branch" --base "$target_branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)"
	if [[ -n "$existing_pr" ]]; then
		log "Closing stale PR #$existing_pr"
		gh_repo_cmd pr close "$existing_pr" --comment "Automation closed this PR because no changes are required." >/dev/null 2>&1 || true
		if [[ "$cleanup_on_no_changes" == "1" ]]; then
			log "Deleting remote branch $sync_branch"
			git push "$fork_remote" --delete "$sync_branch" >/dev/null 2>&1 || true
		fi
	fi
}

ensure_upstream_remote

log "Fetching $upstream_remote/$upstream_branch"
GIT_LFS_SKIP_SMUDGE=1 git fetch "$upstream_remote" "$upstream_branch"

log "Fetching $fork_remote/$target_branch"
GIT_LFS_SKIP_SMUDGE=1 git fetch "$fork_remote" "$target_branch"

log "Preparing branch $sync_branch from $fork_remote/$target_branch"
GIT_LFS_SKIP_SMUDGE=1 git switch -C "$sync_branch" "$fork_remote/$target_branch"

log "Collecting upstream commit summary"
git log --oneline "$fork_remote/$target_branch".."$upstream_remote/$upstream_branch" >"$upstream_commit_log"

if [[ ! -s "$upstream_commit_log" ]]; then
	log "No new upstream commits to merge"
	close_stale_pr
	append_env SYNC_OUTCOME no_changes
	if [[ "$dry_run_flag" != "true" ]]; then
		git push "$fork_remote" --delete "$sync_branch" >/dev/null 2>&1 || true
	fi
	exit 0
fi

log "Merging $upstream_remote/$upstream_branch into $sync_branch (mode: $conflict_mode)"
set +e
GIT_MERGE_AUTOEDIT=no git merge --no-ff --no-commit "$upstream_remote/$upstream_branch"
merge_status=$?
set -e

collect_conflicted_files() {
	git diff --name-only --diff-filter=U | sed 's/^/- /'
}

write_conflict_report() {
	local files="$1"
	local report_path="$log_dir/conflict-report-${sanitized_branch}-$(date +%s).md"
	{
		echo "# Merge conflict report"
		echo ""
		echo "* Upstream: ${upstream_remote}/${upstream_branch} ($(git rev-parse --short "$upstream_remote/$upstream_branch"))"
		echo "* Target: ${fork_remote}/${target_branch} ($(git rev-parse --short "$fork_remote/$target_branch"))"
		echo "* Strategy: ${conflict_mode}"
		echo ""
		echo "## Conflicted files"
		if [[ -n "$files" ]]; then
			echo "$files"
		else
			echo "(none detected)"
		fi
		echo ""
		echo "## Next steps"
		echo "1. Fetch \"${sync_branch}\""
		echo "2. Re-run the merge locally"
		echo "3. Resolve the conflicts and push updates"
	} >"$report_path"
	append_env CONFLICT_REPORT_PATH "$report_path"
	log "Wrote conflict report to $report_path"
}

handle_conflicts_commit() {
	local files
	files="$(collect_conflicted_files || true)"
	write_conflict_report "$files"
	log "Conflicts detected; staging current merge state"
	git status --short || true
	git add -A
	cleanup_sim_cache_artifacts
	cleanup_tmp_artifacts
	log "Creating conflicted merge commit"
	commit_without_hooks --allow-empty --no-edit
	append_env SYNC_OUTCOME merge_conflict_committed
}

handle_conflicts_report() {
	local files
	files="$(collect_conflicted_files || true)"
	write_conflict_report "$files"
	log "Conflicts detected; aborting merge (report mode)"
	git merge --abort
	append_env SYNC_OUTCOME merge_conflict_reported
}

if [[ "$merge_status" -ne 0 ]]; then
	if [[ "$conflict_mode" == "commit" ]]; then
		handle_conflicts_commit
	else
		handle_conflicts_report
		if [[ "$dry_run_flag" != "true" ]]; then
			git push "$fork_remote" --delete "$sync_branch" >/dev/null 2>&1 || true
		fi
		exit 0
	fi
else
	cleanup_sim_cache_artifacts
	cleanup_tmp_artifacts
	log "Creating merge commit"
	commit_without_hooks --allow-empty --no-edit
	append_env SYNC_OUTCOME merge_completed
fi

log "Merge commit created: $(git rev-parse --short HEAD)"

prepare_pr_body() {
	local body="$pr_body_header"
	local upstream_context
	upstream_context="$(sed 's/^/- /' "$upstream_commit_log")"
	if [[ -n "$upstream_context" ]]; then
		body="$body"$'\n\n''Upstream commits:'$'\n'"$upstream_context"
	fi
	if [[ -n "${CONFLICT_REPORT_PATH:-}" && -f "${CONFLICT_REPORT_PATH:-}" ]]; then
		body="$body"$'\n\n''Conflict report excerpt:'$'\n'"$(sed 's/^/    /' "$CONFLICT_REPORT_PATH")"
	fi
	echo "$body"
}

push_and_update_pr() {
	if [[ "$dry_run_flag" == "true" ]]; then
		log "Dry run mode enabled; skipping push and PR updates"
		return
	fi

	log "Pushing $sync_branch to $fork_remote"
	git push "$fork_remote" "$sync_branch" --force-with-lease

	local existing_pr
	existing_pr="$(gh_repo_cmd pr list --head "$sync_branch" --base "$target_branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)"
	local pr_body
	pr_body="$(prepare_pr_body)"
	local outcome_label="${SYNC_OUTCOME:-merge_completed}"

	if [[ -n "$existing_pr" ]]; then
		log "Updating existing PR #$existing_pr"
		gh_repo_cmd pr edit "$existing_pr" --title "$pr_title" --body "$pr_body" >/dev/null
		if [[ "$outcome_label" != "merge_conflict_committed" ]]; then
			outcome_label=pr_updated
		fi
	else
		log "Creating PR from $sync_branch to $target_branch"
		gh_repo_cmd pr create --base "$target_branch" --head "$sync_branch" --title "$pr_title" --body "$pr_body" >/dev/null
		existing_pr="$(gh_repo_cmd pr view "$sync_branch" --json number --jq '.number' 2>/dev/null || true)"
		if [[ "$outcome_label" != "merge_conflict_committed" ]]; then
			outcome_label=pr_created
		fi
	fi

	if [[ -n "$existing_pr" ]]; then
		append_env PR_NUMBER "$existing_pr"
		local pr_url
		pr_url="$(gh_repo_cmd pr view "$existing_pr" --json url --jq '.url' 2>/dev/null || true)"
		if [[ -n "$pr_url" ]]; then
			append_env PR_URL "$pr_url"
		fi
		if [[ -n "$pr_reviewer" ]]; then
			log "Requesting review from $pr_reviewer"
			gh_repo_cmd pr review-request "$existing_pr" --add "$pr_reviewer" >/dev/null 2>&1 || true
		fi
		if [[ "$cleanup_branch" == "1" ]]; then
			local merged
			merged="$(gh_repo_cmd pr view "$existing_pr" --json merged --jq '.merged' 2>/dev/null || echo false)"
			if [[ "$merged" == "true" ]]; then
				log "PR #$existing_pr already merged; deleting remote branch $sync_branch"
				git push "$fork_remote" --delete "$sync_branch" >/dev/null 2>&1 || true
			fi
		fi
	fi

	append_env SYNC_OUTCOME "$outcome_label"
}

push_and_update_pr

current_outcome="$(grep -E '^SYNC_OUTCOME=' "$GITHUB_ENV" | tail -n1 | cut -d'=' -f2)"
log "Sync completed with outcome ${current_outcome:-unknown}"
