# LFS Cache Cleanup Handoff

## Current Status
- Repository: `vscode-copilot-chat` (fork `origin`), branch `prompt-section-vis`
- All Git LFS storage quotas are exhausted; cloning fails on `test/simulation/cache/base.sqlite`.
- Local workspace contains many layer cache files under `test/simulation/cache/layers/`. `git lfs ls-files --size` shows ~55 tracked SQLite blobs (~160 MB).
- Upstream (`microsoft/vscode-copilot-chat`) still contains the full set of layer files, so syncing pulls them all.

## Recent Findings
- GitHub LFS quota is consumed per repository owner; forking upstream inherits its LFS history (~160 MB).
- Both local fork and upstream maintain the same cache layers (e.g. `test/simulation/cache/layers/<uuid>.sqlite`).
- `git diff upstream/main origin/prompt-section-vis --stat test/simulation/cache` indicates only two layer files are missing locally due to quota errors.
- Ideal plan: retain only the latest baseline (`base.sqlite`) and at most two layer snapshots, rewriting history to drop older ones.

## Recommended Next Steps
1. **Prepare Clean Clone**
   - Clone with `git lfs install --skip-smudge` to avoid failing on quota.
   - Ensure no background watchers are updating files.

2. **History Rewrite**
   - Use `git filter-repo --path test/simulation/cache --force` with a custom script to remove older layer files while keeping the latest.
   - Alternatively, remove the entire `test/simulation/cache/layers` history and re-add just the final needed copies.
   - Coordinate with the team before force-pushing.

3. **Post-Rewrite Validation**
   - Rehydrate the remaining LFS blob(s) locally.
   - Run `npm run simulate-ci` to ensure the simulator still works with the reduced cache set.
   - Document new procedures for future cache updates (e.g., refresh only once per release).

## Open Questions / Decisions Needed
- Confirm exactly which cache files must stay (e.g., only `base.sqlite` + latest layer, or regenerate on demand).
- Decide whether the fork should continue tracking upstream `main`; pulling will reintroduce large blobs unless filtered regularly.

## Artifacts
- `docs/simulation-cache-lfs-guide.md`: summarizes best practices and regeneration workflow.
- `lfs_files.json` / `lfs_files_all.json`: generated lists of current and historical LFS objects.

## Coordination Notes
- Handoff recipient should plan for a force-push; inform collaborators to reclone post-cleanup.
- Upstream sync should be paused until the cleanup strategy is finalized to avoid reintroducing large blobs.

Use this document when resuming the LFS cleanup effort to avoid losing context and to ensure consistent next steps.
