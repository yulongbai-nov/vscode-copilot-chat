# Simulation Cache LFS Guide

The simulator relies on large SQLite cache files stored in Git LFS under `test/simulation/cache`. Only the upstream repository (`microsoft/vscode-copilot-chat`) should host the full cache history. This guide explains how to hydrate the cache locally or in CI without consuming your fork's LFS quota, and how to keep new cache layers out of the fork entirely.

## Cache Hydration Workflow

1. Ensure the upstream remote exists:
   ```pwsh
   git remote add upstream https://github.com/microsoft/vscode-copilot-chat.git
   ```
   Skip this command if the remote already exists.
2. Fetch the cache blobs from upstream:
   ```pwsh
   git lfs fetch upstream main --include="test/simulation/cache/*" --exclude=""
   ```
3. Check out the cache pointers into the working tree:
   ```pwsh
   git lfs checkout test/simulation/cache
   ```

The `script/postinstall.ts` task now performs these steps automatically when `base.sqlite` is missing. Run the commands manually if the automated fetch fails (for instance, if network access to GitHub is blocked). Re-run `npm install` afterwards.

### Continuous Integration

Add the following steps to CI pipelines before any build or test phases:

```yaml
- name: Hydrate simulation cache
  run: |
    git remote add upstream https://github.com/microsoft/vscode-copilot-chat.git || echo "upstream remote already present"
    git lfs fetch upstream main --include="test/simulation/cache/*" --exclude=""
    git lfs checkout test/simulation/cache
- name: Cache simulation artifacts
  uses: actions/cache@v4
  with:
    path: test/simulation/cache
    key: sim-cache-${{ hashFiles('test/simulation/cache/base.sqlite') }}
    restore-keys: |
      sim-cache-
```

Caching the hydrated directory keeps subsequent runs fast and removes the need to store the blobs in your fork.

## Pruning LFS Objects From Your Fork

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
   Or run the bundled helper:
   ```pwsh
   npm install
   npm run prune:simulation-cache -- --yes
   ```
3. Force-push the rewritten history:
   ```pwsh
   git push --force-with-lease origin main
   ```
4. Rehydrate the required cache files using the workflow above, then run:
   ```pwsh
   git lfs prune --recent
   ```
5. Notify collaborators to reclone the fork because history changed.

## Guardrails Against New Cache Layers

- The repository now contains `.github/workflows/cache-guard.yml`, which fails any push or pull request that modifies `test/simulation/cache/layers/**`.
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
