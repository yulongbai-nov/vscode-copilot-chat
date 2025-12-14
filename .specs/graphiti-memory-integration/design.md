# Design Document: Graphiti Memory Integration

## Overview
Integrate Copilot Chat’s **conversation history** (user/assistant turns) with an external **Graphiti REST service** so
advanced users can opt-in to graph-native memory/auditing. The integration is **disabled by default**, requires
**workspace trust + explicit consent**, and must **never block chat**.

This spec is intentionally incremental:
1) Ship a safe **connection test** + ingestion plumbing behind flags.
2) Add **multi-scope recall** (“memory”) into the agent prompt behind an additional opt-in.
3) Add **manual promotion** flows for durable, cross-session memories (decisions, lessons learned).

### Goals
- Opt-in, trusted-workspace-only network integration to a configured Graphiti endpoint.
- Ingest finalized chat turns (user + assistant) as Graphiti “message episodes” keyed by a stable `group_id`.
- Backfill existing in-memory conversation history after enablement (bounded + non-blocking) so Graphiti can recall within the same session.
- Provide a built-in “test connection” flow that validates basic service connectivity without sending user content by default.
- (Optional) Recall relevant facts from Graphiti and inject them into the agent prompt (fail-open).
- Fail open: Graphiti outages must not impact chat send/receive.

### Non-Goals
- Implementing chat history persistence (tracked separately in `.specs/chat-history-persistence`).
- Uploading attachments or file contents by default.
- Requiring Graphiti to be installed; the feature remains optional and off by default.
- Full-fidelity mirroring of internal prompt composition (system/context/tool traces) in the first iteration.

## Current Architecture
- Copilot Chat maintains conversation state in-memory; there is no local persistence yet.
- Turn state is stored in `IConversationStore` after each request/response completes.
  - See `this._conversationStore.addConversation(...)` in
    `[src/extension/prompt/node/chatParticipantRequestHandler.ts#L284](src/extension/prompt/node/chatParticipantRequestHandler.ts#L284)`.
- The request logger captures outgoing ChatML requests (`messages`) for observability via `IRequestLogger`.
  - See `ILoggedPendingRequest.messages` in
    `[src/platform/requestLogger/node/requestLogger.ts#L130](src/platform/requestLogger/node/requestLogger.ts#L130)`.
- Chat sessions have a stable `sessionId` (used for telemetry and agent flows).
  - Example: `getOrCreateSessionId(...)` usage in
    `[src/extension/conversation/vscode-node/remoteAgents.ts#L212](src/extension/conversation/vscode-node/remoteAgents.ts#L212)`.
- The agent prompt is composed in `AgentPrompt`, which supports inserting additional prompt elements.
  - See the conversation-history insertion point in
    `[src/extension/prompts/node/agent/agentPrompt.tsx#L118](src/extension/prompts/node/agent/agentPrompt.tsx#L118)`.
- No Graphiti settings, services, or commands exist in this repo today.

## Proposed Architecture

### High-level Shape
```
Copilot Chat (turn finalized)
   └─> GraphitiMemoryService (gate + queue + mapping)
          └─HTTP─> Graphiti REST Service (FastAPI)
                    └─> Graph DB backend (Neo4j or FalkorDB)
```

Recall path (optional):
```
Copilot Chat (before prompt render)
   └─> GraphitiRecallService (gate + timeout + merge)
          └─HTTP─> Graphiti REST Service (`/search` or `/get-memory`)
                └─> facts injected into AgentPrompt as a tagged section
```

### Graphiti Service Contract (current)
We target the Graphiti FastAPI service endpoints (as implemented in the Graphiti repo under `server/graph_service/*`):
- `GET /healthcheck` → basic liveness
- `POST /messages` → enqueue message episodes for ingestion (async)
- `POST /search` / `POST /get-memory` → retrieve facts (future scope for Copilot integration)
- `DELETE /group/{group_id}` → cleanup (used only for an explicit smoke test flow)

### Components
- **`GraphitiClient` (new, TS)**: thin HTTP wrapper (timeouts, headers, JSON) around the Graphiti REST API.
  - `healthcheck()`, `addMessages(groupId, messages)`, `deleteGroup(groupId)`, optional `search(...)`.
