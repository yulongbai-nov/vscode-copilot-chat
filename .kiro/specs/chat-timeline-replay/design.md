# Design Document: Chat Timeline Replay

## Overview
When a user edits or deletes sections in the Live Request Editor and sends, offer a chat timeline that mirrors the edited prompt as chat bubbles (system/history/context/tool/user) so they can verify what will be/was sent without relying on the editor webview. The replay is display-only and does not invoke the model.

## Goals
- Show a bubble-by-bubble projection of the edited request for confidence/auditing.
- Keep it opt-in and non-blocking; original send semantics remain unchanged.
- Preserve ordering, respect deletions, and mark edited sections.

## Non-Goals
- Re-running the model on the replayed prompt.
- Editing inside the replay view (edits stay in Live Request Editor).
- Disk persistence (covered separately by chat-history-persistence).

## Current State
- No timeline replay implementation exists.
- Chat log replay (debug) is unrelated to this feature.
- Live Request Editor exposes edited messages/metadata we can consume.

## Proposed Architecture
1) **Replay Builder**: Build a “replay projection” from `EditableChatRequest.messages` (plus tool metadata/request options/intent/debug name), mapping sections to chat bubbles and dropping deleted sections. System/prefix collapsed by default; edited sections labeled “Edited.” Reuse trimming/summarization from prompt render to avoid divergence.
2) **Replay Session Manager**: Create/reuse a forked “replayed prompt” conversation keyed to the source session/location; optionally link via `replay_parent_turn_id`.
3) **Invocation Surface**: Command (e.g., `github.copilot.liveRequestEditor.replayPrompt`) and/or button in the Live Request Editor banner, gated by feature flag.
4) **Display Surface**: Render via chat participant/content provider in the chat panel; no model call.
5) **Persistence (future)**: If/when chat-history-persistence (SQLite) is enabled, store replay metadata (replay_parent_turn_id/session_id, trimmed payload hash, version) so forks survive reloads; otherwise replay remains in-memory only.

### Data & Control Flow
1. User edits and confirms send.
2. Build `ReplayChatSessionInit` from `EditableChatRequest.messages` (+ tool metadata, request options, intent/debug name).
3. Create/update replay session (Option A: one fork per turn; replays replace the prior fork for that turn); emit synthetic chat events to render bubbles in order:
   - System/prefix → system bubble (collapsed default).
   - Context/history → user/assistant bubbles tagged “replayed.”
   - Tool calls/results → assistant/tool bubbles with arguments/results (no re-execution).
   - Current user message → user bubble.
4. Subsequent input in the replayed session (if allowed) uses the edited history; otherwise display-only.

### UX
- Badge: “Replayed prompt · <session tail>” with tooltip including source requestId.
- Collapse long system/history/tool content by default; “View replayed prompt”/“Collapse” toggles.
- Omit deleted sections; mark edited sections with an “Edited” chip.
- Warn if prompt was token-trimmed: “Prompt was trimmed; replay may omit truncated content.”
- Provide “Back to conversation” + “Open Live Request Editor” links. When read-only replay is shown, keep input disabled until the user explicitly chooses “Start chatting from this replay.”
- Entry point: explicit “Replay edited prompt” action in the Live Request Editor banner. No surprise auto-launch; optional toast if auto-opened.
- Option A (one fork per turn): a new replay replaces the previous fork for that turn. Optional soft safety net: keep the last replaced fork in memory for “Restore previous replay.”

### Configuration / Flags
- `github.copilot.chat.liveRequestEditor.timelineReplay.enabled` (default: false).
- Command visibility tied to Live Request Editor advanced flag + replay flag; optional per-user opt-in to avoid surprises.

### Telemetry / Diagnostics
- Emit replay invocation with source sessionId/requestId, section counts, edited/deleted counts.
- Log parity mismatches between replay content and logged request if available.

### Error Handling
- If no editable request: show friendly message, no-op.
- If mapping yields empty (all deleted): “Nothing to replay” with reset link.
- Large prompts: cap rendered sections; show truncation indicator.

### Risks and Mitigations
- **Trimmed prompts**: show warning and token counts when available.
- **Session confusion**: clear labels and back-navigation.
- **Performance**: collapse by default, cap sections, lazy-expand.

### Open Questions
- Should replay be read-only or allow continuing the forked session?
- Should we render inline diffs (strikethrough deletions) or keep omit+chip?
- Should replays persist across reloads (ties to chat-history-persistence) or stay ephemeral?
- Should focus auto-switch to the replay session or prompt first?
- How should interception/auto-override behave on the fork (inherit vs. start clean)?
- If persistence is off, do we need a soft in-memory “Restore previous replay” buffer per turn, and how many versions to keep?
