# Requirements Document: Graphiti Memory Integration

## Introduction
Opt-in ingestion of chat data into a Graphiti instance for graph-native memory/RAG/auditing. Disabled by default; trusted workspaces only.

## Requirements

### R1: Opt-in and Trust
- THE System SHALL gate Graphiti ingestion behind a feature flag/config and require trusted workspace + explicit consent.
- WHEN disabled, THEN no network calls to Graphiti SHALL occur.

### R2: Data Mapping and Idempotency
- THE System SHALL map conversations/turns/sections/tool calls/results/responses/references to stable Graphiti nodes/edges with deterministic IDs and content hashes.
- THE System SHALL use append-only writes and avoid mutating prior nodes.

### R3: Payload Limits and Truncation
- THE System SHALL enforce per-node size limits and truncate payloads with clear markers.
- WHEN attachments are not explicitly allowed, THEN the System SHALL omit attachment bodies and send only URIs/hashes.

### R4: Failure Handling
- WHEN network/timeouts/errors occur, THEN ingestion SHALL fail open: queue/retry with backoff and never block chat flows.
- THE System SHALL bound retry queues to avoid unbounded growth.

### R5: Privacy and Scope
- THE System SHALL not send data unless enabled; consent UX SHALL indicate what is sent.
- THE System SHOULD allow embedding to be toggled separately; if disabled, only structure/metadata is sent.

### R6: Observability
- THE System SHOULD emit telemetry for ingestion attempts/failures (no user content).
- THE System SHOULD surface lightweight status/errors to users without noisy prompts.