- **`GraphitiMemoryService` (new, VS Code service)**:
  - Owns config/trust/consent gating.
  - Provides a bounded, fail-open ingestion queue with retry/backoff.
  - Maps Copilot chat turns → Graphiti `Message[]`.
- **`GraphitiRecallService` (new, VS Code service; optional)**:
  - Owns recall gating (trust/consent + `recall.enabled`).
  - Calls Graphiti retrieval APIs with strict timeouts and merges results across scopes.
  - Formats facts into a compact prompt snippet suitable for `AgentPrompt`.
- **`GraphitiIngestionQueue` (internal helper)**:
  - Coalesces messages and batches `POST /messages` calls.
  - Enforces `maxQueueSize`, `maxBatchSize`, `timeoutMs`, and truncation limits.
- **`GraphitiTestConnection` command**:
  - Performs connectivity checks (`/healthcheck`, optionally `/openapi.json`).
  - Optional “smoke test” mode that writes to a temporary `group_id` and then deletes it.
- **`GraphitiPromoteToMemory` command (optional)**:
  - Creates higher-signal, structured “episodes” (decisions, lessons learned, repo state) on explicit user action.

### Identifiers and Mapping

#### Scopes → Graphiti groups
We support multiple “memory scopes” and map each scope to a Graphiti `group_id`:
- **Session scope**: one Copilot chat conversation/thread.
- **Workspace scope**: the VS Code workspace/repo across sessions.
- **User scope (global)**: cross-workspace, durable “lessons learned” and preferences (manual promotion only by default).

Graphiti’s REST API accepts a single `group_id` per `/messages` request, so “both scopes” is implemented by **writing the
same episodes to two groups**.

Proposed identifiers:
- Graphiti `group_id` is restricted to ASCII alphanumerics plus `-` and `_` (`^[a-zA-Z0-9_-]+$`), so **do not** use dots, slashes, or paths.
- `sessionGroupId`: `cc_session_<sessionId>` (or `cc_session_<hash>`)
- `workspaceGroupId`: `cc_workspace_<workspaceKeyHash>`
- `userGroupId`: `cc_user_<userKeyHash>`

`workspaceKey` is derived from workspace identity (e.g., workspace folders + detected git root), with a strong preference
for a **hashed** representation to avoid leaking local paths.

`userKey` should be a randomly generated stable identifier stored in extension global storage (never derived from a local
username), then hashed for `group_id` display.

#### Message identity and idempotency
- **v1 (recommended): omit `uuid`** and let Graphiti create episode identifiers.
  - Rationale: the current Graphiti service implementation passes `uuid` into `graphiti.add_episode(...)`, which treats
    `uuid` as “load an existing episode” and can fail for brand-new IDs; deterministic idempotency must be treated as a
    follow-up once Graphiti supports create-with-uuid semantics.
- **Best-effort client-side dedupe (v1)**: to avoid duplicate ingestion when chat history is rehydrated, maintain an
  in-memory “seen turn IDs” set per target `group_id` and skip enqueueing turns already seen for that `group_id`.
- **Debuggable message identity (v1)**: populate `Message.name` with a stable identifier derived from the Copilot Chat
  response/turn ID (e.g. `copilotchat.turn.<turnId>.<role_type>`), without sending `uuid`.
- **v2 (optional): deterministic UUIDs** (only once supported end-to-end).
  - Graphiti episodic nodes are merged by `uuid` (not `(uuid, group_id)`), and `group_id` is stored as a property on the
    node; therefore, **UUIDs must be scope-qualified** if we ever re-enable deterministic UUIDs.

#### Role/content mapping
- **Role mapping**: map user/assistant chat messages to Graphiti `role_type: 'user'|'assistant'`.
  - System/context prompts are excluded by default in v1 (privacy + lower value for memory).
- **Message content**: send only user-visible text content; apply truncation with explicit markers when over limits.

#### Optional workspace metadata enrichment (git/branch/commit)
We can attach environment metadata to aid audit/debug and (optionally) improve recall:
- Add a structured `source_description` string per message when `includeGitMetadata` is enabled, e.g.:
  ```json
  {"source":"copilotchat","scope":"workspace","git":{"branch":"main","commit":"abc123","dirty":true}}
  ```
- Avoid local file paths and file contents in `source_description`. (The `group_id` already carries the partition key.)

