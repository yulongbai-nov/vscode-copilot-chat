#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
	echo "gh CLI is required" >&2
	exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

origin_branch="origin/main"
stack_branch="personal/main"
feature_branch="feature/type-hierarchy-tool"
fork_repo="yulongbai-nov/vscode-copilot-chat"
original_branch="$(git rev-parse --abbrev-ref HEAD)"
skip_sync="${SKIP_FORK_SYNC:-0}"
auto_strategy="${AUTO_RESOLVE_STRATEGY:-}"
simulate_conflict="${SIMULATE_CONFLICT:-0}"

cleanup() {
	if [[ -n "$original_branch" ]]; then
		git switch "$original_branch" >/dev/null 2>&1 || true
	fi
}

trap cleanup EXIT

if [[ "$skip_sync" != "1" ]]; then
	printf '==> Syncing fork %s\n' "$fork_repo"
	gh repo sync "$fork_repo" --branch main
else
	printf '==> Skipping fork sync (SKIP_FORK_SYNC=%s)\n' "$skip_sync"
fi

printf '==> Fetching upstream\n'
git fetch origin

git config rerere.enabled true
git config rerere.autoUpdate true

if [[ "$simulate_conflict" == "1" ]]; then
	printf 'CONFLICT (simulated): type hierarchy maintenance failure requested via SIMULATE_CONFLICT\n' >&2
	exit 2
fi

if git show-ref --verify --quiet "refs/remotes/origin/$feature_branch"; then
	if git show-ref --verify --quiet "refs/heads/$feature_branch"; then
		git switch "$feature_branch"
		git reset --hard "origin/$feature_branch"
	else
		git switch -c "$feature_branch" "origin/$feature_branch"
	fi
else
	echo "Missing remote branch origin/$feature_branch" >&2
	exit 1
fi

if ! git show-ref --verify --quiet "refs/heads/$stack_branch"; then
	printf '==> Bootstrapping %s from %s\n' "$stack_branch" "$feature_branch"
	git branch "$stack_branch" "$feature_branch"
fi

git rebase "$stack_branch"
run_rebase() {
	local target=$1
	local base=$2

	printf '==> Rebasing %s onto %s\n' "$target" "$base"
	git switch "$target"
	if [[ -z "$auto_strategy" ]]; then
		git rebase "$base"
		return
	fi

	if git rebase "$base"; then
		return
	fi

	printf '==> Conflict encountered; retrying with strategy-option %s\n' "$auto_strategy"
	git rebase --abort >/dev/null 2>&1 || true
	git rebase --strategy=recursive --strategy-option="$auto_strategy" "$base"
}

run_rebase "$stack_branch" "$origin_branch"
run_rebase "$feature_branch" "$stack_branch"

printf '==> Running typecheck\n'
npm run typecheck

printf '\n✅ type hierarchy stack rebased and validated\n'
