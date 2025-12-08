# Chat Timeline Replay – Handoff (8 Dec 2025)

Branch: `feature/spec-refactor` (spec-only; no code changes yet)

## Source of Truth
- `.kiro/specs/chat-timeline-replay/{design.md,requirements.md,tasks.md,flows.md}` — replay/fork UX, state machine, caps, sync/parity rules.
- `.kiro/specs/request-logger-prompt-editor/design.md` — overall Live Request Editor architecture; replay is additive/orthogonal to interception/auto-override.

## Next Implementation Tasks (can run in parallel)
1) **Replay builder + service plumbing**
   - Implement projection/state machine in the service layer with version/hash guards, Option A (one fork per turn), and the one-level restore buffer.
   - Seed fork payload from trimmed messages; projection is display-only.
   - Add `replay_parent_session_id` / `replay_parent_turn_id` linkage and stale handling on cancel/context change.
   - Likely files: `src/extension/prompt/node/liveRequestEditorService.ts`, `src/extension/prompt/node/liveRequestBuilder.ts`, tests under `src/extension/prompt/node/test/`.

2) **Chat view integration (command + rendering)**
   - Add `replayPrompt` command entry point and surface “Replay edited prompt” in the Live Request Editor UI.
   - Render replay in chat view: collapsed system/history/tool, edited chips, section cap=30 with “(N more)”, trimmed warning, read-only by default; “Start chatting from this replay” enables input + focus shift with breadcrumb/toast.
   - Disable edit/delete in replay view when interception/override are off; auto-scroll to latest.
   - Likely files: `src/extension/prompt/vscode-node/liveRequestEditorProvider.ts`, `src/extension/prompt/webview/vscode/liveRequestEditor/main.tsx` (if reused), chat participant/content provider hookup.

3) **Telemetry, parity, persistence hooks**
   - Emit replay invocation telemetry (session/turn, totals/edited/deleted, hashes) and parity warnings when replay hash ≠ logged hash.
   - Persist replay metadata (parent IDs, hash, version) when chat-history-persistence (SQLite) is enabled; otherwise keep the one-level restore buffer.
   - Surface parity/stale warnings in replay/metadata views.
   - Likely files: service + telemetry plumbing, `src/platform/configuration/common/configurationService.ts` (flags), persistence layer once implemented.

## Ready State / Defaults
- Modes: replay off by default; read-only entry, user must click “Start chatting from this replay” to fork. Interception/auto-override stay off in replay unless explicitly toggled.
- Cap: 30 sections; “(N more)” affordance for overflow. Trimmed payload is the fork seed; projection is display-only.
- One fork per turn; replay_replace replaces prior replay; optional one-level restore buffer.
- States: `idle → building → replay_ready → fork_active → stale` (see `flows.md` for mermaid).

## Testing Pointers
- Unit: projection mapping, caps, edited/deleted handling, version/hash guards, replay_replace/restore buffer, state machine transitions.
- Integration: command availability, rendering (collapsed/edited/cap, trimmed warning), “Start chatting” flow (focus shift, trimmed history send, original session untouched), interception on/off, auto-override on, stale handling on cancel/context change, replace replay on same turn.
- Telemetry/parity: events contain session/turn, counts, hashes; parity warning on hash mismatch.
- Persistence (when available): save/load replay metadata and replace behavior (Option A).

## Interrupt Handling (per spec)
- Empty/invalid projection: show “Nothing to replay”; no session created.
- Mapping failure: toast; original session untouched.
- Trimmed prompt: banner.
- Context change/cancel: mark replay stale; disable input; show cleared state.
- Re-replay same turn: replace prior; optionally allow “Restore previous replay” (last version only).
