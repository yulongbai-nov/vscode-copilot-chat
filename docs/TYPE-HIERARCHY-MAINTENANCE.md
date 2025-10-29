# Type Hierarchy Maintenance Playbook

This note documents how to keep the customized type hierarchy tooling in sync with upstream without hand-merging every upgrade. It assumes the TypeScript-first flow implemented in [../src/platform/languages/vscode/languageFeaturesServicesImpl.ts#L78-L137](../src/platform/languages/vscode/languageFeaturesServicesImpl.ts#L78-L137) and [../src/platform/languages/typescript/vscode/typescriptTypeHierarchyProvider.ts#L32-L140](../src/platform/languages/typescript/vscode/typescriptTypeHierarchyProvider.ts#L32-L140).

For a feature-agnostic overview of the maintenance system, see [./FEATURE-MAINTENANCE-GUIDE.md](./FEATURE-MAINTENANCE-GUIDE.md).

```typescript
async prepareTypeHierarchy(uri: vscode.Uri, position: vscode.Position): Promise<vscode.TypeHierarchyItem[]> {
	const document = await this.tryGetDocument(uri);
	if (document && this.shouldUseTypeScriptProvider(document)) {
		this.updateTypeScriptSnapshot(document);
		this.fireTypeScriptTelemetry();
```

## Branch Layout
- Keep `origin` pointed at `microsoft/vscode-copilot-chat` and fork under `yulongbai-nov/vscode-copilot-chat`.
- Track a clean upstream branch locally:
  ```bash
  git fetch origin
  git switch -c main-upstream origin/main
  ```
- Maintain a long-lived integration branch that layers customizations:
  ```bash
  git switch main-upstream
  git branch --force personal/main main-upstream
  git switch personal/main
  git merge --ff-only feature/type-hierarchy-tool
  ```
- Feature work continues on topic branches (`feature/type-hierarchy-tool`) rebased onto `personal/main` before review.

## Routine Update Flow
1. Sync your fork with upstream using GitHub CLI:
   ```bash
   gh repo sync yulongbai-nov/vscode-copilot-chat --branch main
   ```
2. Refresh local tracking branches and enable automatic conflict reuse:
   ```bash
   git fetch origin
   git config rerere.enabled true
   git config rerere.autoUpdate true
   ```
3. Rebase the integration stack and update the feature branch:
   ```bash
   git switch personal/main
   git rebase origin/main
   git switch feature/type-hierarchy-tool
   git rebase personal/main
   ```
4. Run a quick validation before pushing:
   ```bash
   npm run typecheck
   ```
5. Push the updated branches to your fork:
   ```bash
   git push --force-with-lease origin feature/type-hierarchy-tool personal/main
   ```

## When Conflicts Appear
- Resolve each conflict once; `rerere` remembers your resolution the next time the same hunk reappears.
- Prefer extending existing customization files instead of editing shared upstream files to reduce future conflicts, e.g. keep TypeScript-specific helpers near [../src/platform/languages/typescript/vscode/typescriptTypeHierarchyProvider.ts#L169-L190](../src/platform/languages/typescript/vscode/typescriptTypeHierarchyProvider.ts#L169-L190).
- If upstream adds new capability entry points, integrate them in dedicated files (`src/extension/tools/node/typeHierarchyTool.ts`) and register through `allTools.ts` to keep diffs isolated.

## Patch Queue Fallback
When rebases become noisy, capture your adjustments as a patch series:
```bash
git switch personal/main
git format-patch origin/main --output-directory .git/patches/type-hierarchy
```
Apply them after syncing upstream:
```bash
git switch main-upstream
git reset --hard origin/main
git switch personal/main
git am --3way .git/patches/type-hierarchy/*.patch
```
This makes it obvious which patch fails and keeps history linear.

## Automated Update Script
The automation lives in [../script/update-type-hierarchy.sh#L1-L91](../script/update-type-hierarchy.sh#L1-L91). It now understands optional skip and conflict-strategy controls so the same entry point works for both humans and GitHub Actions; the entry guard is shown in [../script/update-type-hierarchy.sh#L17-L33](../script/update-type-hierarchy.sh#L17-L33):
```bash
skip_sync="${SKIP_FORK_SYNC:-0}"
auto_strategy="${AUTO_RESOLVE_STRATEGY:-}"
if [[ "$skip_sync" != "1" ]]; then
  printf '==> Syncing fork %s\n' "$fork_repo"
  gh repo sync "$fork_repo" --branch main
else
  printf '==> Skipping fork sync (SKIP_FORK_SYNC=%s)\n' "$skip_sync"
fi
```
When conflicts appear the helper retries with a strategy hint if `AUTO_RESOLVE_STRATEGY` is present; see [../script/update-type-hierarchy.sh#L65-L83](../script/update-type-hierarchy.sh#L65-L83):
```bash
run_rebase() {
  printf '==> Rebasing %s onto %s\n' "$target" "$base"
  git switch "$target"
  if git rebase "$base"; then
    return
  fi
  git rebase --abort >/dev/null 2>&1 || true
  git rebase --strategy=recursive --strategy-option="$auto_strategy" "$base"
}
```
Every run ends with a fast validation in [../script/update-type-hierarchy.sh#L88-L89](../script/update-type-hierarchy.sh#L88-L89):
```bash
printf '==> Running typecheck\n'
npm run typecheck
```
Mark it executable (`chmod +x script/update-type-hierarchy.sh`) and run whenever upstream advances. Set `AUTO_RESOLVE_STRATEGY=theirs` to bias toward upstream when you want the automated agent’s behavior locally, or `SKIP_FORK_SYNC=1` when iterating on an already-synced checkout.
To rehearse failure handling without touching upstream, set `SIMULATE_CONFLICT=1`. The script will emit a conflict-style message and exit non-zero, which the agent interprets as a merge issue; see [../script/update-type-hierarchy.sh#L17-L44](../script/update-type-hierarchy.sh#L17-L44).

## GitHub Actions Integration
- The maintenance workflow runs nightly at 02:15 UTC and remains available on demand; see [../.github/workflows/type-hierarchy-maintenance.yml#L1-L39](../.github/workflows/type-hierarchy-maintenance.yml#L1-L39):
  ```yaml
  jobs:
    maintenance:
      runs-on: ubuntu-latest
      steps:
        - name: Checkout repository
          uses: actions/checkout@v4
  ```
- When that workflow fails due to merge conflicts, the agent in [../.github/workflows/type-hierarchy-maintenance-agent.yml#L16-L200](../.github/workflows/type-hierarchy-maintenance-agent.yml#L16-L200) downloads the failed run logs, replays the updater with `AUTO_RESOLVE_STRATEGY=theirs`, and publishes a report. The remediation step highlights the incident details:
  ```yaml
      - name: Attempt automated resolution
        env:
          AUTO_RESOLVE_STRATEGY: theirs
          SKIP_FORK_SYNC: '1'
        run: ./script/update-type-hierarchy.sh | tee agent-resolution.log
  ```
- Incident reports land in `docs/reports/` with direct references back to the failed run and the relevant script snippet, and the agent opens a pull request so reviewers can decide whether to accept or adjust the auto-merge.
- To simulate a failure via Actions, dispatch the maintenance workflow with the `simulate_conflict` input set to `true`; the step will pass `SIMULATE_CONFLICT=1` through the environment so the script short-circuits and the agent workflow can be exercised intentionally.
- Trigger fork CI runs after each sync:
  ```bash
  gh workflow run typecheck.yml --repo yulongbai-nov/vscode-copilot-chat
  ```
- Monitor status with:
  ```bash
  gh run list --repo yulongbai-nov/vscode-copilot-chat --limit 5
  ```
- When ready to share changes, open an internal PR against your fork:
  ```bash
  gh pr create --repo yulongbai-nov/vscode-copilot-chat --base personal/main --head feature/type-hierarchy-tool --title "Type hierarchy refresh" --body "Automated refresh against upstream"
  ```

Following this playbook keeps the customized type hierarchy tooling current with minimal manual merging while ensuring each sync is validated before it lands in your fork.
