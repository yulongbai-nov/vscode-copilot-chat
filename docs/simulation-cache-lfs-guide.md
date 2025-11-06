# Simulation Cache LFS Guide

This document captures the current state of the simulation cache (`test/simulation/cache/base.sqlite`) and outlines strategies for managing it under a limited Git LFS quota.

## What the cache is for
- `base.sqlite` is a Brotli-compressed Keyv/SQLite database that replays cached ChatML, embeddings, chunking, and code/doc search responses during simulation runs.
- The test harness mounts it through `Cache` in `test/base/cache.ts`; every simulation invocation assumes the file exists.
- `script/postinstall.ts` hard-fails if the file is missing, because CI and local installs require a populated cache to avoid real network calls.

## Why the file lives in Git LFS
- The cache is ~20 MB and updated periodically. Keeping it in LFS avoids bloating the regular Git history.
- Every baseline-ready commit must ship a working cache so that `npm install` and `npm run simulate` succeed offline.

## Quota pressure recap
- GitHub retains **all historical LFS blobs** referenced by any commit. Each cache refresh adds a new 20 MB blob.
- Reaching the quota blocks clones/pulls (Git LFS smudge errors) until storage is freed or the quota is increased.

## Recommended maintenance workflow
1. **Stage new data intentionally**
   - Run `npm run simulate -- --skip-cache --stage-cache-entries` (with valid service credentials) to record new responses in `test/simulation/cache/layers/<uuid>.sqlite`.
2. **Compact into a single baseline**
   - Run `npm run simulate -- --require-cache --gc --stage-cache-entries`. `Cache.gcEnd()` merges only the exercised keys into `_base.sqlite`, replaces `base.sqlite`, and removes layer files.
3. **Validate baselines**
   - Re-run `npm run simulate -- --require-cache` (or CI equivalents) to confirm no cache misses and that `baseline.json` remains consistent. Update baselines if needed.
4. **Commit the new cache once**
   - Ensure only the refreshed `base.sqlite` is staged; delete stray layer files from Git (`.gitignore` already covers `_base.sqlite`).

## Strategies to stay within quota
- **Minimize refresh frequency**: Regenerate the cache only when simulation results change or responses expire, not on every PR.
- **Audit before pushing**: `git status` should show only one `base.sqlite` change; avoid staging temporary layer databases.
- **Garbage-collect unused entries**: Always use the GC flag when regenerating so obsolete keys are dropped before committing.
- **Coordinate refreshes**: Have one person own cache updates per release, reducing duplicate 20 MB blobs.
- **Prune local LFS copies**: `git lfs prune` reclaims space in developer clones (this does not affect remote quota but keeps machines tidy).

## If the quota is exceeded
- **Short term**: Set `git config lfs.fetchexclude "test/simulation/cache/base.sqlite"` or `git lfs install --skip-smudge` to work without hydrating blobs, but simulations will fail.
- **Medium term**: Rewrite history to drop outdated blobs (see below) or move the cache elsewhere.
- **Long term**: Purchase additional LFS storage if the cache must remain versioned forever.

## History rewrite playbook (last resort)
> ⚠️ Force-pushing `main` requires coordination with every contributor.

1. Clone a fresh repo with `git lfs install --skip-smudge` so checkout succeeds even when LFS quota is exceeded.
2. Use `git filter-repo` (preferred) or `git lfs migrate export --include="test/simulation/cache/base.sqlite"` to strip legacy blobs.
3. Add the current `base.sqlite` back (or generate a new one) and commit.
4. Force-push with `git push --force-with-lease origin main` once the team is ready.
5. Have every collaborator reclone or `git fetch --all && git reset --hard origin/main` to sync with the rewritten history.

## Alternatives to Git LFS
- **On-demand generation**: Store only generator scripts; in CI/dev, create the cache before simulation runs. Adds setup time but removes LFS usage.
- **External artifact service**: Publish the cache to a storage bucket or release asset and download it during setup. Keep the path ignored in Git and load dynamically at runtime.
- **Split caches**: Track smaller, feature-specific caches and load only what a test suite needs, reducing blob size.

## Operational checklist
- [ ] Need to refresh cache? Confirm with the team.
- [ ] Run `--skip-cache --stage-cache-entries` followed by `--require-cache --gc`.
- [ ] Validate simulations and baselines.
- [ ] Stage only `test/simulation/cache/base.sqlite`.
- [ ] Document the update in PR notes (mention quota impact).

Keeping the cache lean and coordinating refreshes are the easiest ways to avoid LFS quota surprises.
