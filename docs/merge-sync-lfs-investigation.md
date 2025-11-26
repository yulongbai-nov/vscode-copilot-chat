# Merge Sync + Git LFS Investigation

## Summary
- Merge-based nightly workflow failed with `GH008` even after stripping cache files.
- The merge helper removes `test/simulation/cache/**/*.sqlite` from each merge commit, but GitHub validates **all** parents: upstream commits still reference cache layers.
- Because this repo was not a registered fork of `microsoft/vscode-copilot-chat`, GitHub's LFS store did not contain those upstream blobs, so pushes were rejected unless we uploaded them ourselves.
- Now that `origin` is a true fork, GitHub can reuse upstream LFS objects once the workflow lands here. Before the conversion, the only alternatives were uploading the blobs (breaking pointer-only policy) or squashing history.

## Evidence
1. Local dry-run merges show no `.sqlite` files (`git ls-tree -r automation/nightly-merge-debug | grep ".sqlite"` yields nothing).
2. Remote push still failed with:
   ```
   Git LFS upload missing objects:
     (missing) test/simulation/cache/layers/c451045a-da8c-43fa-ba6f-8198c2eb0975.sqlite (0349…)
     (missing) test/simulation/cache/layers/70406ad0-1fbd-47a0-9b72-6b80e3b3d46b.sqlite (d4ec…)
   remote: error: GH008: Your push referenced at least 2 unknown Git LFS objects
   ```
3. `gh repo view --json isFork,parent` returned `isFork: false` before the conversion, confirming GitHub had no linkage to upstream's LFS store.

## Options Considered
1. **Upload missing blobs** – fetch upstream cache layers via `git lfs fetch upstream main --include='test/simulation/cache/**/*.sqlite'` and push them. This works but breaks the pointer-only fork policy and consumes LFS quota.
2. **Convert the repo into a genuine fork (chosen)** – either recreate via the Fork button or ask GitHub Support to convert/copy LFS objects. Once GitHub recognizes the fork relationship, merge commits referencing upstream blobs push cleanly.
3. **Return to squash merges** – avoid pushing upstream commits entirely. This keeps the fork pointer-only but loses upstream history and accurate summaries.

## Next Steps
- Keep this doc as a reference for why the workflow must run on a real fork.
- Proceed with replaying custom commits (see `docs/unique-fork-commits.txt`). Start with workflow/automation changes, then reintroduce product logic in well-scoped batches via `git cherry-pick` or `git format-patch`.
