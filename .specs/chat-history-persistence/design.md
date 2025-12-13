# Design Document: Chat History Persistence (SQLite)

## Overview
Persist chat conversations (original and edited prompts, tool calls/results, responses) locally using SQLite so users can reload or audit across restarts. Scope is per-user and per-machine; no shared hosting or cloud sync. The Live Request Editor stays in-memory; only finalized turns append to storage.

### Goals
- Durable local history with replay lineage that survives VS Code restarts.
- Append-only writes with schema versioning and safe failure handling.
- Configurable retention (size and per-conversation caps) plus export and purge commands.

### Non-Goals
- Cloud backup or cross-device sync.
- Multi-user tenancy in a single database.
- Storing raw file content by default (attachments remain optional and opt-in).

## Current Architecture
- Chat sessions and the Live Request Editor are in-memory only; closing VS Code drops history.
- Timeline replay and request logging rely on transient data; no persistence hooks exist.
- No feature flag, commands, or UX affordance for persistence.

## Proposed Architecture
Use a SQLite database in the extension's global storage folder, guarded by feature flag and workspace trust. A persistence service opens and migrates the database, exposes append/list/get APIs, and runs pruning and vacuum jobs. UX surfaces opt-in, export, purge, and a status hint; chat flows continue even if persistence is disabled or fails.

### Components
- **Config and Trust Guard**: Feature flag/setting ("Persist chat history (SQLite)") plus workspace trust check; disables persistence when untrusted unless explicitly overridden.
- **Database Manager**: Opens the SQLite file with WAL and foreign_keys, runs migrations keyed by `schema_version`, integrity checks, and PRAGMAs.
- **Persistence API**: Append-only methods (`beginConversation`, `appendTurn`, `appendResponse`, `appendToolCall`) plus `listConversations`, `getConversation`, and `getTurn`. Preserves `replay_parent_turn_id` linkage for replayed forks.
- **Pruner**: Enforces database size cap and per-conversation turn cap; cascades deletes and triggers vacuum on thresholds or schedule.
- **Exporter and Purger**: Commands to export conversation(s) to JSON/markdown and to purge or reset the database (with confirmation and telemetry).
- **Status and Telemetry**: Non-blocking telemetry for open, migration, and pruning failures (no user content) and a status hint in metadata or replay UI showing persistence state and counts.
- **Optional Attachments**: Attachment table behind an additional opt-in; hashes large blobs and enforces per-item size limit.

### Storage Model and Schema (v1)
```
conversations(id PK, user_id, workspace_id, location, created_at, last_active_at, status)
turns(id PK, conversation_id FK, turn_index, request_id, original_messages_json,
      edited_messages_json, request_options_json, model, max_prompt_tokens,
      interception_mode, replay_parent_turn_id, created_at)
sections(id PK, turn_id FK, seq, role, label, content, deleted, token_count,
         trace_path_json, metadata_json, tool_call_id, tool_result_id)
responses(id PK, turn_id FK, model, content_json, metadata_json, created_at)
tool_calls(id PK, turn_id FK, name, args_json, result_json, created_at)
attachments(id PK, turn_id FK, uri, hash, bytes BLOB, created_at) -- optional and opt-in
references/edges/embeddings tables reserved for future graph or FTS use
```
- Indexes: ordering (conversation → turns → sections), lookups by `request_id`, `replay_parent_turn_id`, and recency; FTS virtual tables for `sections` and `responses` to enable search once required.
- PRAGMAs: `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`, busy timeout.

### Data and Control Flow
1) **Enable**: On activation, if flag on and workspace trusted, open database → migrate → integrity check; on failure disable persistence for the session and surface a warning.
2) **Write**: When a conversation starts, call `beginConversation`; finalized sends call `appendTurn` (trimmed payload, request options, replay parent link); tool calls/results and assistant responses append via `appendToolCall` and `appendResponse`. Writes are append-only.
3) **Read and Restore**: `listConversations` (ordered by `last_active_at`) and `getConversation` hydrate turns, sections, and responses for replay or audit views; lazily hydrate attachments when enabled.
4) **Prune and Vacuum**: After writes or on schedule, enforce database size cap and per-conversation turn cap by deleting oldest data; vacuum on threshold or explicit command.
5) **Export and Purge**: Commands export selected conversation(s) to JSON/markdown; purge/reset drops and recreates the database after user confirmation.
6) **Failure Path**: On open, migration, or busy errors, log telemetry, show a non-blocking warning, and run chat without persistence; retries allowed per session.

## Integration Points
- **Live Request Editor and chat send pipeline**: Append finalized turns (trimmed payload, request options, interception mode) after send succeeds; no changes to editor UX.
- **Replay**: Store `replay_parent_turn_id` and session linkage so replay forks survive reloads; parity hashing can be persisted for stale detection.
- **Configuration service**: Settings and flag for enablement, caps (database size and per-conversation turns), and attachments opt-in.
- **Telemetry**: Non-content events for enable/disable, migration result, prune or vacuum actions, export, and purge.
- **Commands and Status UI**: Commands for enable/disable, export, purge/reset; status chip in metadata or replay surfaces persistence state and counts.

## Migration and Rollout Strategy
- Ship behind flag; default OFF. Respect workspace trust and require explicit opt-in.
- Migrations keyed by `schema_version`; v1 creates core tables, indexes, and FTS. Future schema changes prefer `ALTER TABLE ... ADD COLUMN`; rebuild FTS when necessary.
- Run migrations in a transaction, then `PRAGMA integrity_check`; on failure, disable persistence and keep chat running.
- Provide a reset command that drops and recreates the database after confirmation to recover from corruption.

## Performance, Reliability, Security, and UX Considerations
- **Retention**: Configurable database size cap and per-conversation turn cap; prune oldest first; vacuum periodically to control file growth.
- **Concurrency**: SQLite locking with busy timeout and retry/backoff; keep writes small and append-only.
- **Privacy**: No network writes; default is metadata plus messages, tool calls, and responses only. Attachments are off by default and size-limited.
- **Resilience**: Fail-open on errors, with telemetry and user-facing warnings; never block chat on persistence.
- **Observability**: Status hint surfaces whether persistence is active and how many turns are stored; telemetry captures failure reasons and prune actions without content.

## Risks and Mitigations
- **Database bloat**: Enforce caps, prune, and vacuum; optional export-and-purge guidance.
- **Corruption**: Migrations in transactions, integrity check, reset command, fail-open path.
- **Multi-window races**: SQLite WAL with busy retry; keep operations small and append-only.
- **Privacy and PII**: Trust gate, opt-in flag, attachments off by default, avoid raw file blobs unless explicitly requested.
- **Schema drift**: Versioned migrations and compatibility checks; do not write when version mismatch is detected.

## Future Enhancements
- Enable FTS-backed search in chat history and request logger views.
- Add graph tables (references, edges, embeddings) to power memory or Graphiti ingestion.
- Compress or export bundles for support tickets or sharing.
- Optional per-workspace database split to isolate large workspaces.
