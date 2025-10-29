# Type Hierarchy Maintenance Plan

## Milestones
- **M1 – Documentation Baseline**
  - Finalize the spec ([./TYPE-HIERARCHY-MAINTENANCE-SPEC.md](./TYPE-HIERARCHY-MAINTENANCE-SPEC.md)).
  - Publish the operational playbook ([./TYPE-HIERARCHY-MAINTENANCE.md](./TYPE-HIERARCHY-MAINTENANCE.md)).
  - Provide a reusable feature-wide maintenance reference ([./FEATURE-MAINTENANCE-GUIDE.md](./FEATURE-MAINTENANCE-GUIDE.md)).
- **M2 – Automation Script**
  - Implement `script/update-type-hierarchy.sh` to orchestrate sync + rebase + validation.
  - Ensure the script surfaces failures (non-zero exit) if any command fails.
- **M3 – Validation & CI Hooks**
  - Capture a sample run, including `npm run typecheck` output.
  - Document GH CLI workflow triggers for optional CI executions.
  - Publish automation workflow at [../.github/workflows/type-hierarchy-maintenance.yml#L1-L39](../.github/workflows/type-hierarchy-maintenance.yml#L1-L39).
    ```yaml
    - name: Rebase and validate type hierarchy stack
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: ./script/update-type-hierarchy.sh
    ```
- **M4 – Failure Remediation**
  - Introduce the maintenance agent at [../.github/workflows/type-hierarchy-maintenance-agent.yml#L16-L200](../.github/workflows/type-hierarchy-maintenance-agent.yml#L16-L200).
  - Generate example output in `docs/reports/` to demonstrate the incident report format.
  - Ensure the agent opens a pull request when a remediation commit is created.
  - Add a `simulate_conflict` workflow-dispatch input so the remediation flow can be triggered on demand.

## Tasks
1. Create and review spec (complete).
2. Draft automation script prototype.
3. Validate script against current branches.
4. Update documentation with validation notes.
5. Optional: wire script into personal CI job.
6. Optional: simulate a merge conflict to validate the remediation agent end-to-end.
7. Optional: run the maintenance workflow with `simulate_conflict=true` and confirm a report plus PR appear.

## Risks & Mitigations
- **Conflict churn**: Mitigated by `git rerere` and keeping changes isolated to custom files.
- **Script drift**: Keep branch names parameterized via local variables so future renames require one edit.
- **CI token limits**: Provide manual `gh workflow run` usage instead of forcing automation.
- **False positives in remediation**: Gate the agent on conflict detection keywords and surface the generated Markdown report for quick human review.

## Validation Checklist
- [ ] `script/update-type-hierarchy.sh` exists and is executable.
- [ ] Script logs success message after `npm run typecheck`.
- [ ] Dry-run rebase completes without conflicts (or rerere auto-resolves them).
- [ ] Docs reference live code locations: [../src/platform/languages/vscode/languageFeaturesServicesImpl.ts#L78-L137](../src/platform/languages/vscode/languageFeaturesServicesImpl.ts#L78-L137), [../src/platform/languages/typescript/vscode/typescriptTypeHierarchyProvider.ts#L32-L190](../src/platform/languages/typescript/vscode/typescriptTypeHierarchyProvider.ts#L32-L190).
- [ ] CI workflow exists at [../.github/workflows/type-hierarchy-maintenance.yml#L1-L39](../.github/workflows/type-hierarchy-maintenance.yml#L1-L39).
- [ ] Failure remediation agent exists at [../.github/workflows/type-hierarchy-maintenance-agent.yml#L16-L200](../.github/workflows/type-hierarchy-maintenance-agent.yml#L16-L200) and writes reports to `docs/reports/`.
- [ ] Workflow-dispatch input `simulate_conflict` forwards `SIMULATE_CONFLICT=1` to the script so the failure path can be rehearsed without real conflicts.
