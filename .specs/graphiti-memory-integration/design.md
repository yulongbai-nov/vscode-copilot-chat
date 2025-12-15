# Design Document: Graphiti Memory Integration (Copilot Chat)

## Overview

Copilot Chat primarily relies on the in-memory conversation window (and summarization heuristics) as its “memory”. This feature integrates the external **Graphiti** knowledge-graph service to:

- **Ingest** Copilot Chat turns as Graphiti `/messages` (best-effort, async).
- **Recall** relevant facts at prompt time (optional) and inject them into the agent prompt as structured context (`<graphiti_memory>`).
- **Promote** curated, higher-signal memories (decisions/lessons/procedures) into longer-lived scopes.

### Goals

- Provide **session** and **workspace** scoped memory (automatic ingest), and **user** scoped memory (promotion-only by default).
- Keep the agent loop fast: **non-blocking ingestion**, bounded queues, and **time-bounded recall**.
- Keep it safe: **off by default**, **explicit consent**, and **workspace trust gating**.
- Make it operable: commands to **test connection** and **promote memory**, plus clear logging.

### Non-goals

- Replacing the existing conversation context window or summarization pipeline.
- Building a full UI for browsing/editing the graph.
- Custom Graphiti ontology/relationship extraction logic inside this extension (we rely on Graphiti’s default extraction for now).

## Current Architecture

- Turns are processed by a request handler which produces an assistant response and updates the in-memory `Conversation`.
- Prompts are assembled using `@vscode/prompt-tsx` components (system prompt + history + user message).
- “MemoryTool” exists as a file-backed tool for deterministic memory, but it is manual/tool-driven (no semantic extraction).

