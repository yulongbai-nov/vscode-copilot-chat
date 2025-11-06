# Design: Merge-Base-Scoped Simulation Cache Hydration

## Overview
We will centralize merge-base-aware hydration in a TypeScript utility that can be shared between `script/postinstall.ts` and GitHub Actions shell snippets. The workflow is:

1. Ensure `upstream` remote exists (add it if missing, consistent with current behavior).
2. Resolve the merge base between the current branch (`HEAD`) and `upstream/<targetBranch>`.
3. Fetch LFS blobs reachable from that merge base only.
4. Perform `git lfs checkout` limited to `test/simulation/cache`.
5. Provide structured logging and error propagation so automation surfaces clear remediation steps.

## Detailed Plan

### 1. Utility Extraction
- Introduce `script/build/ensureSimulationCache.ts` (or similar) exporting helpers:
  - `resolveMergeBase(targetRef: string): Promise<string>`
  - `fetchSimulationCache(ref: string): Promise<void>`
- Replace inline commands in `postinstall.ts` with calls into this helper, passing the upstream branch (`upstream/main`) as the target reference.

### 2. Merge Base Resolution
- Call `git merge-base HEAD <upstreamRef>`; if the command exits non-zero, throw a descriptive error explaining how to sync the branch.
- Log the chosen merge-base hash for traceability.

### 3. Fetch Command Adjustments
- Update the fetch command to `git lfs fetch upstream <mergeBase> --include=test/simulation/cache/* --exclude=`.
- Maintain the existing checkout step (`git lfs checkout test/simulation/cache`).
- Ensure we still short-circuit when `base.sqlite` already exists to avoid redundant fetches.

### 4. Workflow Updates
- Provide a Node-based helper (`node script/hydrateSimulationCache.js`) so actions on Linux and Windows share the same logic without shell divergence.
- Update all workflows that currently fetch `upstream main` directly to execute the helper script, ensuring the script runs under both bash and PowerShell steps in `pr.yml`.

### 5. Error Handling & Messages
- Distinguish between missing remote, missing merge base, and missing LFS objects; provide tailored messages.
- When LFS checkout still fails, suggest running simulations or contacting maintainers with the merge-base hash.

### 6. Documentation
- Extend `docs/simulation-cache-lfs-guide.md` with a section explaining merge-base hydration and how to override the upstream ref via env var.
- Record reasoning in this `.spec` folder (current document) and reference the helper script location for future maintainers.

### 7. Validation
- Local smoke test: run `npm install` (which triggers postinstall) on a branch behind upstream to ensure the correct ref is used.
- CI validation: ensure workflows still pass and log the chosen merge base.
- Optional: add a unit test mocking `git` invocations to verify command sequence (using `vitest` in `script/__tests__/` if practical).

## Risks & Mitigations
- **Branch without merge base**: Provide fallback guidance (e.g., fetch upstream first). Exiting with actionable error prevents silent failure.
- **Performance**: Additional `merge-base` call is cheap; limit repeated runs by skipping when cache exists.
- **Workflow portability**: Validate the Node helper through both the Linux and Windows jobs in `pr.yml` and document any platform-specific environment variables that must be set.

## Future Enhancements
- Allow environment variable override for the upstream ref (e.g., `SIM_CACHE_UPSTREAM_REF`) to support release branches.
- Cache merge-base decision in `.build` to avoid repeated calls in multi-job workflows if needed.
