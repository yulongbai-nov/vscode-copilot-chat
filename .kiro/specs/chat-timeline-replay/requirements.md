# Requirements Document: Chat Timeline Replay

## Introduction
Provide an opt-in chat timeline that mirrors the edited prompt (system/history/tool/user) after Live Request Editor edits, without invoking the model. Intended for auditing and confidence before/after send.

## Requirements

### R1: Opt-in Replay Invocation
- THE System SHALL expose a command (e.g., `github.copilot.liveRequestEditor.replayPrompt`) only when Live Request Editor is enabled and a pending/last edited request exists.
- WHEN the replay flag is disabled, THEN no replay UI or commands SHALL appear.
- WHEN invoked without an editable request, THEN the System SHALL show a friendly “Nothing to replay” message.
- THE System SHOULD support an explicit opt-in to avoid surprising users when replay launches.

### R2: Replay Projection Fidelity
- THE System SHALL build replay content from `EditableChatRequest.messages`, preserving order and edited content, and omitting deleted sections.
- WHEN sections were token-trimmed upstream, THEN the System SHALL surface a warning that replay may omit truncated content and reuse the same trimming/summarization applied during prompt render.
- WHEN tool calls/results are present, THEN the System SHALL render tool bubbles with names and arguments/results marked “replayed.”

### R3: Display and UX
- THE System SHALL render replay as chat bubbles (system/history/context/tool/user) with system/prefix collapsed by default.
- THE System SHALL label replay sessions as “Replayed prompt” and show source session/request identifiers in tooltip/description.
- THE System SHALL mark edited sections with an “Edited” indicator and omit deleted sections.
- THE System SHALL provide “View replayed prompt”/“Collapse” toggles for long sections and a link back to the Live Request Editor.

### R4: Session Handling
- THE System SHALL create or reuse a replay session keyed to the source session/location; original session remains intact.
- THE System SHALL allow only one replay fork per source turn; a new replay for the same turn SHALL replace the previous fork (Option A).
- WHEN a replay session is created, THEN the System SHOULD record a `replay_parent_turn_id` (or equivalent) for telemetry/persistence linkage.
- THE System SHALL avoid invoking the model; replay is display-only unless explicitly extended in future scope.
- WHEN chat history persistence (SQLite) is enabled, THEN the System SHOULD persist replay linkage/metadata so the fork survives reloads; otherwise the replay MAY remain in-memory only.

### R5: Telemetry and Errors
- THE System SHALL emit telemetry on replay invocation with source sessionId/requestId and counts of total/edited/deleted sections.
- WHEN replay content cannot be built (e.g., mapping failure), THEN the System SHALL show an error message and avoid creating a replay session.
- THE System SHOULD log parity mismatches when replay content differs from the last logged request, for diagnostics.
