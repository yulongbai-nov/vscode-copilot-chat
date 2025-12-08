# Requirements Document: Chat History Persistence (SQLite)

## Introduction
Opt-in local persistence of chat history (original + edited prompts, tool calls/results, responses) using SQLite for reload/audit across restarts. No implementation yet.

## Requirements

### R1: Opt-in and Trust
- THE System SHALL gate persistence behind an advanced setting/command (“Persist chat history (SQLite)”).
- WHEN the workspace is untrusted, THEN persistence SHALL remain disabled unless the user explicitly opts in.

### R2: Data Captured
- THE System SHALL persist conversations, turns, sections, tool calls/results, and responses; attachments are optional and disabled by default.
- THE System SHALL record both original and edited messages and request options per turn, plus `replay_parent_session_id` and `replay_parent_turn_id` when applicable, and persist replay parity metadata (`replay_payload_hash`, `replay_payload_version`, `last_logged_hash`, `last_logged_at`).

### R3: Limits and Pruning
- THE System SHALL enforce configurable limits (max DB size, max turns per conversation).
- WHEN limits are exceeded, THEN the System SHALL prune oldest data and vacuum periodically without blocking chat.

### R4: Reliability and Safety
- WHEN SQLite open/migration fails, THEN the System SHALL disable persistence for the session and warn without blocking chat.
- THE System SHALL handle SQLITE_BUSY with retry/backoff and remain append-only (no in-place edits).
- THE System SHALL provide a reset/drop command to rebuild the DB on user approval if corruption is detected.

### R5: Privacy and Export
- THE System SHALL avoid network writes; storage remains local. Raw file content SHALL NOT be stored unless attachments are explicitly enabled.
- THE System SHALL provide export (JSON/markdown) and delete/purge commands for persisted conversations.

### R6: Observability
- THE System SHOULD expose a status hint (e.g., in metadata/replay UI) showing whether a conversation is persisted and how many turns are stored.
- THE System SHOULD emit non-blocking telemetry/errors for persistence failures and pruning events (without user content).
- WHEN a remote persistence driver is enabled, THEN the System SHALL surface a clear indicator that data may leave the machine and require explicit consent.
