# Implementation Plan: Chat History Persistence (SQLite)

- [ ] 0. Finalize scope and UX
  - Confirm opt-in/trust behavior and attachment policy.
  - Finalize limits (DB size, turns per conversation) and config surface.

- [ ] 1. Storage design spike
  - Prototype schema/migrations (v1 tables, indexes, FTS).
  - Evaluate WAL/locking, busy retry/backoff, and corruption handling.

- [ ] 2. Persistence layer
  - Implement DB open/migrate with `schema_version`, WAL, integrity checks.
  - Implement append-only APIs (`beginConversation`, `appendTurn`, `appendResponse`, prune/vacuum).
  - Add pruning logic respecting size/TTL caps.

- [ ] 3. UX and commands
  - Add opt-in setting/command; status hint in metadata/replay UI.
  - Add export (JSON/markdown) and purge/reset commands.

- [ ] 4. Safety and telemetry
  - Handle open/migration errors (disable + warn), SQLITE_BUSY retry.
  - Telemetry/logging for failures and pruning (no user content).

- [ ] 5. Tests
  - Unit/integration tests for migrations, append/prune, export/delete, and error paths.
