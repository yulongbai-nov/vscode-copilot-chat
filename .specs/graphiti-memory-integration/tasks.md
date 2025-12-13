# Implementation Plan: Graphiti Memory Integration

- [ ] 0. Finalize scope and consent
  - Confirm data fields, truncation limits, attachment policy, and embedding toggle.
  - Define consent UX and trust gating.

- [ ] 1. Mapping and adapter spike
  - Prototype node/edge mapping with stable IDs + content hashes.
  - Define batching/backoff and bounded retry queue.

- [ ] 2. Ingestion pipeline
  - Implement append-only ingestion on turn finalization behind flag.
  - Add size caps/truncation markers; optional embeddings toggle.
  - Wire configs: endpoint/apiKey/workspace/timeout/maxBatchSize.

- [ ] 3. Failure handling and observability
  - Implement fail-open behavior, retries with backoff, bounded queue.
  - Telemetry for attempts/failures (no user content); lightweight status surfacing.

- [ ] 4. Tests
  - Unit tests for mapping/idempotency and truncation.
  - Integration tests for batching/retry and fail-open behavior.
