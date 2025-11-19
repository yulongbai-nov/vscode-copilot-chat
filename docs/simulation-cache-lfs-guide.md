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

## Fork without cache blobs

The fork intentionally drops every `*.sqlite` file before automation pushes a sync branch. `script/sync-fork-main-merge.sh` strips the cache directory from the merge commit, so the fork never references new Git LFS objects. Developers hydrate the cache on demand with `script/hydrateSimulationCache.ts`, which pulls both the pointer files and the payloads directly from `upstream/main` without touching fork storage.

Implications for maintainers:
- Cloning the fork yields an empty `test/simulation/cache/` (aside from the README). Run `npx --yes tsx script/hydrateSimulationCache.ts` before executing simulations or `npm install`.
- The hydrated SQLite files remain untracked thanks to `.gitignore`; use `git clean -xfd test/simulation/cache` to reclaim space when you are done.
- CI pipelines must run the hydration helper as part of their setup phase so the cache exists before tests.

Keep this policy in mind when reviewing sync PRs: a diff that reintroduces `*.sqlite` payloads indicates the strip step failed and should be investigated.

### Repository defaults disable automatic LFS fetches

The repo includes a `.lfsconfig` that sets:

```
[lfs]
    fetchrecentrefsdays = 0
    fetchrecentcommitsdays = 0
    fetchrecentremoterefs = false
    fetchrecentalways = false
    fetchexclude = *
```

Clones therefore skip all LFS hydration during `git pull`, `fetch`, or `checkout`. You must run `script/hydrateSimulationCache.ts` (or an equivalent manual `git lfs fetch --include="test/simulation/cache/*" --exclude=""`) any time you actually need the SQLite blobs. This keeps routine source control operations within the LFS quota while still allowing explicit cache downloads for tests.

## Cache hydration workflow

Run the helper script to hydrate the cache for the current branch:

```pwsh
npx --yes tsx script/hydrateSimulationCache.ts
```

The script ensures the `upstream` remote exists (adding it when missing), fetches the latest `upstream/main`, computes the merge base with your branch, and pulls only the LFS objects reachable from that commit. `script/postinstall.ts` invokes the same helper automatically during `npm install` when `base.sqlite` is missing.

If the helper fails (for example, due to restricted network access), perform the steps manually:

```pwsh
git remote add upstream https://github.com/microsoft/vscode-copilot-chat.git  # if needed
git fetch upstream main
$mergeBase = git merge-base HEAD upstream/main
git lfs fetch upstream $mergeBase --include="test/simulation/cache/*" --exclude=""
git lfs checkout test/simulation/cache
```

Re-run `npm install` afterwards so the postinstall checks succeed.

### Continuous integration

Add the following steps to CI pipelines before any build or test phases:

```yaml
- name: Hydrate simulation cache
  run: npx --yes tsx script/hydrateSimulationCache.ts
- name: Cache simulation artifacts
  uses: actions/cache@v4
  with:
    path: test/simulation/cache
    key: sim-cache-${{ hashFiles('test/simulation/cache/base.sqlite') }}
    restore-keys: |
      sim-cache-
```

Caching the hydrated directory keeps subsequent runs fast and removes the need to store the blobs in your fork.

## Pruning LFS objects from your fork

To drop historical cache layers from the fork entirely:

1. Clone the fork with LFS smudge disabled to avoid download failures:
   ```pwsh
   git clone --filter=blob:none --config "filter.lfs.smudge=git-lfs smudge --skip" <your-fork-url> cleaned-fork
   ```
2. Enter the clone and rewrite history to remove cache layer payloads:
   ```pwsh
   cd cleaned-fork
   git filter-repo --path test/simulation/cache/layers --invert-paths --force
   ```
   Or run the bundled helper (use `--` twice so the flag reaches the script):
   ```pwsh
   npm install
   npm run prune:simulation-cache -- -- --yes
   ```
   If your shell still drops the flag, invoke `tsx` directly (this avoids npm mutating `package-lock.json`):
   ```pwsh
   node ./node_modules/tsx/dist/cli.js script/tools/pruneSimulationCache.ts --yes
   ```
   If a previous attempt added `"peer": true` entries to `package-lock.json`, reset it with `git checkout -- package-lock.json` before rerunning.
3. Force-push the rewritten history:
   ```pwsh
   git push --force-with-lease origin main
   ```
4. Rehydrate the required cache files using the workflow above, then run:
   ```pwsh
   git lfs prune --recent
   ```
5. Notify collaborators to reclone the fork because history changed.

## Guardrails against new cache layers

- The repository contains `.github/workflows/cache-guard.yml`, which fails any push or pull request that modifies `test/simulation/cache/layers/**`.
- `test/simulation/cache/layers/` is ignored in `.gitignore`, so locally generated layers stay out of staged changes.
- Developers can install a local pre-push hook to catch violations before hitting the remote:
  ```pwsh
  @"
  git diff --cached --name-only | Select-String '^test/simulation/cache/layers/'
  if ($?) {
      Write-Error 'Simulation cache layers must not be pushed. Fetch from upstream instead.'
      exit 1
  }
  "@ | Set-Content -Path .git/hooks/pre-push -Encoding ascii
  chmod +x .git/hooks/pre-push
  ```

With these safeguards in place, the fork stays lean while still allowing developers and CI jobs to obtain the simulator cache when needed.
