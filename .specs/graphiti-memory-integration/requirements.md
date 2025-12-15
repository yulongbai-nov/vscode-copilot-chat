# Requirements Document

## Introduction

This feature integrates the Graphiti service with Copilot Chat so that Copilot can store and recall useful information across sessions/workspaces. The system must remain safe (off by default + consent + trust gating), fast (bounded recall + async ingest), and controllable (session/workspace scopes; user scope via promotion).

### Goals

- Improve agent continuity by recalling relevant prior context.
- Persist session and workspace knowledge automatically when enabled.
- Allow curated, explicit memory promotion to user scope (and/or workspace scope).

### Non-goals

- Guaranteeing all turns are stored (ingestion is best-effort).
- Building a full graph UI inside the extension.

## Glossary

- **Graphiti**: External service providing knowledge-graph storage and retrieval via REST.
- **Fact**: A Graphiti-extracted statement returned from `POST /search`.
- **Memory**: Facts retrieved from Graphiti and injected into the prompt.
- **Scope**: The grouping boundary for memory (`session`, `workspace`, `user`).
- **Actor / Owner**: The logged-in user identity associated with a scope (used to express “my” preferences/assets).
- **Workspace Trust**: VS Code’s trust state; untrusted workspaces disable automatic Graphiti behavior.
- **Consent Record**: Per-workspace record indicating the user approved sending chat text to a specific Graphiti endpoint.
- **Promotion**: A curated, manually created “episode” (decision/lesson/etc.) written to Graphiti.

## Requirements

### Requirement 1 — Safety, trust, and consent gating

**User Story:** As a user, I want Graphiti memory to be off by default and gated, so that my chat data is not sent without consent.

#### Acceptance Criteria

1.1 THE Copilot Chat system SHALL default Graphiti integration to disabled.
1.2 WHEN `github.copilot.chat.memory.graphiti.enabled` is false, THE Copilot Chat system SHALL NOT make automatic Graphiti network calls.
1.3 WHEN the workspace is untrusted, THE Copilot Chat system SHALL disable automatic ingest and recall.
1.4 WHEN Graphiti is enabled, THE Copilot Chat system SHALL require an explicit consent confirmation tied to the configured endpoint before ingest/recall occurs.

### Requirement 2 — Automatic ingestion (best-effort)

**User Story:** As a user, I want Copilot Chat to persist useful history to Graphiti, so that it can be recalled later.

#### Acceptance Criteria

2.1 WHEN Graphiti ingest is enabled, THE Copilot Chat system SHALL enqueue successful turns for ingestion without blocking the response path.
2.2 THE Copilot Chat system SHALL bound ingestion memory usage (queue size) and apply a deterministic drop policy when full.
2.3 THE Copilot Chat system SHALL retry transient ingestion failures with backoff and SHALL eventually drop after bounded attempts.
2.4 THE Copilot Chat system SHALL write ingested messages into Graphiti under scope-derived group ids for `session` and/or `workspace` as configured.

### Requirement 3 — Recall memories per turn (optional)

**User Story:** As a user, I want Copilot Chat to recall relevant memories before answering, so that it can respond consistently without repeating work.

#### Acceptance Criteria

3.1 WHEN Graphiti recall is enabled, THE Copilot Chat system SHALL query Graphiti using the current user query as the recall query.
3.2 THE Copilot Chat system SHALL inject recalled memory as a structured prompt block (`<graphiti_memory>…</graphiti_memory>`).
3.3 THE Copilot Chat system SHALL cap recalled results (count and total size) to avoid prompt bloat.
3.4 THE Copilot Chat system SHALL apply a strict timeout to recall and SHALL fail open (continue without memory) when Graphiti is slow or unavailable.

### Requirement 4 — Scopes and promotion

**User Story:** As a user, I want separate session/workspace memory and an optional user memory, so that I can control where information persists.

#### Acceptance Criteria

4.1 THE Copilot Chat system SHALL support `session` and `workspace` scopes for ingestion and recall.
4.2 THE Copilot Chat system SHALL support a `user` scope that is disabled for automatic ingestion by default.
4.3 THE Copilot Chat system SHALL provide a command to promote curated memory into `workspace` or `user` scope.
4.4 THE Copilot Chat system SHALL allow configuration to include/exclude each scope for recall, including an `all` option that includes user scope.

### Requirement 5 — Observability and operability

**User Story:** As a user, I want to diagnose Graphiti connectivity and validate ingestion, so that I can operate the integration confidently.

#### Acceptance Criteria

5.1 THE Copilot Chat system SHALL provide a command to test Graphiti connectivity with a read-only mode.
5.2 THE Copilot Chat system SHALL provide a command to run a smoke test that writes a synthetic message and attempts cleanup.
5.3 THE Copilot Chat system SHALL provide clear logging/output for test outcomes and failures.

### Requirement 6 — Metadata and privacy

**User Story:** As a user, I want the system to store helpful but safe metadata, so that memories are attributable without leaking sensitive paths.

#### Acceptance Criteria

6.1 THE Copilot Chat system SHALL avoid storing absolute filesystem paths in group ids or metadata by default.
6.2 THE Copilot Chat system SHALL use hashed group ids by default.
6.3 WHEN enabled, THE Copilot Chat system SHALL include basic git metadata (branch, commit, dirty) in `source_description` without including file paths.

### Requirement 7 — User identity and ownership context

**User Story:** As a user, I want Graphiti memories to be associated with my identity and ownership relationships, so that asking about “my” preferences/terminology/assets recalls relevant facts across sessions and workspaces.

#### Acceptance Criteria

7.1 WHEN `github.copilot.chat.memory.graphiti.includeSystemMessages` is enabled, THE Copilot Chat system SHALL ingest an ownership context `system` message at most once per Graphiti group.
7.2 WHEN a GitHub authentication session is available, THE Copilot Chat system SHALL include a stable user identifier (GitHub account id and label) in the ownership context without making additional network calls.
7.3 THE Copilot Chat system SHALL NOT attempt to fetch the user’s email address for Graphiti identity by default.
7.4 WHEN Graphiti recall scopes are configured as `all`, THE Copilot Chat system SHALL recall from a user-scope group derived from the logged-in GitHub account id when available, and SHALL also recall from any legacy stored user scope key when present.
7.5 WHEN promoting a memory to user scope, THE Copilot Chat system SHALL store it into the user-scope group derived from the logged-in GitHub account id when available, otherwise falling back to the legacy stored user scope key.
