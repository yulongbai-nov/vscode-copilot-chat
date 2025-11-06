# Feature Spec: Simulation Cache Hydration Using Merge Base

## Background & Motivation
- Current automation fetches large simulation cache assets from `upstream/main` regardless of the fork's position, which can download unnecessary LFS versions and break when `main` diverges.
- Some branches track older upstream commits; fetching the latest cache snapshot may fail if those LFS objects were removed or rewritten upstream.
- We want deterministic hydration that pulls only the artifacts reachable from the branch's merge base with upstream, guaranteeing compatibility without chasing future updates.

## Goals
- Determine the fork's latest common commit with the upstream remote and fetch simulation cache LFS objects reachable from that commit.
- Reuse the logic anywhere we hydrate cache (postinstall script, GitHub Actions workflows) without duplicating shell pipelines.
- Emit helpful diagnostics when the merge base cannot be resolved or the required LFS objects are missing.

## Non-Goals
- Rewriting Git history to remove cache references.
- Supporting arbitrary remotes beyond `upstream`/`origin` conventions.
- Automatically updating baselines or running simulations.

## User Stories
1. As a contributor on a feature branch, I hydrate the cache for the exact upstream version my branch depends on, avoiding incompatible updates.
2. As a CI maintainer, workflows download only the required LFS blobs, keeping runs stable when upstream rotates cache layers.
3. As a maintainer debugging hydration failures, I see actionable errors that mention the merge base and recovery steps.

## Requirements
- Resolve merge base via `git merge-base HEAD upstream/main` (configurable upstream branch) and use it as the ref for `git lfs fetch`.
- Fall back gracefully if upstream remote is missing: instruct the user to add it.
- Ensure scripts still skip the fetch when the cache already exists locally.
- Document the behavior change and required environment in `.spec` and developer docs.

## Acceptance Criteria
- Postinstall script and workflow hydration steps fetch using the merge base instead of hard-coded `upstream main`.
- Manual hydration instructions in docs reference the merge-base strategy.
- Added tests or dry-run validation for helper logic (unit or integration stubs as feasible).
- CI succeeds after the change, demonstrating compatibility across branches.

## Open Questions
- Should we allow overriding the upstream branch via environment variable for release branches?
- Do we need to cache merge-base results to avoid repeated `git` calls in CI?
