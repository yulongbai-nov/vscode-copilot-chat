# Demo: Graphiti Memory Integration (End-to-End)

This demo shows Copilot Chat’s Graphiti integration working end-to-end:

1. **Chat → Graphiti ingestion** (automatic, on turn finalization)
2. **Graphiti → facts extraction** (Graphiti service derives facts you can query)
3. **Graphiti → Copilot recall injection** (optional, prompt-time memory)
4. **Manual promotion** (optional, higher-signal “memories”)

It also explains why this can be better than the “old” approaches:
- **Baseline (no external memory):** in-memory, per-session only.
- **MemoryTool (file-based):** durable but manual/tool-driven and not semantic.

## Prereqs
- A running Graphiti REST service (default endpoint used below: `http://graph:8000`).
- A trusted VS Code workspace.
- (Recommended) Request Logger to inspect prompts: see [`docs/requestLogger.md`](../../requestLogger.md).

## Quick Service Check (Terminal)
These should all succeed:
```bash
curl -fsS http://graph:8000/healthcheck
curl -fsS http://graph:8000/openapi.json | head
```

Optional: run the env-gated repo E2E smoke test (writes + deletes a temp group):
```bash
GRAPHITI_E2E=1 GRAPHITI_ENDPOINT=http://graph:8000 \
  npx vitest run src/extension/memory/graphiti/test/node/graphiti.e2e.spec.ts
```
Test source: [`src/extension/memory/graphiti/test/node/graphiti.e2e.spec.ts#L1`](../../../src/extension/memory/graphiti/test/node/graphiti.e2e.spec.ts#L1)

## Step 1 — Enable Graphiti Integration (VS Code)
1. Ensure workspace trust is enabled (Graphiti is trust-gated).
2. Set:
   - `github.copilot.chat.memory.graphiti.endpoint`: `http://graph:8000`
   - `github.copilot.chat.memory.graphiti.enabled`: `true`
3. Accept the consent prompt (stored per-workspace per-endpoint).

Implementation refs:
- Consent + commands: [`src/extension/memory/graphiti/vscode-node/graphitiMemoryContribution.ts#L42`](../../../src/extension/memory/graphiti/vscode-node/graphitiMemoryContribution.ts#L42)
- Ingestion gate (trust+consent): [`src/extension/memory/graphiti/node/graphitiMemoryService.ts#L226`](../../../src/extension/memory/graphiti/node/graphitiMemoryService.ts#L226)

## Step 2 — Run the Built-in Connection Test (VS Code)
Run: `GitHub Copilot Chat: Test Graphiti Connection`
- Choose **Default (read-only)** first.
- Then choose **Smoke test (writes + deletes)** to verify background ingestion.

This is the fastest way to confirm the worker is actually processing episodes.

## Step 3 — Demo: Automatic Ingestion Beats Manual Memory

### 3A) Baseline (“old”): no external memory
Without Graphiti, Copilot can only rely on:
- the current conversation window, plus
- whatever summarization/prompting heuristics exist.

Start a new chat and send:
> `Lesson learned (demo): always run npm run lint before committing. graphiti-demo-<timestamp>`

Now start a **new** chat session and ask:
> `What should I always do before committing in this repo?`

There is no guaranteed cross-session recall in the baseline.

### 3B) Graphiti: automatic ingestion + searchable facts
With Graphiti enabled (and consented), send the same message again in chat:
> `Lesson learned (demo): always run npm run lint before committing. graphiti-demo-<timestamp>`

Then verify Graphiti extracted a fact (Terminal):
```bash
curl -fsS -X POST http://graph:8000/search -H 'content-type: application/json' \
  -d '{"query":"graphiti-demo-<timestamp>","max_facts":5}'
```

If it returns `facts: []`, wait ~5–15s and try again (ingestion is async).

Implementation refs:
- Turn-finalization hook: [`src/extension/prompt/node/chatParticipantRequestHandler.ts#L302`](../../../src/extension/prompt/node/chatParticipantRequestHandler.ts#L302)
- Mapping into Graphiti `POST /messages`: [`src/extension/memory/graphiti/node/graphitiMessageMapping.ts#L22`](../../../src/extension/memory/graphiti/node/graphitiMessageMapping.ts#L22)

## Step 4 — Demo: Recall Injection (Optional, “magic”)
Enable recall:
- `github.copilot.chat.memory.graphiti.recall.enabled`: `true`
- `github.copilot.chat.memory.graphiti.recall.scopes`: `both`

Ask a follow-up:
> `Before committing, what should I do?`

To verify recall reliably, inspect the rendered prompt via Request Logger and confirm a tagged section:
- `<graphiti_memory> ... Recalled memory facts (Graphiti) ... </graphiti_memory>`

Implementation refs:
- Prompt element: [`src/extension/prompts/node/agent/graphitiMemoryContext.tsx#L35`](../../../src/extension/prompts/node/agent/graphitiMemoryContext.tsx#L35)
- Recall service (`POST /search`): [`src/extension/memory/graphiti/node/graphitiRecallService.ts#L52`](../../../src/extension/memory/graphiti/node/graphitiRecallService.ts#L52)

## Step 5 — Demo: Promotion (Higher Signal than Raw Chat)
Promotion is useful for durable, curated knowledge (decisions, preferences, procedures), and can target Workspace or User scope.

Run: `GitHub Copilot Chat: Promote to Graphiti Memory`
- Choose `Lesson Learned` and include a unique marker in the text.
- Confirm Graphiti retrieval via global search (Terminal):
```bash
curl -fsS -X POST http://graph:8000/search -H 'content-type: application/json' \
  -d '{"query":"<your unique marker>","max_facts":5}'
```

Promotion templates: [`src/extension/memory/graphiti/node/graphitiPromotionTemplates.ts#L9`](../../../src/extension/memory/graphiti/node/graphitiPromotionTemplates.ts#L9)

## Why This Can Be Better Than The “Old One”

### Compared to baseline (no external memory)
- **Cross-session/workspace recall**: you can retrieve facts even after restarting or starting new chats (Workspace scope).
- **Queryable**: you can verify what the system “knows” via Graphiti `/search`, rather than guessing.
- **Fail-open**: Graphiti failures/timeouts don’t block chat (strict timeouts + async ingestion).

### Compared to MemoryTool (file-based)
MemoryTool (see [`src/extension/tools/node/memoryTool.tsx#L35`](../../../src/extension/tools/node/memoryTool.tsx#L35)) is great when you want:
- local-only storage (no network dependency),
- deterministic, editable memory files,
- per-workspace isolation.

Graphiti is better when you want:
- **automatic extraction** of facts/relations from natural chat (less manual file curation),
- **semantic retrieval** (search for “lint before commit” and get the right fact),
- **multi-scope memory** (`session`, `workspace`, plus promotion-only `user` scope),
- graph-native extensibility (richer relations over time).

Trade-offs to keep in mind:
- Graphiti requires an external service (privacy + availability concerns).
- Extracted facts can be incomplete or wrong; treat them as “assistive context”, not ground truth.

## Next Reading
- Spec: [`.specs/graphiti-memory-integration/design.md`](../../../.specs/graphiti-memory-integration/design.md)
- Requirements: [`.specs/graphiti-memory-integration/requirements.md`](../../../.specs/graphiti-memory-integration/requirements.md)
- Tasks: [`.specs/graphiti-memory-integration/tasks.md`](../../../.specs/graphiti-memory-integration/tasks.md)

## Redeploy Graphiti (Runbook)

From the Graphiti repo:
- `docker compose up -d --build graph neo4j`
- Validate:
  - `docker compose ps`
  - `docker compose logs -f graph`
  - `curl -fsS http://localhost:8000/healthcheck` (or `http://graph:8000/healthcheck` inside Docker networks)

Common failure modes:
- Neo4j not healthy → `docker compose logs neo4j` (and verify credentials/volumes).
- `/search` returns errors or no facts → Graphiti may need model/provider env vars (e.g., `OPENAI_API_KEY`, `OPENAI_BASE_URL`), and ingestion is async (wait ~5–15s before retrying).
- `graph-falkordb` hostname not resolvable → optional service; ignore unless you explicitly run the FalkorDB variant.
