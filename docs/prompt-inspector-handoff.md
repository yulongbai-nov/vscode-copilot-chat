  ## Prompt Inspector / Live Request Editor – Handoff (4 Dec 2025)

  ### Branch / Scope
  - Branch: `feature/prompt-interception-mode`
  - Focus: Prompt Inspector extras + chat-surface metadata (Tasks 5.5 & 9.x in `.kiro/specs/request-logger-prompt-
  editor/tasks.md`)

  ### Spec Source of Truth
  - `.kiro/specs/request-logger-prompt-editor/design.md` — captures the architecture for the Live Request Editor, metadata tree, and Auto Override workflows; update this first if we pivot on UX, data flow, or telemetry.
  - `.kiro/specs/request-logger-prompt-editor/requirements.md` — canonical user stories / acceptance criteria for Tasks 1–11; reference the numbered requirements when adding tests or scope.
  - `.kiro/specs/request-logger-prompt-editor/tasks.md` — active implementation checklist (current phase: **implementation** with open work in Tasks 2.4, 6.x, 7.x). Per `agent-prompt.md`, no coding should happen outside this plan; if new scope appears, switch back to design and revise the spec before touching code.

  ### Latest Work
  1. **Metadata stream**
     - `ILiveRequestEditorService` now emits `onDidChangeMetadata` snapshots containing session/request IDs, model,
  dirty state, interception state, and token counts that any UI surface can subscribe to.
  2. **Live metadata view**
     - The status widget was removed; instead, metadata/token visuals route through the `github.copilot.liveRequestMetadata` tree view so users can pin it beneath the chat input. The tree mirrors the animated token bar, exposes copy-enabled metadata leaves, and now includes outline nodes for `requestOptions` + `rawRequest` when the corresponding `extraSections` entries are enabled.
     - Both `github.copilot.chat.promptInspector.sessionMetadata.fields` and `.extraSections` are application-scoped settings now, so advanced users can trust the view once and reuse the same configuration across every workspace (even untrusted folders).
     - The toolbar hosts a “Configure metadata” Quick Pick that updates `sessionMetadata.fields` without touching settings JSON, and every node (metadata or outline) shares the same clipboard/status feedback affordances.
  3. **Inspector extras**
     - Telemetry remains the sole optional panel inside the webview inspector; request options and raw payload rendering moved to the metadata tree so the inspector stays lightweight while still honoring the config knobs.
  4. **Prompt Section Visualizer sunset**
     - The legacy Prompt Section Visualizer feature (specs, commands, settings, services, tests, docs) has been fully removed. All prompt-inspection investment now flows through the Live Request Editor + Subagent Prompt Monitor stack.
  5. **Auto Override mode**
     - The Live Request Editor header now hosts a tri-segment mode selector (Off / Interception / Auto). Auto Override pauses the next turn, limits the inspector to the first `previewLimit` sections (Quick Pick configurable), and persists edits across session/workspace/global scopes so future turns send immediately with overrides applied.
     - The banner summarizes the active scope, shows `Pause next turn`, `Edit overrides`, `Clear overrides`, `Change scope`, and `Preview limit` actions, and displays an inline note whenever sections are being hidden during capture.
     - Sections that carry overrides render an “Override · Show diff” chip that opens a `vscode.diff` view comparing the original intercepted content with the persisted override. Diff launches, saves, clears, and scope transitions all emit telemetry tagged by scope.
  6. **Session selector + metadata freshness**
     - Conversation picker is always enabled and now labels sessions as `<location> · <debug name> · …<sessionId tail>` to disambiguate concurrent sessions. Request/session/model metadata is refreshed via `onDidChangeMetadata` (includes `lastUpdated`) so the header and metadata tree keep request IDs, models, and session IDs in sync during Auto-apply capture/apply.

  ### Verification
  - `npm run lint`
  - `npm run typecheck`
  - `npm run compile`
  - `npx vitest run src/extension/prompt/vscode-node/test/liveRequestEditorProvider.spec.ts src/extension/prompt/
  vscode-node/test/liveRequestMetadataProvider.spec.ts src/extension/prompt/node/test/liveRequestEditorService.spec.ts src/extension/prompt/node/test/defaultIntentRequestHandler.spec.ts`
  - `npm run test:unit` (pass; historical flaky suites noted in handoff doc)
  - `npm run simulate -- --scenario-test debugCommandToConfig.stest.ts --grep "node test"`
  - Manual sanity:
    1. With the feature flag on, send a prompt, open “Live Request Metadata,” and verify the metadata nodes/token meter update when you send, edit, switch conversations, or change models. Use “Configure metadata” to toggle fields and expand outline nodes for copy.
    2. Switch the mode toggle to **Auto**, send another prompt, edit one of the first three sections, and press **Resume**. Subsequent turns should send immediately with the override applied, the banner should display the chosen scope, and the section card should show the “Override · Show diff” chip. Use the banner actions (Pause next turn, Edit overrides, Clear overrides, Change scope, Preview limit) to confirm they dispatch correctly.
  - Known test debt (per `agent-prompt.md`): `npm run test:unit` can still timeout in the tool-calling, notebook prompt rendering, and agent prompt suites upstream. Treat these failures as pre-existing and mention them in reviews.

  ### Remaining Scope / Next Steps
  - Task 2.4: HTML tracer enrichment.
  - Task 6.x/7.x: performance, accessibility, and testing backlog.
  - Task 9.x follow-ups: once VS Code exposes drawer APIs, embed the metadata/usage UI directly inside the native chat surface and expose richer cues (model budgets, quota warnings).
  - Task 10.x: **done** (mode selector, scope persistence, diff tooling, telemetry).
  - Longer-term: migrate drafted webview UX to the native chat drawer when first-party APIs allow.

  ### Gotchas / Notes
  - Token usage in the metadata view comes from `request.metadata.tokenCount`; we fall back to summed section
  token counts if the renderer hasn’t filled totals yet, and display “awaiting data” in the token node when nothing
  is available.
  - Feature flag: everything stays behind `github.copilot.chat.advanced.livePromptEditorEnabled`. Chips hide if
  `sessionMetadata.fields` is empty, but the metadata view still shows the token meter placeholder for clarity.
  - Known console noise: similarity-matching warnings in tool tests and SQLite experimental warnings (documented above).
  - If the “Live Request Metadata” view looks blank, make sure the feature flag is on and the view is not collapsed; the tree only updates while the containing view is visible.
  - Spec-first workflow alignment: when ambiguity appears, pause implementation, update `.kiro/specs/request-logger-prompt-editor/{design,requirements,tasks}.md`, and only resume coding once those documents reflect the new intent and tasks.

  Ping me if you need a quick demo snippet or want the footer indicator to appear by default (e.g., we could auto-open/pin it the first time the feature is enabled).
