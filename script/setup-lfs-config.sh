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

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

log "Configuring Git LFS fetch settings in $repo_root/.git/config"

git config --local lfs.fetchrecentalways true
git config --local lfs.fetchrecentcommitsdays 7
git config --local lfs.fetchrecentrefsdays 7
git config --local lfs.fetchrecentremoterefs true

log "Current LFS fetch config:"
git config --local --get-regexp '^lfs\.fetchrecent'

log "Done."
