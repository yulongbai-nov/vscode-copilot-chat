# Demo: Graphiti Memory Integration (End-to-End)

This demo shows Copilot Chat’s Graphiti integration working end-to-end:

1. **Chat → Graphiti ingestion** (automatic, on turn finalization)
2. **Graphiti → facts extraction** (Graphiti service derives facts you can query)
3. **Graphiti → Copilot recall injection** (optional, prompt-time memory)
4. **Auto-promotion via Memory Directives** (optional, higher-signal “memories”)
5. **Manual promotion** (optional, higher-signal “memories”)

Presentation deck (for a quick walkthrough): [`docs/demos/graphiti-memory-integration/presentation/index.html`](presentation/index.html)

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

Optional (newer Graphiti deployments): canonical group id resolver (may return 404 on older builds):
```bash
curl -fsS -X POST http://graph:8000/groups/resolve -H 'content-type: application/json' \
  -d '{"scope":"user","key":"github_login:octocat"}' || true
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
   - (Optional) `github.copilot.chat.memory.graphiti.includeSystemMessages`: `true` (adds an ownership context episode with the logged-in user + workspace basenames)
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

To recall global (“my”) preferences/terminology promoted to user scope, use:
- `github.copilot.chat.memory.graphiti.recall.scopes`: `all`

To keep user scope recall off by default but include it when the user query indicates “my preferences/terminology”, use:
- `github.copilot.chat.memory.graphiti.recall.scopes`: `auto`

Ask a follow-up:
> `Before committing, what should I do?`

To verify recall reliably, inspect the rendered prompt via Request Logger and confirm a tagged section:
- `<graphiti_memory> ... Recalled memory facts (Graphiti) ... </graphiti_memory>`

Implementation refs:
- Prompt element: [`src/extension/prompts/node/agent/graphitiMemoryContext.tsx#L35`](../../../src/extension/prompts/node/agent/graphitiMemoryContext.tsx#L35)
- Recall service (`POST /search`): [`src/extension/memory/graphiti/node/graphitiRecallService.ts#L52`](../../../src/extension/memory/graphiti/node/graphitiRecallService.ts#L52)

## Step 5 — Demo: Promotion (Higher Signal than Raw Chat)
### 5A) Auto-promotion via Memory Directives (optional)
Enable:
- `github.copilot.chat.memory.graphiti.autoPromote.enabled`: `true`

Then send one of these in chat (examples):
- `preference (user): Keep diffs small and avoid inline comments.`
- `terminology (workspace): “playbook” means the repo’s runbook docs.`

These directives enqueue an additional `<graphiti_episode kind="…">…</graphiti_episode>` message to Graphiti (best-effort). If the directive content looks like a secret (password/token/private key), auto-promotion is refused.

### 5B) Manual promotion
Promotion is useful for durable, curated knowledge (decisions, preferences, procedures), and can target Workspace or User scope.

Run: `GitHub Copilot Chat: Promote to Graphiti Memory`
- Choose `Lesson Learned` and include a unique marker in the text.
- Confirm Graphiti retrieval via global search (Terminal):
```bash
curl -fsS -X POST http://graph:8000/search -H 'content-type: application/json' \
  -d '{"query":"<your unique marker>","max_facts":5}'
```

Promotion templates: [`src/extension/memory/graphiti/node/graphitiPromotionTemplates.ts#L9`](../../../src/extension/memory/graphiti/node/graphitiPromotionTemplates.ts#L9)

## Step 6 — Demo: Cross-client Shared Memory (Copilot Chat + Codex CLI)

This step demonstrates the “shared memory” upgrade: Copilot Chat and Codex CLI can now share the same Graphiti `user` and `workspace` memories by using the same canonical `graphiti_*` group ids (while still recalling legacy per-client ids for migration).

### Prereqs

- Both clients point at the same Graphiti endpoint (`http://graph:8000`).
- You are logged into GitHub in VS Code (Copilot Chat) and the GitHub CLI (Codex) under the same login:
  - VS Code identity source: GitHub auth session label.
  - Codex identity source: `gh auth status` (auto-detected) or `graphiti.user_scope_key` override.
- The repo has a GitHub remote (e.g. `origin`) so workspace identity can be derived as `github_repo:<host>/<org>/<repo>`.

### 6A) Copilot Chat → Codex recall (user scope)
1. In Copilot Chat, with auto-promotion enabled, send:
   - `preference (user): I prefer rg over grep for searches. marker: shared-memory-<timestamp>`
2. In Codex (Graphiti enabled, Global enabled, recall scopes auto or include global), ask:
   - `What is my preference for searching in this repo?`
3. Confirm Codex response includes the preference (and optionally inspect injected `<graphiti_memory>`).

### 6B) Codex → Copilot Chat recall (user scope)
1. In Codex, send:
   - `preference (global): Keep diffs small and avoid inline comments. marker: shared-memory-<timestamp>`
2. In Copilot Chat, ask:
   - `What is my preference for diffs and comments?`
3. Confirm the prompt contains a `<graphiti_memory>` section that includes the preference (Request Logger recommended).

### Why this is better than the “old” cross-tool story
- Before canonical ids, Copilot Chat and Codex wrote to different per-client namespaces (e.g. `copilotchat_user_*` vs `codex-global-*`), so a preference learned in one tool was not recalled by the other.
- With canonical ids, both write/read the same `graphiti_user_*` / `graphiti_workspace_*` groups (derived from stable keys like `github_login:<login>` and `github_repo:<host>/<org>/<repo>`).

### Debug tips
- Codex: `codex graphiti status` prints both canonical and legacy derived group ids.
- Copilot Chat: `GitHub Copilot Chat: Test Graphiti Connection` logs whether `/groups/resolve` is available (optional) and runs a write/poll/delete smoke test.

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
- `POST /groups/resolve` returns 404 → you’re likely running an older Graphiti build; either redeploy a version that includes the canonical group id resolver or rely on the client-side deterministic fallback (`graphiti_<scope>_<sha256(key)[:32]>`).
- `graph-falkordb` hostname not resolvable → optional service; ignore unless you explicitly run the FalkorDB variant.
