# Implementation Plan

- [x] 1. Align spec docs to Copilot Chat scope _Requirements: 1.1_
- [x] 2. Add Graphiti settings + wiring _Requirements: 1.1, 1.2, 2.4, 3.1, 4.1, 4.2_
  - [x] 2.1 Add config keys in `package.json` _Requirements: 1.1, 1.2_
  - [x] 2.2 Add internal config keys in `src/platform/configuration/common/configurationService.ts` _Requirements: 1.1, 1.2_
- [x] 3. Implement Graphiti REST client + DTOs _Requirements: 2.1, 3.1, 5.1_
- [x] 4. Implement ingestion service (gating, queue, retry) _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 2.3_
- [x] 5. Wire ingestion into turn finalization _Requirements: 2.1, 2.4_
- [x] 6. Implement recall service + prompt injection _Requirements: 3.1, 3.2, 3.3, 3.4_
- [x] 7. Add consent flow + commands (test + promote) _Requirements: 1.4, 4.3, 5.1, 5.2, 5.3_
- [x] 8. Add tests (unit + optional real-service E2E) _Requirements: 2.2, 2.3, 3.3, 3.4_
- [x] 9. Add docs + end-to-end demo guide _Requirements: 5.1_
- [x] 10. Run quad verification and ship PR _Requirements: all_

## Implementation Notes

- Automatic behavior is always best-effort and fail-open.
- Default scopes: ingest `session` + `workspace`; recall disabled until explicitly enabled.
- Group ids use hashed strategy by default to prevent leaking identifying strings.
- User scope is promotion-only by default.

## Testing Priority

1. Unit-test mapping, recall, and gating behaviors under `src/extension/memory/graphiti/test/node/`.
2. Optional real-service E2E smoke test: `GRAPHITI_E2E=1 … npx vitest run …` (writes + deletes temp group).
3. Manual VS Code smoke: enable + consent + run “Test Graphiti Connection” in smoke mode.

## Backward Compatibility

- All new behavior is behind config flags and workspace trust gating.
- Existing chat flows continue unchanged when Graphiti is disabled or unavailable.

## Current Status Summary

- Phase: implementation.
- Completed: ingestion + recall + promotion, demo guide, tests, and spec alignment.
- PR: https://github.com/yulongbai-nov/vscode-copilot-chat/pull/51
- Next: address review feedback and merge.
