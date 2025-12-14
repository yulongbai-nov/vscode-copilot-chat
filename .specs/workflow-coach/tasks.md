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
- [x] 7. Add local-only per-branch persisted state _Requirements: 6_
  - [x] 7.1 Store state under git common dir (worktree-safe)
  - [x] 7.2 Read prior state and surface “previous run” summary
  - [x] 7.3 Add `--no-persist` to disable reading/writing state
- [x] 8. Add deterministic spec cross-check warnings _Requirements: 7_
  - [x] 8.1 Infer expected Active Spec from branch naming
  - [x] 8.2 Infer Active Spec from `.specs/<name>/...` working changes
  - [x] 8.3 Warn on mismatch / missing core spec docs / code changes without `.specs` changes
- [x] 9. Extend unit tests for new state/spec rules _Requirements: 6, 7_
- [x] 10. Update docs to reflect persistence + spec cross-check behavior _Requirements: 6, 7_
- [x] 11. Add heuristic phase inference + reminders _Requirements: 8_
  - [x] 11.1 Infer design vs implementation from changed paths
  - [x] 11.2 Persist and display phase transitions
  - [x] 11.3 Add design-phase “clarify requirements” reminder
  - [x] 11.4 Add “unknown phase” reminder
- [x] 12. Add docs code-link formatting reminder _Requirements: 9_
  - [x] 12.1 Emit reminder when work type is docs or Markdown files change
  - [x] 12.2 Update agent-prompt.md to require line-link formatting in docs

## Implementation Notes

- Keep the coach advisory: no automatic git operations, and no tracked-file edits.
- Persisted state must be local-only (git common dir) and best-effort.
- `gh` integration must be optional and fail-open.
- Prefer a small, deterministic rule engine over ML/heuristics.
