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
- Full-fledged replay storage beyond what chat-history-persistence provides (we only persist minimal linkage/metadata when the SQLite feature is on; otherwise keep an in-memory restore buffer).

## Current State
- No timeline replay implementation exists.
- Chat log replay (debug) is unrelated to this feature.
- Live Request Editor exposes edited messages/metadata we can consume.

## Proposed Architecture
1) **Replay Builder**: Build a “replay projection” from `EditableChatRequest.messages` (plus tool metadata/request options/intent/debug name), mapping sections to chat bubbles and dropping deleted sections. System/prefix collapsed by default; edited sections labeled “Edited.” Reuse trimming/summarization from prompt render to avoid divergence.
2) **Replay Session Manager**: Create/reuse a forked “replayed prompt” conversation keyed to the source session/location; optionally link via `replay_parent_turn_id`.
3) **Invocation Surface**: Command (e.g., `github.copilot.liveRequestEditor.replayPrompt`) and/or button in the Live Request Editor banner, gated by feature flag.
4) **Display Surface**: Render via chat participant/content provider in the chat panel; no model call. Replay is read-only by default; user must click “Start chatting from this replay” to enable input.
5) **Fork payload**: Seed the forked session with the exact trimmed payload that was (or would be) sent to avoid divergence; use the richer projection for display only.
6) **Persistence (conditional)**: When chat-history-persistence (SQLite) is enabled, store replay metadata (replay_parent_turn_id/session_id, trimmed payload hash, version) so forks survive reloads; otherwise replay remains in-memory only with a one-level “restore previous replay” buffer per turn.

### Data & Control Flow
1. User edits and confirms send.
2. Build `ReplayChatSessionInit` from `EditableChatRequest.messages` (+ tool metadata, request options, intent/debug name).
3. Create/update replay session (Option A: one fork per turn; replays replace the prior fork for that turn); emit synthetic chat events to render bubbles in order:
   - System/prefix → system bubble (collapsed default).
   - Context/history → user/assistant bubbles tagged “replayed.”
   - Tool calls/results → assistant/tool bubbles with arguments/results (no re-execution).
   - Current user message → user bubble.
4. Replay starts display-only; user may click “Start chatting from this replay” to enable input. Subsequent input in the replayed session uses the trimmed edited history; original session remains intact.

### UX
- Badge: “Replayed prompt · <session tail>” with tooltip including source requestId.
- Collapse long system/history/tool content by default; “View replayed prompt”/“Collapse” toggles.
- Omit deleted sections; mark edited sections with an “Edited” chip.
- Warn if prompt was token-trimmed: “Prompt was trimmed; replay may omit truncated content.”
- Provide “Back to conversation” + “Open Live Request Editor” links. Replay is read-only until the user explicitly chooses “Start chatting from this replay.”
- Entry point: explicit “Replay edited prompt” action in the Live Request Editor banner. No surprise auto-launch; optional toast if auto-opened.
- Option A (one fork per turn): a new replay replaces the previous fork for that turn. Optional soft safety net: keep the last replaced fork in memory for “Restore previous replay.”
- When enabling input (continuing from fork), switch focus to the replay session and show a breadcrumb/toast indicating the fork.
- Cap rendered sections (30) and show “View replayed prompt (N more)” to avoid overloading the view.
- In replay/fork view, keep interception/auto-override off by default; expose a human toggle if needed. In off mode, disable edit/delete controls and auto-scroll to the latest section.

### Configuration / Flags
- `github.copilot.chat.liveRequestEditor.timelineReplay.enabled` (default: false).
- Command visibility tied to Live Request Editor advanced flag + replay flag; optional per-user opt-in to avoid surprises.

### Telemetry / Diagnostics
- Emit replay invocation telemetry with source sessionId/requestId, section counts, edited/deleted counts, and the trimmed payload hash/version.
- Log parity mismatches between replay content and the last logged request when available; surface warnings in replay + metadata views.

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
- Do we keep interception/auto-override disabled by default on the fork, or allow opt-in inheritance?
- Can we reduce modes to two user-facing states in replay: “View replay” (read-only) and “Start chatting from this replay” (continues fork), with interception/auto-override remaining off unless explicitly toggled?

## Tiny Diagram

```
Live Request Editor (edits/undo/redo)
        |
        v
Replay Builder (projection, trimmed payload)
        |
        v
Replayed Session (chat view)
   - Display-only by default
   - “Start chatting from this replay” => enable input (fork)
```

## Sync & Parity Notes
- Single source of truth: Live Request Editor service state (trimmed messages + metadata). Replay builds from that state; no divergent copies.
- Version/hash: Each replay build should carry `version`/`lastUpdated` and a payload hash; UIs ignore stale updates and surface parity state.
- Parent linkage: Stamp replay sessions with `replay_parent_session_id` and `replay_parent_turn_id` for unambiguous lookup (persist when SQLite persistence is enabled).
- Payload parity: Replay uses the exact trimmed payload sent/queued; projection is display-only. If edits/undo change the payload, bump version and invalidate/rebuild replay.
- Event scoping: Emit changes keyed by session; views render only when targeting that session to avoid bleed.
- Stale handling: If the request is cleared/canceled/context-switched, mark replay as stale/cleared rather than freezing old data.
- Debounce/merge: Debounce rapid edits before emitting to replay to reduce flicker; coalesce updates.
- Parity warning: If logged request hash ≠ replay hash, surface a warning chip/banner in replay and metadata views; include hashes/versions in metadata for persistence.

## Global Mode Interactions (Interception/Override/Replay)
- Defaults: Interception OFF, Auto-apply OFF, Replay manual (flag off by default). Replay is additive and does not replace interception/override.
- Independence: Replay does not pause sends; interception is the only pause mechanism. Auto-apply persists prefix edits; replay does not.
- UI simplicity: In the replay view, keep interception/override OFF by default. If users toggle them, reflect the state but default remains off.
- Transition guidance:
  - Interception ON → user edits → may replay before resuming. Replay state machine still applies.
  - Auto-apply ON → edits are applied automatically on later turns; replay remains a manual audit/fork tool.
  - Replay does not alter interception/override settings; these modes are orthogonal and should be surfaced separately to avoid mode sprawl.
