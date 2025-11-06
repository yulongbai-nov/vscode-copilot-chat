# Custom Feature Maintenance Spec & Plan

Note: The shared maintenance script and workflow described here were retired in favor of the nightly upstream merge automation (`.github/workflows/fork-nightly-merge.yml`). This guide remains archived for historical reference.

## Specification

### Objective
Provide a repeatable framework for keeping any forked feature in sync with `microsoft/vscode-copilot-chat` while preserving local customizations. The flow reuses the shared automation assets introduced for the type hierarchy work but applies to any long-lived divergence.

### Branch Model
- Upstream tracking: `origin/main` mirrored locally (e.g., `main-upstream`).
- Integration branch: `personal/main` that rebases on top of upstream and aggregates active features.
- Feature branches: `feature/<focus>` rebased onto `personal/main` before validation.

### Automation Entry Point
All maintenance jobs historically called the shared script at `../script/update-type-hierarchy.sh` (retired). Environment toggles let each feature choose how aggressively to sync or resolve conflicts:
```bash
skip_sync="${SKIP_FORK_SYNC:-0}"
auto_strategy="${AUTO_RESOLVE_STRATEGY:-}"
simulate_conflict="${SIMULATE_CONFLICT:-0}"

if [[ "$skip_sync" != "1" ]]; then
	printf '==> Syncing fork %s\n' "$fork_repo"
	gh repo sync "$fork_repo" --branch main
else
	printf '==> Skipping fork sync (SKIP_FORK_SYNC=%s)\n' "$skip_sync"
fi
```
- `SKIP_FORK_SYNC=1` skips the `gh repo sync` call during experiments but keeps the same rebase pipeline.
- `AUTO_RESOLVE_STRATEGY=theirs` (or another strategy option) retries `git rebase` with bias toward upstream when conflicts appear (handled within the retired script).
- `SIMULATE_CONFLICT=1` forces an early failure that mimics a merge conflict so remediation tooling can be rehearsed without creating real divergence (handled within the retired script).

### Validation Step
Every execution concluded with a TypeScript typecheck so new feature surface areas remained healthy:
```bash
printf '==> Running typecheck\n'
npm run typecheck
```

### CI Orchestration
- Scheduled and on-demand runs lived in `.github/workflows/type-hierarchy-maintenance.yml` (retired). Manual dispatch supported a `simulate_conflict` flag that forwarded `SIMULATE_CONFLICT=1` to the script.
- Failure handling is delegated to the agent workflow in [../.github/workflows/type-hierarchy-maintenance-agent.yml#L16-L200](../.github/workflows/type-hierarchy-maintenance-agent.yml#L16-L200). It watches for merge-related failures, reruns the updater with `AUTO_RESOLVE_STRATEGY=theirs`, and writes an incident report to `docs/reports/` before opening a follow-up PR.
- When a human escalation is needed, the delegate workflow at [../.github/workflows/copilot-maintenance-delegate.yml#L1-L223](../.github/workflows/copilot-maintenance-delegate.yml#L1-L223) automatically posts an `@copilot` report when PR checks fail and still allows manual dispatch with optional custom instructions.

## Plan

### Milestones
1. **Adopt Automation** – Historically pointed the new feature’s maintenance workflow at `script/update-type-hierarchy.sh` and confirmed the branch names (`stack_branch`, `feature_branch`) matched the feature layout.
2. **Enable Failure Guardrails** – Ensure both workflows above are present so merge conflicts trigger automated remediation. Configure branch protection to require the generated PRs for manual review.
3. **Document Feature-Specific Notes** – Extend the feature’s own README or spec with any one-off conflict resolution rules so future reruns remain deterministic.

### Recommended Tasks
- Update branch variables in the script (or wrap it) if the feature uses different naming conventions. (Historical guidance; script retired.)
- Register a maintenance workflow for the feature (copying `type-hierarchy-maintenance.yml` and renaming it) while preserving the `simulate_conflict` dispatch input. (Historical guidance; workflow retired.)
- Wire the delegate workflow so a maintainer can invoke Copilot if a manual review or resolution is required.
- Test the full loop by dispatching the workflow with `simulate_conflict=true` and reviewing the agent-generated report for clarity.
- Capture recurring manual merge decisions in rerere (`git config rerere.enabled true`) so the automation absorbs them on the next run.

### Validation Checklist
- [ ] Maintenance workflow exists for the feature and references `./script/update-type-hierarchy.sh`. (Historical; superseded by nightly merge automation.)
- [ ] `AUTO_RESOLVE_STRATEGY` and `SKIP_FORK_SYNC` defaults cover the feature’s needs (update repository secrets or workflow env if different values are required).
- [ ] Agent workflow produces a Markdown report and PR when conflicts occur (verified via simulated run).
- [ ] Copilot delegate workflow posts an `@copilot` comment to the target pull request when triggered.
- [ ] Documentation links back to this guide plus any feature-specific notes so future maintainers can recover quickly.
- [ ] `npm run typecheck` succeeds after each automated rebase.

### Ongoing Usage Tips
- Run the maintenance workflow after large upstream merges or before publishing feature updates.
- Use the `SIMULATE_CONFLICT` path quarterly to ensure remediation still works after dependency updates.
- If a feature outgrows the shared script, fork it into `script/update-<feature>.sh` but retain the environment toggles so CI behavior stays predictable.
