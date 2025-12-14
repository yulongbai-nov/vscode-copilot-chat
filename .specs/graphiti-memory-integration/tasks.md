# Implementation Plan: Graphiti Memory Integration

## Current Status Summary
- Spec expanded to align with the Graphiti REST service contract (`/healthcheck`, `/messages`) and to include a concrete
  connectivity test plan.
- Spec updated to include multi-scope recall + manual promotion design (still opt-in and trust-gated).
- Graphiti settings + commands are implemented, with ingestion + optional recall wired into the agent loop behind trust + consent gates.
- History backfill + best-effort de-duplication for rehydrated chat turns is implemented (bounded + non-blocking).
- `includeGitMetadata` now populates `Message.source_description` with branch/commit/dirty (when available) when enabled.
- Graphiti service validated (Dec 2025): `POST /messages` produces episodes via `GET /episodes/{group_id}?last_n=...`, and `POST /search` returns `200` (facts extracted).
- End-to-end demo guide added: `docs/demos/graphiti-memory-integration/README.md`.

## Checklist
- [x] 0. Confirm MVP scope and privacy defaults _Requirements: 1.3, 4.6, 6.1–6.3_
  - [x] 0.1 Define `group_id` strategy and workspace identity (default: `hashed`; workspaceKey = workspace folders URIs, hashed). _Requirements: 2.7, 4.2–4.3_
  - [x] 0.2 Confirm whether system/context prompts remain excluded in v1 (yes; remain excluded). _Requirements: 4.6, 6.2_
  - [x] 0.3 Confirm scope mode: `session`, `workspace`, or `both` (default: `both`). _Requirements: 2.6, 4.4_
  - [x] 0.4 Decide whether to include git metadata (branch/commit/dirty) in episode metadata (default: off). _Requirements: 2.8_
  - [x] 0.5 Decide whether Recall is in v1 or v2 (implement now, default disabled). _Requirements: 2.9, 9.1–9.6_
  - [x] 0.6 Decide whether User Scope is promotion-only or supports auto-ingest of selected episode kinds (promotion-only). _Requirements: 8.1–8.5_
  - [x] 0.7 Confirm `uuid` posture (omit `uuid` in v1; revisit upstream). _Requirements: 4.5_

- [x] 1. Add configuration keys and consent plumbing _Requirements: 1.1–1.4, 2.1–2.8_
  - [x] 1.1 Add settings under `github.copilot.chat.memory.graphiti.*` in `package.json` (endpoint, scopes, limits, groupIdStrategy). _Requirements: 1.1, 2.1–2.3, 2.6–2.7_
  - [x] 1.2 Implement trust gating (untrusted => disabled). _Requirements: 1.2_
  - [x] 1.3 Implement one-time consent UX when enabling. _Requirements: 1.3, 6.1_
  - [x] 1.4 (Optional) Add `includeGitMetadata` setting. _Requirements: 2.8_

- [x] 2. Implement `GraphitiClient` (HTTP wrapper) _Requirements: 2.2–2.5, 3.2_
  - [x] 2.1 Add typed DTOs matching Graphiti’s `/messages` schema. _Requirements: 4.1_
  - [x] 2.2 Implement `healthcheck()` with timeout. _Requirements: 3.2_
  - [x] 2.3 Implement `addMessages(groupId, messages)` with batching support. _Requirements: 2.3, 4.1_
  - [x] 2.4 (Optional) Implement `deleteGroup(groupId)` for smoke-test cleanup. _Requirements: 3.4–3.5_
  - [x] 2.5 (Optional) Implement `search(...)` / `getMemory(...)` for Recall. _Requirements: 9.2_
  - [x] 2.6 Add unit tests for `GraphitiClient` (healthcheck + addMessages + deleteGroup + search). _Requirements: 2.2–2.5, 3.2_

- [x] 3. Add a “Test Graphiti Connection” command _Requirements: 3.1–3.5_
  - [x] 3.1 Command calls `/healthcheck` and prints actionable output. _Requirements: 3.2_
  - [x] 3.2 Ensure test is non-writing by default. _Requirements: 3.3_
  - [x] 3.3 Add explicit smoke-test mode: write temporary group then delete it. _Requirements: 3.4–3.5_
  - [x] 3.4 In smoke-test mode, poll `/episodes/{group_id}` to confirm processing and warn if empty. _Requirements: 3.6_

- [x] 4. Add ingestion queue + hook into turn finalization _Requirements: 4.1–4.7, 5.1–5.3_
  - [x] 4.1 Define mapping from Copilot chat message → Graphiti `Message` (role_type, omit uuid, timestamp, truncation, optional metadata). _Requirements: 4.2–4.7_
  - [x] 4.2 Implement bounded queue + backoff retry (fail open). _Requirements: 5.1–5.3_
  - [x] 4.3 Wire ingestion to a turn-finalization integration point. _Requirements: 4.1_
  - [x] 4.4 Implement derivation of `sessionGroupId` and `workspaceGroupId`, and fan-out to both when configured. _Requirements: 2.6, 4.2–4.4_
  - [x] 4.5 When `includeGitMetadata` is enabled, populate `Message.source_description` with branch/commit/dirty (when available). _Requirements: 2.8.1_

- [x] 5. Add manual promotion command (User Scope) _Requirements: 8.1–8.5_
  - [x] 5.1 Add `Promote to Graphiti Memory` command and UI prompts (scope + kind). _Requirements: 8.1, 8.3–8.4_
  - [x] 5.2 Implement episode templates for `decision`, `lesson_learned`, `preference`, `procedure`, `task_update`. _Requirements: 8.4–8.5_

