# Specs Index

- **request-logger-prompt-editor** — Active implementation. Live Request Editor (prompt inspector, interception, auto-override); specs under `.specs/request-logger-prompt-editor/`.
- **chat-timeline-replay** — Active implementation. Replay/fork edited prompts into the chat timeline (read-only by default, fork to continue); specs under `.specs/chat-timeline-replay/`.
- **chat-history-persistence** — Design fleshed out (SQLite-backed persistence, opt-in); implementation not started. Specs under `.specs/chat-history-persistence/`.
- **graphiti-memory-integration** — Stubbed concept for optional Graphiti mirroring; no implementation.
- **chat-api-migration** — Parked. Prompt Section Visualizer code is absent; migration to native chat APIs deferred until re-scoped.
- **workflow-coach** — MVP implemented. Advisory CLI script that inspects repo state + current request and prints workflow reminders for the agent/human.
