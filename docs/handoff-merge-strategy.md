# Fork Sync & Feature Integration Handoff

## Context & Goals
- **Real fork baseline**: `yulongbai-nov/vscode-copilot-chat` is now a true fork of `microsoft/vscode-copilot-chat`. Upstream LFS blobs are available server-side, so merge commits that reference upstream caches no longer trigger GH008 (see commit `2acda308`).
- **Pointer-only policy**: We still avoid storing cache payloads locally. `script/sync-fork-merge.sh` strips every `test/simulation/cache/*.sqlite` file before committing (commits `2acda308`, `c0f1ae73`, `b153aecb`). Nightly PRs must never contain cache blobs.
- **Workflow alignment**: PR #2 restored all CI workflows to the exact configs we had in `chat-no-lfs` (commits `09f498e0`, `cfccca78`, `c0f1ae73`, `b153aecb`). Self-hosted runners and the cache guard prevent regressions.
- **Trusted cache updates**: PR #6 (`6613d57d`) allows `yulongbai-nov` and `github-actions[bot]` to pass the cache guard (useful for nightly automation). Everyone else must still be both collaborators and signed.

## Nightly Merge Strategy
1. **Workflow**: `.github/workflows/fork-nightly-merge-sync.yml` (commit `2acda308`) runs nightly and on demand.
   - Uses `script/sync-fork-merge.sh` to create real merge commits, capture upstream summaries, and push `automation/nightly-upstream-merge`.
   - Conflict strategy defaults to `commit`. Setting `MERGE_CONFLICT_MODE=report` will abort and post a conflict report.
2. **Cache hygiene**: Before committing/pushing, the script:
   - Runs `cleanup_sim_cache_artifacts` to unstage/delete every `.sqlite` file.
   - Removes `.github/tmp` artifacts to keep diffs clean.
3. **CI guard**: The PR workflow’s “Check test cache” job (`build/pr-check-cache-files.ts`) enforces:
   - Base cache file can only be modified (not deleted or added).
   - Layer files can only be added/removed by trusted, verified accounts (now includes `yulongbai-nov` + GitHub Actions bot).
4. **If GH008 reappears**: Ensure the workflow is running on `main` (commit `498339f5`). Old branches created before PR #2 may still carry cache files; delete and re-run the workflow.

## Feature Replay / Cherry-Pick Plan
`docs/unique-fork-commits.txt` lists every commit that existed in `chat-no-lfs` but not upstream.
1. **Batch commits by theme**:
   - **Automation & cache tooling**: up through `ff65a17c`.
   - **Prompt visualizer & chat API migrations**: `0edde636` – `050b52cb`.
   - **Type hierarchy tooling**: `60567a67` – `06b08aa3`.
2. **Process**:
   - Create a branch off `origin/main` for each batch.
   - `git cherry-pick <range>` from the `legacy` remote (already configured as `legacy/*`).
   - Resolve conflicts, run `npm run lint` / targeted tests, and push a PR.
   - Merge sequentially to keep history readable.
3. **Cache-aware merges**: When a cherry-picked commit touches `test/simulation/cache`, ensure it only modifies pointers or docs. Any commit that adds payloads must be rewritten to stage pointers only (see pattern in `ff65a17c`).

## Pushing & Permissions
- Use personal PATs for manual pushes (workflows already set `persist-credentials: false` + `git remote set-url origin https://$GH_TOKEN@...`).
- Keep `workflows: write` permissions off unless needed; the nightly job doesn’t require it now, since cache guard no longer blocks workflow edits.
- If GitHub Actions needs to push conflict branches, set `MERGE_CONFLICT_MODE=commit` (default) so conflict markers land in a merge commit without artificial squash commits.

## Action Items
1. **Retire old workflow branches**: Delete `automation/nightly-upstream-merge` branches created before `498339f5` to avoid stale cache diffs.
2. **Replay logic commits**: Work through `docs/unique-fork-commits.txt` in batches (automation → prompt/CLI → type-hierarchy). Track progress in the doc or GitHub Projects.
3. **Monitor nightly PRs**: If cache guard fails, confirm the branch was produced after PR #2; otherwise rerun the workflow.
4. **Communicate policy**: Ensure anyone pushing cache updates knows to run `script/hydrateSimulationCache.ts` and never commit payloads.

With these pieces in place, future feature work can proceed on the new fork without LFS regressions, while nightly merges maintain upstream parity.
