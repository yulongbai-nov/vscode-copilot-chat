# Copilot Maintenance Delegate Refactor Plan

## Goal
Document the plan and technical specification for moving the Copilot maintenance delegate workflow logic out of inline GitHub Script blocks and into reusable Node.js scripts while preserving existing behavior.

## Current Implementation
Inline JavaScript in [../.github/workflows/copilot-maintenance-delegate.yml#L24-L97](../.github/workflows/copilot-maintenance-delegate.yml#L24-L97) handles the manual delegation path. The prompt assembly currently relies on a template literal that spans multiple lines, e.g.:

```javascript
const instructions = extra.length > 0
  ? `${basePrompt}\n\nAdditional context:\n${extra}`
  : basePrompt;
```

Similarly, automatic escalation logic is embedded later in the same workflow file in [../.github/workflows/copilot-maintenance-delegate.yml#L109-L211](../.github/workflows/copilot-maintenance-delegate.yml#L109-L211), where REST calls (`github.rest.issues.createComment`) run directly inside the YAML `script: |` block.

## Pain Points
- YAML parsing errors arise from the multi-line template literals, causing the workflow to fail validation.
- Large inline scripts make the workflow definition hard to review or reuse.
- Lack of shared utilities between manual and automatic paths increases duplication.

## Proposed Refactor
1. Introduce `.github/scripts/maintenance-delegate-manual.js` to encapsulate the manual `workflow_dispatch` behavior.
2. Introduce `.github/scripts/maintenance-delegate-check-suite.js` for the automatic `check_suite` handler.
3. Each script imports `@actions/core` and `@actions/github`, reads inputs or event payload from environment variables, and throws on failure so GitHub Actions surfaces the error.
4. Update the workflow to call these scripts via `node` after checking out the repository, ensuring the jobs remain functionally equivalent.
5. Share utility helpers (e.g., comment marker construction, pagination helpers) between scripts via an internal module under `.github/scripts/lib/` if the duplication exceeds a few lines.

## Implementation Plan
1. Create a small `package.json` inside `.github/scripts/` that lists `@actions/core` and `@actions/github` as dependencies; add a lock file for reproducibility.
2. Extract the manual handler logic verbatim into `maintenance-delegate-manual.js`, adapting the input retrieval to `core.getInput` and ensuring comment bodies maintain existing formatting.
3. Extract the automatic handler logic into `maintenance-delegate-check-suite.js`, preserving pagination and deduplication behavior.
4. Modify `.github/workflows/copilot-maintenance-delegate.yml` so each job executes the corresponding script (replace `actions/github-script` usage with `actions/setup-node` + `node .github/scripts/...`).
5. Run `npm install` within `.github/scripts/` locally (or `npm ci` in CI) and commit the generated lock file.
6. Validate the workflow using `npm run lint` (for TypeScript/JS style) and a dry-run YAML check (e.g., `yarn dlx actionlint`) to ensure no syntax regressions.

## Validation Plan
- `npm run lint`
- `npx actionlint .github/workflows/copilot-maintenance-delegate.yml`
- Manual `gh workflow run copilot-maintenance-delegate.yml --ref feature/copilot-maintenance-agent --field pr_number=3` followed by observing the PR comment.
- Trigger a `check_suite` event by re-running a failed workflow (e.g., `gh run rerun 18909295494`) and verify the new script posts the deduplicated @copilot comment.

## Open Questions
- Should the shared helpers live alongside the scripts or in a separate package for broader reuse?
- Do we need to cache `npm ci` installs in Actions to keep runtime low after the refactor?