If we want Graphiti to *extract* “facts” about branch/commit, we can additionally emit a periodic/system “workspace
context” episode into the workspace scope when git state changes (explicit opt-in; higher privacy risk).

#### Recommended episode kinds and relation vocabulary (v0)
Graphiti extracts “facts” from natural language, so the most practical way to shape relations is to ingest a small set of
high-signal episode templates (especially for workspace/global scopes).

Episode kinds we can support without changing the Graphiti service API:
- **`chat_turn`**: user + assistant messages (default session/workspace ingestion).
- **`repo_state`**: branch/commit/dirty + key commands (workspace only; opt-in).
- **`task_update`**: current plan, status, blockers (workspace; optionally promoted).
- **`decision`**: architecture decisions + rationale + alternatives (workspace; promoted).
- **`lesson_learned` / `preference` / `procedure`**: durable user/global guidance (user-global; manual promotion).

Suggested canonical relation names (keep small; map synonyms at recall time):
- **Planning/PM**: `DEPENDS_ON`, `BLOCKED_BY`, `DECIDED`, `RISK`, `MITIGATED_BY`, `DONE`, `TODO`
- **Coding**: `TOUCHES`, `DEFINED_IN`, `USES`, `FIXES`, `CAUSES`, `TESTED_BY`
- **Agent workflow**: `RAN`, `GENERATED`, `FAILED_WITH`, `VALIDATED_BY`

Note: richer, typed relations (custom edge attribute schemas) would require extending the Graphiti service API or using
the Graphiti SDK/MCP server directly; v1 should start with templates + a small canonical vocabulary.

## Data & Control Flow

### 1) Enablement / Consent
1. User enables Graphiti integration via setting.
2. If workspace is untrusted, integration remains disabled and shows a one-time explanation.
3. On first enable in a trusted workspace, show a consent prompt summarizing:
   - destination endpoint
   - what data is sent (user/assistant chat turns only, by default)
   - how to disable and purge (if supported)

### 2) Turn Finalization → Ingestion
1. A chat turn completes (assistant response finalized).
2. `GraphitiMemoryService` receives the finalized user + assistant messages and maps them to Graphiti DTOs.
3. For each enabled scope (session/workspace), enqueue messages for background flush (`POST /messages`) using that scope’s `group_id`.
4. In the same step, attempt a bounded **history backfill**: enqueue a limited number of prior successful turns from the
   current in-memory conversation that have not yet been seen for the target `group_id`.
5. On network errors, retry with backoff until queue bounds are reached; never block chat.

### 3) Connection Testing
1. Command validates endpoint format and calls `GET /healthcheck`.
2. Optional smoke test:
   - `POST /messages` into temporary group
   - (optional) poll `GET /episodes/<group>?last_n=...` to confirm receipt
   - `DELETE /group/<group>` cleanup

### 4) Recall (optional) → Prompt Injection
1. User enables `recall.enabled` (in a trusted workspace, with Graphiti integration already consented).
2. Before the prompt is rendered, `GraphitiRecallService` builds a retrieval query from:
   - current user prompt
   - small window of prior turns (and/or their summaries)
   - optional workspace context (repo name, branch/commit) if enabled
3. `GraphitiRecallService` calls Graphiti retrieval:
   - session scope (`sessionGroupId`)
   - workspace scope (`workspaceGroupId`)
   - user scope (`userGroupId`) only if enabled and explicitly populated (manual promotion)
4. The service merges and truncates facts under a token/size budget (default ordering: session > workspace > user).
5. Facts are injected into the agent prompt as a dedicated tagged section (e.g., `graphiti_memory`) and chat proceeds
   regardless of retrieval success/failure.

## Integration Points
- **Configuration** (new settings under `github.copilot.chat.memory.graphiti.*`):
  - `enabled` (boolean, default `false`)
  - `endpoint` (string)
  - `apiKey` (string, optional; header-based)
  - `timeoutMs`, `maxBatchSize`, `maxQueueSize`
  - `scopes` (`session` | `workspace` | `both`)
  - `groupIdStrategy` (`raw` | `hashed`) — `raw` is sanitized to Graphiti-safe characters (`[a-zA-Z0-9_-]`) and may be truncated with a hash suffix
  - `includeSystemMessages` (boolean, default `false`)
  - `includeGitMetadata` (boolean, default `false`) — include branch/commit/dirty in `source_description`
  - (optional) `recall.enabled` (boolean, default `false`)
  - (optional) `recall.maxFacts` / `recall.timeoutMs` / `recall.scopes` (default: session+workspace)