Key entry points:
- Turn handling: [`src/extension/prompt/node/chatParticipantRequestHandler.ts#L288`](../../src/extension/prompt/node/chatParticipantRequestHandler.ts#L288)
- Agent prompt assembly: [`src/extension/prompts/node/agent/agentPrompt.tsx#L136`](../../src/extension/prompts/node/agent/agentPrompt.tsx#L136)
- Graphiti demo: [`docs/demos/graphiti-memory-integration/README.md`](../../docs/demos/graphiti-memory-integration/README.md)

## Proposed Architecture

Introduce a best-effort memory subsystem that runs alongside the existing chat loop:

```
Chat turn ──┬─> Model response ──┬─> Render output
            │                   │
            │                   └─> Ingest (async, queued) ──> Graphiti /messages
            │
            └─> Recall (bounded, time-limited) ─────────────> Graphiti /search
                             │
                             └─> Inject <graphiti_memory> into prompt
```

### High-level per-turn flow

1. **Recall (optional)**: before the user request is rendered into the prompt, query Graphiti for relevant facts and render a `<graphiti_memory>` block into the prompt.
2. **Ingest (best-effort)**: after successful turn completion, enqueue turn content for background ingestion to Graphiti.

## Components

### Graphiti REST client

- `GraphitiClient`: [`src/extension/memory/graphiti/node/graphitiClient.ts`](../../src/extension/memory/graphiti/node/graphitiClient.ts)
  - Calls Graphiti endpoints (`GET /healthcheck`, `POST /messages`, `POST /search`, `DELETE /group/:id`, …).
  - Applies strict timeouts and logs request failures.

### Ingestion (automatic)

- `GraphitiMemoryService`: [`src/extension/memory/graphiti/node/graphitiMemoryService.ts`](../../src/extension/memory/graphiti/node/graphitiMemoryService.ts)
  - Gating: enabled + trusted workspace + per-workspace consent.
  - Scope → group id mapping (`session` / `workspace`) with hashed-by-default identifiers.
  - Bounded ingestion queue with deterministic drop policy and exponential backoff retries.
  - Optional git metadata in `source_description` (`branch`, `commit`, `dirty`) without file paths.

- Turn-finalization hook: [`src/extension/prompt/node/chatParticipantRequestHandler.ts#L302`](../../src/extension/prompt/node/chatParticipantRequestHandler.ts#L302)
  - Collects successful turns and calls `enqueueConversationSnapshot(sessionId, turns)`.

### Recall (optional)

- `GraphitiRecallService`: [`src/extension/memory/graphiti/node/graphitiRecallService.ts`](../../src/extension/memory/graphiti/node/graphitiRecallService.ts)
  - Gating: enabled + recall enabled + trusted workspace + consent record matches endpoint.
  - Runs `POST /search` for configured scopes and returns de-duplicated fact results.

- Prompt injection:
  - Prompt element: [`src/extension/prompts/node/agent/graphitiMemoryContext.tsx#L35`](../../src/extension/prompts/node/agent/graphitiMemoryContext.tsx#L35)
  - Inserted in the agent prompt before the user request: [`src/extension/prompts/node/agent/agentPrompt.tsx#L142`](../../src/extension/prompts/node/agent/agentPrompt.tsx#L142)

### Consent + Commands (operability)

- `GraphitiMemoryContribution`: [`src/extension/memory/graphiti/vscode-node/graphitiMemoryContribution.ts#L42`](../../src/extension/memory/graphiti/vscode-node/graphitiMemoryContribution.ts#L42)
  - Consent prompt (modal) when enabling Graphiti in a trusted workspace; stores consent in workspace state.
  - Commands:
    - `GitHub Copilot Chat: Test Graphiti Connection` (basic read-only vs smoke test with cleanup)
    - `GitHub Copilot Chat: Promote to Graphiti Memory` (curated “episode” into workspace or user scope)

## Data & Control Flow

### Message representation (automatic ingestion)

Each successful chat turn is mapped to a pair of Graphiti `/messages` calls (user + assistant), grouped by `group_id`:

- `group_id`: derived from scope and a stable key (hashed by default).
  - `session`: based on Copilot Chat `Conversation.sessionId`
  - `workspace`: based on workspace folder URIs (stable hash)
- `role_type`: `user` / `assistant`
- `content`: truncated to `github.copilot.chat.memory.graphiti.maxMessageChars`
- `timestamp`: ISO timestamp
- `name`: stable per-turn names when a turn id is available (e.g., `copilotchat.turn.<id>.user`)
- `source_description` (optional): includes safe git metadata if enabled

Mapping helper: [`src/extension/memory/graphiti/node/graphitiMessageMapping.ts#L22`](../../src/extension/memory/graphiti/node/graphitiMessageMapping.ts#L22)

### Recall query and formatting

- Query string is derived from the current turn’s user query (trimmed).
- `POST /search` runs with a strict timeout and `max_facts` cap.
- When multiple scopes are enabled, recall starts per-scope queries concurrently but processes results in a stable scope order, stopping early once `max_facts` is reached.
- Returned facts are rendered into a single `<graphiti_memory>` section:
  - It is intentionally framed as “optional context” to reduce over-reliance on possibly-stale facts.

### Dynamic recall scope selection (`recall.scopes=auto`)

To avoid always querying the user scope (privacy/latency) while still answering “my preferences / my terminology / my owned assets” queries, an optional `auto` mode dynamically selects which scopes to query per turn:

- Always include `session`.
- Include `workspace` when the query is likely project-specific (e.g. “in this repo”, “this project”, “branch”, “PR”, “CI”, “workspace”).
- Include `user` when the query indicates user-specific memory (e.g. “my preference”, “what do I call …”, “my terminology”, “my setup”, “my workflow”).

Selection is heuristic, best-effort, and bounded by the same recall timeout/caps.

### User scope (global) and “episodes”

User scope is a third grouping boundary intended for generic lessons/preferences that transcend a workspace.

- Automatic ingestion does **not** write to user scope.
- Promotion writes a single synthetic message containing a structured `<graphiti_episode kind="…">…</graphiti_episode>` block:
  - Template: [`src/extension/memory/graphiti/node/graphitiPromotionTemplates.ts#L6`](../../src/extension/memory/graphiti/node/graphitiPromotionTemplates.ts#L6)
  - Kinds: `decision`, `lesson_learned`, `preference`, `procedure`, `task_update`, `terminology`
- User scope group id uses a stable user key:
  - Prefer the logged-in GitHub account id when available (stable across machines and sessions).
  - Fall back to a stable, random key stored in global state (legacy behavior).
  - Key storage: [`src/extension/memory/graphiti/common/graphitiStorageKeys.ts#L6`](../../src/extension/memory/graphiti/common/graphitiStorageKeys.ts#L6)

### Auto-promotion from Memory Directives (optional)

To reduce the friction of manual promotion while keeping safety and performance, an optional auto-promotion mode can detect explicit “Memory Directives” in user messages (e.g. `preference: …`, `terminology: …`) and enqueue an additional synthetic message containing a `<graphiti_episode kind="…">…</graphiti_episode>` block.

Key properties:

- **Opt-in** via `github.copilot.chat.memory.graphiti.autoPromote.enabled`.
- **Non-blocking**: promotion is enqueued on the same bounded ingestion pipeline.
- **Scope inference**:
  - Supports explicit scope markers like `preference (user): …` / `decision (workspace): …`.
  - Defaults to a least-persistent scope when ambiguous (prefer `workspace` over `user`).
- **Secret guard**: heuristically refuses to auto-promote when the directive content looks like credentials or private keys.

### Actor identity + ownership context (recommended)

For “my preferences / my terminology / my owned assets” recall, Graphiti needs an explicit notion of the **actor** (logged-in user) and what they “own” within the memory scopes.

When `github.copilot.chat.memory.graphiti.includeSystemMessages` is enabled, the ingestion layer prepends a one-time `system` message to each active scope/group containing an `<graphiti_episode kind="ownership_context">…</graphiti_episode>` block that describes:

- The owner identity (GitHub account id/label, when available without extra network calls).
- The scope identity (session/workspace/user) and a short natural-language ownership statement (“Owner owns this workspace/session scope”).
- Optional, safe metadata such as git branch/commit/dirty (when enabled) and workspace folder basenames (no absolute paths).

This context is sent at most once per group to avoid repeated noise and to keep ingestion inexpensive.

## Integration Points

### Configuration surface

Settings (package.json):
- `github.copilot.chat.memory.graphiti.enabled`: [`package.json#L3678`](../../package.json#L3678)
- `github.copilot.chat.memory.graphiti.endpoint`: [`package.json#L3686`](../../package.json#L3686)
- `github.copilot.chat.memory.graphiti.recall.enabled`: [`package.json#L3780`](../../package.json#L3780)
- `github.copilot.chat.memory.graphiti.recall.scopes`: [`package.json#L3806`](../../package.json#L3806)

Internal config keys:
- `ConfigKey.MemoryGraphiti…`: [`src/platform/configuration/common/configurationService.ts#L841`](../../src/platform/configuration/common/configurationService.ts#L841)

### Workspace trust

All automatic ingest/recall is disabled when the workspace is untrusted (`IWorkspaceTrustService.isTrusted`).

### Consent storage

Consent is stored per-workspace, and tied to the configured endpoint:
- Storage key: [`src/extension/memory/graphiti/common/graphitiConsent.ts#L6`](../../src/extension/memory/graphiti/common/graphitiConsent.ts#L6)

## Migration / Rollout Strategy

- Ship behind experimental setting (`enabled=false` by default).
- Require workspace trust + explicit consent modal before any ingest/recall occurs.
- Keep recall disabled by default; enable after validating ingestion quality.

## Performance / Reliability / Security / UX Considerations

- **Performance**: recall runs with tight timeouts (default `750ms`) and caps; ingestion is async with bounded queue.
- **Reliability**: fail-open — Graphiti outages/timeouts do not block the chat response.
- **Security/Privacy**:
  - opt-in + consent,
  - workspace trust gating,
  - hashed group ids by default,
  - git metadata is optional and excludes file paths.
- **UX**: recall is injected as a structured `<graphiti_memory>` section so it’s inspectable in Request Logger and less likely to interfere with user intent.

## Schema & Relations (recommended direction)

The current integration relies on Graphiti’s default extraction over natural-language messages. For higher-quality memory, extend promotion/templates and/or Graphiti ontology configuration around generic agent work:

Suggested entities: `Repository`, `Branch`, `Commit`, `PullRequest`, `File`, `Symbol`, `Decision`, `Task`, `Incident`, `Tool`, `Service`.

Suggested relations:
- `APPLIES_TO` (Preference/Lesson → Repository/Workspace)
- `OWNS` (User → Session/Workspace/Repository)
- `HAPPENED_ON` (Incident → Branch/Commit)
- `MODIFIES` (Commit/PR → File/Symbol)
- `IMPLEMENTS` (PR → Task/Requirement)
- `BLOCKS` / `DEPENDS_ON` (Task → Task)
- `USES_TOOL` (Procedure/Turn → Tool)
- `PREFERS` (User → Tool/Style/Workflow)
- `ALIAS_OF` / `TERMINOLOGY_FOR` (Term → Term/Concept)
- `FOLLOWS` (Procedure → Procedure step)
- `CREATED` / `AUTHORED` (User → PR/Commit/Decision)

## Risks and Mitigations

- **Fact quality**: render as “optional context”; cap recall; bias toward promoted episodes for critical knowledge.
- **Over-recall**: keep tight caps; default recall off; allow scope narrowing.
- **Privacy leakage**: consent + trust; hashed group ids; keep metadata minimal.
- **Latency regression**: strict recall timeout; async ingestion with bounded queue.

## Future Enhancements

- Backfill from persisted history (e.g., SQLite) via an explicit, opt-in import command.
- Add more promotion kinds and/or structured episode formats (YAML → JSON) for easier parsing.
- UI to browse/pin promoted memories per workspace.
- Cross-window or cross-machine sync (explicitly opt-in) for user scope.
- Add UI affordances to author Memory Directives (snippets / quick pick) and to review/undo auto-promoted episodes.
