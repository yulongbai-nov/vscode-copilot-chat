# Implementation Plan: Chat Timeline Replay

- [ ] 0. Finalize scope and UX
  - Decide read-only vs. forkable replay session.
  - Confirm collapse defaults and “Edited” labeling.
  - Set flag name (`github.copilot.chat.liveRequestEditor.timelineReplay.enabled`).
  - Note dependency: persistence is optional. If chat-history-persistence (SQLite) is off, forks are in-memory only; if on, store replay metadata (parent IDs, hashes, version) so forks survive reloads.

- [ ] 1. Build replay projection
  - Map `EditableChatRequest.messages` → replay bubbles (system/history/tool/user).
  - Omit deleted sections; mark edited sections; collapse long system/history/tool by default.
  - Include tool call/result labels and trimmed-prompt warning when applicable.

- [ ] 2. Session creation and rendering
  - Add replay session manager keyed to source session/location with optional `replay_parent_turn_id`.
  - Enforce Option A: one replay fork per source turn; replace prior fork if re-replayed.
  - Expose command `github.copilot.liveRequestEditor.replayPrompt` and surface in Live Request Editor UI.
  - Render bubbles via chat participant/content provider without model invocation.

- [ ] 3. Telemetry and error handling
  - Emit invocation telemetry with source sessionId/requestId and section counts.
  - Detect/log parity mismatches vs. logged request when available.
  - Handle empty/mapping failures gracefully (“Nothing to replay”).

- [ ] 4. Tests and validation
  - Unit tests for projection (ordering, deletions/edits, tool labeling, trimming warnings).
  - Integration tests for command → session creation → rendering.
  - UX validation for collapsed sections, labels, and navigation back to Live Request Editor.
  - If persistence is enabled, add tests for replay metadata save/load and version replacement (Option A).