- **Trust**: gate on VS Code workspace trust API.
- **Commands**:
  - `github.copilot.chat.memory.graphiti.testConnection`
  - (optional) `...purgeGroup` for explicit cleanup workflows
  - (optional) `...promoteToMemory` (manual, durable episodes)
- **Telemetry / Logging**: non-content events for connectivity, enqueue attempts, HTTP failures, and queue drops.

## Migration / Rollout Strategy
- Ship behind settings; default OFF.
- Gradually enable richer ingestion (system/tool/context) only after v1 is stable and privacy posture is agreed.

## Performance / Reliability / Security / UX Considerations
- **Non-blocking**: Graphiti calls are always async/background; chat UX remains responsive.
- **Timeouts**: all HTTP calls bounded by `timeoutMs`.
- **Backoff + bounds**: retry with jittered backoff; drop oldest items when queue is full (with telemetry).
- **Privacy defaults**:
  - only user/assistant chat text, truncated
  - no attachments
  - system/context prompts excluded unless explicitly enabled
- **User feedback**: connection test provides clear output; ingestion failures are non-intrusive (log + optional status indicator).

## Local Dev: Basic Service Connectivity Checks
Assuming services are already running (your current environment):
- Graphiti API: `http://graph:8000`
- Neo4j HTTP: `http://neo4j:7474`
- Neo4j Bolt: `bolt://neo4j:7687`
- (Optional) FalkorDB Graphiti variant: `http://graph-falkordb:8001`
- (Optional) Graphiti MCP server: `http://graphiti-mcp:8000` (health: `/health`, MCP endpoint: `/mcp/`)

Minimal checks:
```bash
curl -fsS http://graph:8000/healthcheck
curl -fsS http://graph:8000/openapi.json | head
curl -fsS http://neo4j:7474/ | head
```

Basic Graphiti ↔ DB check (no LLM required; should return `404` not `500`):
```bash
curl -sS -D - http://graph:8000/entity-edge/not_a_real_uuid | head
```

Optional write+cleanup smoke test (explicit, non-default):
```bash
GROUP_ID="copilot-chat-smoke-$(date +%s)"
curl -fsS -X POST http://graph:8000/messages -H 'content-type: application/json' -d "{\"group_id\":\"$GROUP_ID\",\"messages\":[{\"role_type\":\"user\",\"role\":\"\",\"content\":\"smoke test\"}]}"
curl -fsS "http://graph:8000/episodes/$GROUP_ID?last_n=5"
curl -fsS -X DELETE "http://graph:8000/group/$GROUP_ID"
```

Optional retrieval check (LLM/embeddings required; should return `200` with `{facts:[...]}`):
```bash
curl -fsS -X POST http://graph:8000/search -H 'content-type: application/json' -d "{\"group_ids\":[\"$GROUP_ID\"],\"query\":\"smoke\",\"max_facts\":3}"
```

## End-to-End Validation (Copilot Chat ↔ Graphiti)
This is a practical “does it work?” checklist to validate the full loop:
**Copilot Chat turn finalization → Graphiti ingestion → Graphiti search → (optional) Copilot recall injection**.

Demo walkthrough: [`docs/demos/graphiti-memory-integration/README.md`](../../docs/demos/graphiti-memory-integration/README.md)

### 1) Configure Copilot Chat (VS Code)
- Ensure the workspace is trusted.
- Set:
  - `github.copilot.chat.memory.graphiti.endpoint` = `http://graph:8000`
  - `github.copilot.chat.memory.graphiti.enabled` = `true`
- Accept the consent prompt (required once per endpoint + workspace).

### 2) Run the built-in connection test (VS Code)
- Run command: `GitHub Copilot Chat: Test Graphiti Connection`
- Select `Smoke test (writes + deletes)` and confirm.
- Check output channel: `GitHub Copilot Chat: Graphiti Memory`
  - Expect: `✓ GET /healthcheck`, `✓ POST /messages`, and `✓ GET /episodes/{group_id}?last_n=1`.

