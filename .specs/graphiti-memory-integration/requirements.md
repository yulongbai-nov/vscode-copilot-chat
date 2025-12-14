# Requirements Document

## Introduction
This feature adds an **opt-in** integration between the Copilot Chat extension and an external **Graphiti REST service**
to ingest Copilot Chat **conversation history** (primarily user/assistant turns) for graph-native memory and auditing.

The integration is disabled by default, requires **workspace trust + explicit consent**, and must **never block chat**.

## Glossary
- **Graphiti Service** — The FastAPI service that exposes endpoints like `GET /healthcheck` and `POST /messages`.
- **Graphiti Group (`group_id`)** — A server-side partition key used to isolate episodes/facts for a single conversation or scope.
- **Episode** — A unit of ingested content in Graphiti (we ingest chat messages as “message episodes”).
- **Session Scope** — Memory partition scoped to a single Copilot chat conversation/thread.
- **Workspace Scope** — Memory partition scoped to the VS Code workspace/repo across multiple chat sessions.
- **User Scope (Global)** — Memory partition intended to persist “lessons learned” and preferences across workspaces (manual promotion by default).
- **Turn Finalization** — The point where a user prompt and the assistant response are considered complete and stable.
- **Backfill** — Opportunistically ingesting prior in-memory conversation turns after Graphiti is enabled, without blocking chat.
- **Connection Test** — A command that validates that the configured Graphiti endpoint is reachable and responds as expected.
- **Consent** — A one-time explicit user confirmation acknowledging that chat history will be sent to the configured endpoint.
- **Promotion** — An explicit user action that creates a structured, higher-signal episode (e.g., a decision or lesson learned).
- **Recall** — Retrieving relevant facts from Graphiti and injecting them into the agent prompt as additional context.

## Requirements

### Requirement 1 — Enablement, Trust, and Consent

**User Story:** As an advanced user, I want Graphiti integration to be opt-in and trust-gated so that my chat history is
not sent to external services unexpectedly.

#### Acceptance Criteria
1.1 THE `Copilot_Chat_Extension` SHALL gate Graphiti integration behind a setting (default `false`).  
1.2 WHEN the workspace is untrusted, THE `Copilot_Chat_Extension` SHALL keep Graphiti integration disabled and SHALL NOT
send any network requests to the Graphiti Service.  
1.3 WHEN the user enables Graphiti integration in a trusted workspace for the first time, THE `Copilot_Chat_Extension`
SHALL show a consent prompt describing what will be sent and the destination endpoint.  
1.4 WHEN Graphiti integration is disabled, THEN no *automatic* Graphiti network calls SHALL occur (ingestion, recall).  

### Requirement 2 — Configuration (Endpoint, Timeouts, Limits)

**User Story:** As a developer/operator, I want to configure where Graphiti runs so that I can use local Docker or a
remote deployment.

#### Acceptance Criteria
2.1 THE `Copilot_Chat_Extension` SHALL provide a setting to configure the Graphiti Service endpoint URL.  
2.2 THE `Copilot_Chat_Extension` SHALL support a configurable request timeout (`timeoutMs`).  
2.3 THE `Copilot_Chat_Extension` SHALL enforce configurable limits for ingestion (at minimum: `maxBatchSize`,
`maxQueueSize`, and a per-message content length cap).  
2.4 WHEN the endpoint is missing or invalid, THEN the `Copilot_Chat_Extension` SHALL treat Graphiti integration as
disabled for that session and SHALL provide a clear error in the connection test output.  
2.5 THE `Copilot_Chat_Extension` MAY support an optional API key/header for authenticated Graphiti deployments.  
2.6 THE `Copilot_Chat_Extension` SHALL provide a setting to select ingestion scopes: `session`, `workspace`, or `both`.  
2.7 THE `Copilot_Chat_Extension` SHALL provide a setting to select a `group_id` strategy (`raw` vs `hashed`).  
2.8 THE `Copilot_Chat_Extension` SHALL provide a setting to include git metadata (branch/commit/dirty) in Graphiti message
metadata, and it SHALL be off by default.  
2.8.1 WHEN `github.copilot.chat.memory.graphiti.includeGitMetadata` is enabled, THEN the `Copilot_Chat_Extension` SHALL
include branch, commit, and dirty state (when available) in `Message.source_description` without including local file paths.  
2.9 THE `Copilot_Chat_Extension` MAY provide settings to enable Recall and to configure recall limits (timeout + max facts),
and they SHALL be off by default.  

### Requirement 3 — Connection Test Command

**User Story:** As a developer, I want a built-in connection test so that I can verify Graphiti + backing services are
reachable before enabling ingestion.

#### Acceptance Criteria
3.1 THE `Copilot_Chat_Extension` SHALL expose a command to test connectivity to the configured Graphiti endpoint.  
3.2 The connection test SHALL call `GET /healthcheck` and SHALL report success/failure to the user.  
3.3 BY DEFAULT, the connection test SHALL NOT send any user chat content to Graphiti.  
3.4 The connection test MAY offer an explicit “smoke test” mode that writes to a temporary `group_id` and then cleans up
by calling `DELETE /group/{group_id}`.  
3.5 WHEN the smoke test mode is used, THEN the `Copilot_Chat_Extension` SHALL clearly indicate that data is being sent
and SHALL attempt cleanup even if intermediate steps fail.  
3.6 WHEN the smoke test mode is used, THEN the `Copilot_Chat_Extension` SHALL attempt to verify background processing by
polling `GET /episodes/{group_id}?last_n=...` for a bounded time and SHALL report a warning if no episodes become visible.  

### Requirement 4 — Ingest Finalized Chat History

**User Story:** As an advanced user, I want my chat conversation history ingested into Graphiti so that it can be used
for memory and auditing.

