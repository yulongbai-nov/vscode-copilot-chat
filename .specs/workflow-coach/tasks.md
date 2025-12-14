# Implementation Plan

- [x] 1. Add spec entry to `.specs/README.md` _Requirements: 1.1_
- [x] 2. Implement `script/workflowCoach.ts` (context collector + rule engine) _Requirements: 1–4_
  - [x] 2.1 Collect git state (branch, changes, ahead/behind, changed paths)
  - [x] 2.2 Optional PR lookup via `gh` (best-effort) + `--no-gh`
  - [x] 2.3 Query parsing + `--type` override
  - [x] 2.4 Rule set (dirty main, staged, unpushed, missing PR, scope drift heuristic, naming reminders)
  - [x] 2.5 Text renderer + `--json` renderer
- [x] 3. Add `npm run workflow:coach` script entry in `package.json` _Requirements: 1_
- [x] 4. Add unit tests for rule engine (mock git/gh collectors) _Requirements: 4, 5_
- [x] 5. Update `agent-prompt.md` to reference the coach at decision points (shorten prose) _Requirements: 4_
- [x] 6. Document usage in a short `docs/workflow-coach.md` _Requirements: 1–5_

## Implementation Notes

- Keep the MVP purely advisory (no automatic changes).
- `gh` integration must be optional and fail-open.
- Prefer a small, deterministic rule engine over ML/heuristics.