### 3) Validate ingestion + retrieval (terminal)
- Send a chat message that includes a unique phrase (example: `graphiti-e2e-<timestamp>`).
- After a few seconds, confirm Graphiti can retrieve facts using global search (no `group_id` required):
```bash
curl -fsS -X POST http://graph:8000/search -H 'content-type: application/json' \
  -d '{"query":"graphiti-e2e-<timestamp>","max_facts":5}'
```

### 4) Validate recall injection (VS Code, optional)
- Set:
  - `github.copilot.chat.memory.graphiti.recall.enabled` = `true`
  - `github.copilot.chat.memory.graphiti.recall.scopes` = `both` (or `all` to include User Scope)
- Ask a follow-up that should benefit from recalled memory.
- If using a prompt inspection tool (request logger / prompt inspector), confirm a `graphiti_memory` section appears in the rendered prompt.

### 5) Validate promotion flows (VS Code, optional)
- Run command: `GitHub Copilot Chat: Promote to Graphiti Memory`
- Choose `Workspace Scope` or `User Scope (Global)` and a kind (e.g., `Lesson Learned`).
- Confirm retrieval via global search:
```bash
curl -fsS -X POST http://graph:8000/search -H 'content-type: application/json' \
  -d '{"query":"<some unique part of the promoted text>","max_facts":5}'
```

### Optional: Graphiti MCP Server Smoke Checks
The Graphiti MCP server uses the MCP **streamable HTTP** transport (SSE) at `/mcp/` and a simple health endpoint at
`/health`.

Minimal checks:
```bash
curl -fsS http://graphiti-mcp:8000/health
```

Tooling sanity check (list tools and get status) using raw JSON-RPC over `/mcp`:
```bash
SESSION_ID=$(curl -sS -D - -o /dev/null -X POST http://graphiti-mcp:8000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  | awk 'tolower($1)=="mcp-session-id:"{print $2; exit}' | tr -d '\r')

curl -sS -X POST http://graphiti-mcp:8000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | head

curl -sS -X POST http://graphiti-mcp:8000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_status","arguments":{}}}' | head
```

### Troubleshooting (common local setup issues)
- If `POST /messages` returns success but `GET /episodes/{group_id}` stays empty, Graphiti’s background ingestion worker
  may be failing. Check Graphiti container logs and verify LLM + embedding configuration (`OPENAI_API_KEY`,
  optional `OPENAI_BASE_URL`, `MODEL_NAME`, `EMBEDDING_MODEL_NAME`).
- If `POST /search` returns `500`, Graphiti retrieval is currently broken in this deployment; Copilot Chat Recall will
  fail open (no prompt injection) until the Graphiti service is fixed or configured correctly.
- If `POST /messages` returns success but `GET /episodes/{group_id}` stays empty **with no errors**, the Graphiti service
  may not be running its async worker at all (e.g. worker lifecycle not wired to the FastAPI app lifespan). Ensure the
  worker starts on app startup and that queued jobs do not capture request-scoped `Graphiti` instances that are closed at
  request end.

## Risks and Mitigations
- **Endpoint unreachable / flaky**: fail open, bounded queue, backoff, no chat impact.
- **Sensitive data exfiltration**: strict defaults (no system/context, no attachments), consent UX, trusted-workspace gate.
- **Duplicate ingestion**: Graphiti `/messages` is async and acknowledges with `202`, so v1 treats ingestion as best-effort; revisit deterministic UUIDs once supported.
- **Bad/stale recall**: strict caps + clear prompt framing (“may be stale”), and fail-open if retrieval fails.
- **Schema/API drift**: keep Graphiti integration behind a dedicated client adapter; validate against `/openapi.json` during connection tests.

## Open Questions
- Do we ingest only user/assistant, or also tool call summaries (as assistant text) for better memory?
- What is the expected operator story for purging data (per conversation group) from Graphiti?
- Should we plan an upstream Graphiti change to support create-with-uuid for deterministic idempotency?

## Future Enhancements
- Retrieval integration (`/get-memory`) to inject relevant facts into prompts behind an additional opt-in.
- Backfill from local SQLite history once `.specs/chat-history-persistence` lands.
- Richer mapping of tool calls/results, references, and replay lineage (requires either an expanded Graphiti API or an adapter endpoint).
- Support Graphiti MCP server as an alternative transport.