#### Acceptance Criteria
4.1 WHEN Graphiti integration is enabled and consented, THEN on turn finalization the `Copilot_Chat_Extension` SHALL
enqueue the user and assistant messages for ingestion to Graphiti via `POST /messages`.  
4.2 The `Copilot_Chat_Extension` SHALL derive a stable `group_id` for Session Scope (default: the conversation
`sessionId` or an equivalent stable identifier).  
4.3 The `Copilot_Chat_Extension` SHALL derive a stable `group_id` for Workspace Scope (default: a stable workspace/repo
identifier).  
4.4 WHEN ingestion scope is set to `both`, THEN the `Copilot_Chat_Extension` SHALL ingest the same finalized messages
into both the session and workspace `group_id`s.  
4.5 BY DEFAULT, the `Copilot_Chat_Extension` SHALL NOT send `uuid` values in Graphiti `Message` payloads.  
4.6 BY DEFAULT, the `Copilot_Chat_Extension` SHALL ingest only user and assistant messages (excluding system/context
prompts).  
4.7 WHEN message content exceeds the configured cap, THE `Copilot_Chat_Extension` SHALL truncate with a clear marker.  
4.8 WHEN Graphiti integration is enabled+consented and the current conversation contains prior successful turns that are
not yet ingested for the target `group_id`, THEN the `Copilot_Chat_Extension` SHALL backfill a bounded number of those
turns asynchronously (best-effort) without blocking chat.  
4.9 The `Copilot_Chat_Extension` SHOULD perform best-effort de-duplication so a given finalized turn is not enqueued
multiple times for the same `group_id` during a single extension session (e.g. when chat history is rehydrated).  

### Requirement 5 — Failure Handling (Fail-Open)

**User Story:** As a user, I want chat to work even if Graphiti is down so that memory integration cannot break my day-to-day work.

#### Acceptance Criteria
5.1 WHEN Graphiti requests fail (network errors, timeouts, non-2xx), THEN the `Copilot_Chat_Extension` SHALL fail open
and SHALL NOT block chat send/receive flows.  
5.2 THE `Copilot_Chat_Extension` SHALL implement bounded retries with backoff and SHALL cap queue growth.  
5.3 WHEN the queue is full, THEN the `Copilot_Chat_Extension` SHALL drop data according to a defined policy (e.g., drop
oldest first) and SHALL emit a non-content diagnostic signal.  

### Requirement 6 — Privacy and Data Scope Controls

**User Story:** As a privacy-conscious user, I want fine-grained control over what is sent to Graphiti so that sensitive data is not unintentionally shared.

#### Acceptance Criteria
6.1 The consent prompt SHALL enumerate the default data scope (user/assistant conversation text only).  
6.2 BY DEFAULT, the `Copilot_Chat_Extension` SHALL NOT send attachments, file contents, or system/context prompts.  
6.3 The `Copilot_Chat_Extension` MAY provide an explicit setting to include additional data categories, but those
categories SHALL be opt-in and off by default.  

### Requirement 7 — Observability

**User Story:** As a developer/operator, I want non-content telemetry/logging so that I can diagnose Graphiti integration issues without leaking user data.

#### Acceptance Criteria
7.1 The `Copilot_Chat_Extension` SHOULD emit telemetry/log signals for ingestion attempts, failures, retries, and drops
without including user content.  
7.2 The `Copilot_Chat_Extension` SHOULD surface a lightweight status indicator or output (e.g., in logs or a command
result) when Graphiti integration is enabled but failing.  

### Requirement 8 — User Scope and Manual Promotion

**User Story:** As an advanced user, I want to promote durable knowledge (decisions, lessons learned, preferences) into a
User Scope so that it can be recalled across sessions and workspaces.

#### Acceptance Criteria
8.1 THE `Copilot_Chat_Extension` SHALL expose a Promotion command that creates a new episode in Graphiti.  
8.2 WHEN the workspace is untrusted or Graphiti integration is disabled, THEN the Promotion command SHALL NOT send any
network requests to the Graphiti Service.  
8.3 The Promotion flow SHALL allow selecting a target scope at minimum: Workspace Scope or User Scope (Global).  
8.4 The Promotion flow SHALL allow selecting an episode kind from a defined list (at minimum: `decision`,
`lesson_learned`, `preference`, `procedure`, `task_update`).  
8.5 The `Copilot_Chat_Extension` SHALL send promoted episodes via `POST /messages` using `role_type: "system"` and a
structured template that includes the selected kind.  

### Requirement 9 — Recall (Optional Prompt Injection)

**User Story:** As an advanced user, I want Copilot Chat to recall relevant facts from Graphiti so that the agent can
maintain long-running context across turns and sessions.

#### Acceptance Criteria
9.1 THE `Copilot_Chat_Extension` SHALL gate Recall behind a setting (default `false`).  
9.2 WHEN Recall is enabled (and Graphiti integration is enabled + consented), THEN before rendering an agent prompt the
`Copilot_Chat_Extension` SHALL query Graphiti for relevant facts within a configured timeout.  
9.3 WHEN Recall requests fail (timeouts, non-2xx), THEN the `Copilot_Chat_Extension` SHALL fail open and SHALL continue
chat without recalled facts.  
9.4 The `Copilot_Chat_Extension` SHALL support recalling from Session Scope and Workspace Scope; it MAY also support User
Scope (Global).  
9.5 The `Copilot_Chat_Extension` SHALL cap recall output by a configured maximum number of facts (and/or prompt-size
budget) and SHALL NOT log user content when emitting diagnostics.  
9.6 WHEN recalled facts are present, THEN the `Copilot_Chat_Extension` SHALL inject them into the prompt in a dedicated,
clearly labeled section intended for “memory context”.  
