# Design Document: Graphiti Memory Integration

## Overview
Optionally mirror chat data (conversations, turns, sections, tool calls/results, references) into a Graphiti instance for graph-native memory/RAG/auditing. Disabled by default; requires explicit opt-in and trusted workspace. No implementation exists yet.

## Current Reality
- No Graphiti integration or settings in the repo.
- Live Request Editor data remains local/in-memory.

## Proposed Architecture
- Feature gate + config: `github.copilot.chat.memory.graphiti.enabled`, `graphiti.endpoint`, `graphiti.apiKey`, `graphiti.workspace`, `graphiti.timeoutMs`, `graphiti.maxBatchSize`.
- Ingestion on turn finalization: send conversation metadata, original/edited messages, sections, references, tool calls/results, responses, trace paths, replay linkage.
- Mapping to Graphiti nodes/edges (examples):
  - Nodes: Conversation, Turn, Section, Message (optional), Reference, ToolCall, ToolResult, Response, Attachment (URI/hash).
  - Edges: Conversation→Turn, Turn→Section, Section→Reference, Turn→ToolCall→ToolResult, Turn→Response, Turn→ReplayParent, Section→Attachment, optional Section→Message.
- Idempotency: stable IDs (`conv:{conversationId}`, `turn:{turnId}`, `section:{sectionId}`) + content hashes; append-only writes.
- Batching/backoff: bounded queue, retry with backoff on failure; never block chat.
- Embeddings: optional; if Graphiti provides an embedder, send text; otherwise skip and store structure only. Enforce size caps and truncate with markers.

## Privacy / Safety
- No network calls unless enabled; show consent when turning on.
- Redact or omit attachments unless explicitly allowed; default to URIs + hashes.
- Timeouts and errors reported via telemetry/output; must not interrupt chat flows.

## Risks / Mitigations
- Network/offline: fail open; keep bounded retry queue.
- Payload size: enforce per-node limits, truncate with markers.
- Schema drift: keep mapping in a dedicated adapter; hide behind flag to allow updates.

## Open Questions
- What minimum metadata is required for useful graph traversal without exposing sensitive content?
- Should embeddings be opt-in separately from ingestion?
- How to surface ingestion status/errors to users without noise?