- [x] 6. Add recall integration (optional prompt injection) _Requirements: 9.1–9.6_
  - [x] 6.1 Add recall settings (enable + limits). _Requirements: 2.9, 9.1, 9.5_
  - [x] 6.2 Implement `GraphitiRecallService` that queries Graphiti and merges results across scopes. _Requirements: 9.2–9.5_
  - [x] 6.3 Inject recalled facts into `AgentPrompt` as a dedicated tagged section. _Requirements: 9.6_

- [x] 7. Observability (non-content) _Requirements: 7.1–7.2_
  - [x] 7.1 Add logs/telemetry for enqueue/flush failures and drops without user content. _Requirements: 7.1_
  - [x] 7.2 Provide a lightweight user-visible status signal (command output and/or log channel). _Requirements: 7.2_

- [x] 8. Tests _Requirements: 2.3, 4.5–4.7, 5.2–5.3, 8.1–8.5, 9.2–9.6_
  - [x] 8.0 Unit tests for `GraphitiClient` wrapper. _Requirements: 2.2–2.5_
  - [x] 8.1 Unit tests for mapping + truncation (ensuring `uuid` omitted). _Requirements: 4.5–4.7_
  - [x] 8.2 Unit tests for queue bounds/backoff behavior using mocked HTTP. _Requirements: 5.2–5.3_
  - [x] 8.3 Unit tests for promotion template formatting. _Requirements: 8.4–8.5_
  - [x] 8.4 Unit tests for recall merge + caps using mocked HTTP. _Requirements: 9.3–9.6_
  - [x] 8.5 Optional manual smoke script for local Graphiti endpoint (not in CI) (covered via `Test Graphiti Connection` smoke mode). _Requirements: 3.4–3.5_
  - [x] 8.6 Unit tests for `source_description` git metadata injection. _Requirements: 2.8.1_

- [x] 9. (Upstream) Fix Graphiti service ingestion/retrieval robustness _Requirements: 3.6, 9.3_
  - [x] 9.1 Prevent the Graphiti `/messages` background worker from dying on a single job failure and surface an actionable error. _Requirements: 3.6_
  - [x] 9.2 Ensure Graphiti service applies configured OpenAI base URL/API key to the embedder (and reranker where applicable) so `/search` does not 500 due to misconfiguration. _Requirements: 9.3_
  - [x] 9.3 Ensure Graphiti background worker is started via app lifespan and does not use request-scoped Graphiti instances for queued jobs. _Requirements: 3.6_

- [x] 10. Backfill and de-duplicate rehydrated chat turns _Requirements: 4.8–4.9, 5.1_
  - [x] 10.1 Extend Graphiti ingestion API to accept stable turn IDs and batches. _Requirements: 4.8–4.9_
  - [x] 10.2 Implement bounded backfill from in-memory conversation history without blocking chat. _Requirements: 4.8, 5.1_
  - [x] 10.3 Implement best-effort dedupe per `group_id` to avoid duplicate enqueueing. _Requirements: 4.9_
  - [x] 10.4 Add unit tests for backfill + dedupe behavior. _Requirements: 4.8–4.9_

- [x] 11. Sanitize `groupIdStrategy=raw` IDs to Graphiti-safe keys _Requirements: 2.7, 4.2–4.4_

- [x] 12. Enforce Graphiti HTTP timeouts via abort signals _Requirements: 2.2, 5.1, 9.2–9.3_

## Follow-ups (E2E Validation)
- [x] 13. Add end-to-end validation runbook + opt-in integration test _Requirements: 3.1–3.6, 4.1, 9.1–9.6_
  - [x] 13.1 Document VS Code enablement + verification steps in `design.md` (ingestion, promotion, recall). _Requirements: 3.1–3.6, 4.1, 8.1–8.5, 9.1–9.6_
  - [x] 13.2 Add an env-gated `vitest` Graphiti E2E smoke test that hits a real Graphiti endpoint (not CI). _Requirements: 3.4–3.6_

## Follow-ups (Demo)
- [x] 14. Add an end-to-end demo folder + guide _Requirements: 3.1–3.6, 8.1–8.5, 9.1–9.6_
  - [x] 14.1 Create `docs/demos/graphiti-memory-integration/README.md` with a scenario-based walkthrough. _Requirements: 3.1–3.6, 8.1–8.5, 9.1–9.6_
  - [x] 14.2 Include a “why better than the old one” comparison (baseline + MemoryTool). _Requirements: 1.3, 5.1, 6.1–6.3, 9.6_
  - [x] 14.3 Link the demo from `design.md`. _Requirements: 3.1–3.6_

## Implementation Notes
- Keep the first milestone ingestion-only unless Recall is explicitly prioritized.
- Keep defaults conservative: user+assistant chat only; no attachments; no system/context prompts.
- Ensure Graphiti is never contacted when disabled or in an untrusted workspace.

## Testing Priority
1. `Test Graphiti Connection` command (healthcheck path) in a trusted workspace.
2. Enablement + consent gating (ensure no network calls when disabled).
3. Ingestion queue under failure modes (endpoint down, timeout).

## Manual Verification (local dev)
These checks assume Graphiti is running at the configured endpoint:
- `curl -fsS http://graph:8000/healthcheck`
- (optional smoke) `curl -fsS -X POST http://graph:8000/messages ...` then `curl -fsS -X DELETE http://graph:8000/group/<id>`
