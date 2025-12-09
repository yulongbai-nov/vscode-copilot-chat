# Chat Timeline Replay – Handoff (8 Dec 2025)

Branch: `feature/replay-ui-integration` (code + docs in tree)

## Source of Truth
- This doc; code in `src/extension/prompt/node/liveRequestEditorService.ts`, `src/extension/prompt/vscode-node/liveReplayChatProvider.ts`, `package.json` chatSessions entry.
- The older `.kiro/specs/...` references are superseded by this reality snapshot.

## Implementation Status (reality)
- Service plumbing: replay builder/state machine implemented (option A: one fork per turn, one-level restore buffer). Projections seeded from trimmed messages; hashes/versions tracked; stale on context change/cancel. `getOriginalRequestMessages` API added to recover pre-edit history.
- Chat integration: `replayPrompt` command exposed from Live Request Editor; replay chat participant registered. Rendering uses native chat: summary + per-section bubbles with labels/edited chip, cap=30 with overflow note, trimmed warning. Read-only entry; “Start chatting from this replay” enables handler. Replay chat session now supports attachments (files/problems/tools/images/symbols/search/scm) and uses replay participant id.
- Refresh behavior: replay resource URI includes `?version=…` so replays rebuild per edit; caching covers encoded/decoded URIs and hydrates from service; sample replay debug command works.
- Logging: `[LiveReplay]` logs for caching keys, content requests, state hits/hydration/misses; warns when settings persistence fails (interception flag).
- Gaps / TODO: telemetry events for replay invoke/parity not wired; SQLite persistence/Graphiti ingestion not yet implemented; parity UI not surfaced; interception/auto-override still off by default in replay.

## Next Tasks (parallel-friendly)
1) **Telemetry + parity surfacing**
   - Emit replay invocation + parity/stale telemetry (session/turn, counts, hashes).
   - UI: parity/stale banners in replay view; hook into metadata view.
2) **Persistence hooks**
   - When chat history SQLite is enabled, persist replay snapshots (parent IDs, hashes, version, payload/projection) and restore on startup; keep one-level restore buffer for in-memory mode.
3) **UX polish**
   - Add trimmed/overflow banners as persistent affordances; focus toast/breadcrumb when enabling input; optional “restore previous replay” command.
   - Ensure interception/auto-override toggles are visually disabled in replay when off.

## Ready State / Defaults
- Replay off by default; entry is read-only until “Start chatting from this replay.”
- One fork per turn; replay replacement overwrites prior snapshot; single restore buffer.
- Cap 30 sections; overflow message; trimmed warning.
- States: `idle → building → ready → forkActive → stale` (stale on cancel/context change or parity mismatch).

## Testing Pointers
- Unit: projection caps/edited/deleted, version/hash guards, restore buffer, state transitions, original-messages recovery.
- Integration: command availability; rendering (per-section bubbles, caps, trimmed warning); “Start chatting” enables handler and allows attachments/model picker; replay rebuilds on edit (versioned URI); sample replay command renders; interception off by default but toggleable separately.
- Persistence/telemetry: once added, verify replay snapshots saved/loaded and events emitted.

## Interrupt Handling (current behavior)
- Empty/invalid projection: “Nothing to replay,” read-only history, no handler.
- Mapping/hydration failure: warn; original session untouched.
- Trimmed prompt: warning part in replay view.
- Context change/cancel: mark replay stale; disable input.
- Re-replay same turn: replaces prior snapshot; restore buffer keeps last version only.
