# Design Document: Chat History Persistence (SQLite)

## Overview
Persist chat conversations (original + edited prompts, tool calls/results, responses) locally using SQLite so users can reload/audit across restarts. Scope is per-user, per-machine; no multi-user hosting. No implementation exists yet.

## Current Reality
- No chat history persistence; Live Request Editor is in-memory only.

## Proposed Storage
- SQLite in the extension’s global storage folder.
- Tables (proposed): `conversations`, `turns`, `sections`, `responses`, `tool_calls`, optional `attachments`, plus `schema_version`, `references`, `edges`, `embeddings` for future graph/FTS needs.
- Suggested FTS indexes (`sections_fts`, `responses_fts`) and indexes for ordering/lookup.

### Schema Sketch
```
conversations(id PK, user_id, workspace_id, location, created_at, last_active_at, status)
turns(id PK, conversation_id FK, turn_index, request_id, original_messages_json, edited_messages_json,
      request_options_json, model, max_prompt_tokens, interception_mode, replay_parent_turn_id, created_at)
sections(id PK, turn_id FK, seq, role, label, content, deleted, token_count, trace_path_json, metadata_json,
         tool_call_id, tool_result_id)
responses(id PK, turn_id FK, model, content_json, metadata_json, created_at)
tool_calls(id PK, turn_id FK, name, args_json, result_json, created_at)
attachments(id PK, turn_id FK, uri, hash, bytes BLOB, created_at) -- optional
references/edges/embeddings tables optional for graph/FTS use
```

### API Layer (conceptual)
- Append-only writes per turn; no in-place edits.
- APIs: `beginConversation`, `appendTurn`, `appendResponse`, `listConversations`, `getConversation`, `vacuum/prune`.
- Preserve `replay_parent_turn_id` when timeline replay forks a session.

### Retention and Safety
- Size cap and TTL: configurable max DB size and max turns per conversation; prune oldest and vacuum periodically.
- Trust: disable in untrusted workspaces unless user opts in.
- Corruption handling: on DB open error, disable persistence and warn; never block chat.
- Privacy: no network writes; avoid storing raw file content unless attachments explicitly enabled; rely on OS/disk encryption where applicable.
- Export/delete: commands to export conversation to JSON/markdown and to purge all persisted data.

### Migrations
- Track via `schema_version`; run migrations in transactions.
- v1: core tables + indexes + FTS + PRAGMAs (foreign_keys ON, WAL).
- v2+: `ALTER TABLE ... ADD COLUMN` for new metadata; rebuild FTS if schema changes.
- Integrity: run `PRAGMA integrity_check` after migration; on failure, disable persistence and warn.
- Busy handling: retry/backoff on SQLITE_BUSY; writes remain append-only.
- Pruning: enforce limits, cascade deletes, `VACUUM` periodically; command to drop/recreate DB with user approval if corrupted.

## UX Integration
- Opt-in setting/command (advanced) “Persist chat history (SQLite)”.
- Status hint in metadata/replay UI showing persistence state and counts.
- Transparent to Live Request Editor: editor stays in-memory, finalized turns append to store.

## Risks / Mitigations
- DB bloat: enforce limits and scheduled vacuum.
- Multi-window races: rely on SQLite locking; retry/backoff on busy errors.
- Trust/privacy: gate on workspace trust; opt-in; avoid content storage unless necessary.
- Schema drift: versioning, safe migrations; fail-open with warnings rather than blocking chat.
