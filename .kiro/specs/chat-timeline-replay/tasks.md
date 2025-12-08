# Implementation Plan: Chat Timeline Replay

- [ ] 0. Finalize scope and UX
  - Decide read-only vs. forkable replay session.
  - Confirm collapse defaults and “Edited” labeling.
  - Set flag name (`github.copilot.chat.liveRequestEditor.timelineReplay.enabled`).
  - Note dependency: persistence is optional. If chat-history-persistence (SQLite) is off, forks are in-memory only; if on, store replay metadata (parent IDs, hashes, version) so forks survive reloads.
  - Default: replay starts read-only; user clicks “Start chatting from this replay” to enable input. Fork payload uses the trimmed messages that were/would be sent.

- [x] 1. Build replay projection
  - Map `EditableChatRequest.messages` → replay bubbles (system/history/tool/user).
  - Omit deleted sections; mark edited sections; collapse long system/history/tool by default.
  - Include tool call/result labels and trimmed-prompt warning when applicable.
  - Enforce section cap (30) and compute “(N more)” affordance for overflow.
  - Attach version/hash metadata to replay builds; emit with session scoping for consumers.

- [ ] 2. Session creation and rendering
  - Status: Service-level state machine + Option A (replace + restore buffer) implemented; command/UI wiring and chat rendering still pending.
  - Add replay session manager keyed to source session/location with optional `replay_parent_turn_id`.
  - Enforce Option A: one replay fork per source turn; replace prior fork if re-replayed.
  - Expose command `github.copilot.liveRequestEditor.replayPrompt` and surface in Live Request Editor UI.
  - Render bubbles via chat participant/content provider without model invocation.
  - When continuing from replay, switch focus to the replay session and show breadcrumb/toast. Keep interception/auto-override off by default in the fork unless explicitly enabled.
  - Cap rendered sections (e.g., 30) and provide “View replayed prompt (N more)” affordance.
  - In replay view with interception off, disable edit/delete controls and auto-scroll to the latest section.
  - Handle stale/cleared states (canceled send/context switch) by marking replay stale; ignore stale updates (version/hash guard).

- [ ] 3. Telemetry and error handling
  - Emit invocation telemetry with source sessionId/requestId and section counts.
  - Detect/log parity mismatches vs. logged request when available.
  - Handle empty/mapping failures gracefully (“Nothing to replay”).

- [ ] 4. Tests and validation
  - Initial unit coverage added for replay projection/state machine in `liveRequestEditorService.spec.ts`.
  - Unit tests for projection (ordering, deletions/edits, tool labeling, trimming warnings).
  - Unit tests for version/hash scoping: stale updates ignored; replay_replace replaces prior fork; restore_previous buffer (if enabled) works.
  - Integration tests:
    - Command availability when LRE is enabled/disabled or no editable request exists (shows “Nothing to replay”).
    - Replay render: collapsed system/history/tool, edited chips, section cap (30) with “(N more)” affordance, warning on trimmed prompt.
    - “Start chatting from this replay”: enables input, shifts focus with breadcrumb/toast, sends with trimmed edited history + new message; original session untouched.
    - Interception ON: paused send → edit → replay → resume send uses trimmed edited payload; fork path still works.
    - Auto-override ON: prefix edits auto-applied; replay remains manual audit/fork; no change to send semantics.
    - Interception/override OFF in replay by default: edit/delete disabled; auto-scroll to latest section.
    - Context change/cancel: replay marked stale; input disabled; cleared message shown.
    - Replay replace on same turn: prior replay replaced; optional restore buffer tested.
  - UX validation for collapsed sections, labels, navigation back to LRE, and stale state messaging.
  - Telemetry tests: emits source session/turn, section counts, hashes; parity warning emitted on hash mismatch.
  - If persistence is enabled: tests for replay metadata save/load (parent IDs, hash, version) and replace behavior (Option A).
