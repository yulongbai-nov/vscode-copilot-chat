# Prompt Inspector Handoff

## Summary

- Feature: Prompt Inspector extras (Task 5.5) & Live Request Editor polish on `feature/prompt-interception-mode`.
- Latest work:
  - Specs/tasks updated to cover the new configurable extras.
  - Introduced `github.copilot.chat.promptInspector.extraSections` (`requestOptions`, `telemetry`, `rawRequest`) with hot-reload support in the provider.
  - Webview renders optional panels (JSON previews + copy buttons; telemetry grid).
  - Added provider coverage and styling to support the new panels.

## Outstanding Scope

- Task 2.4 (HTML tracer enrichment) still pending.
- Tasks 6.x/7.x (performance hardening, accessibility passes, automated + manual tests) untouched.
- Consider exposing extras in the eventual native drawer once VS Code allows it.

## Known Test Failures (`npm run test:unit`)

These suites/timeouts predate the current changes and continue to fail upstream:

1. `src/extension/prompt/node/test/defaultIntentRequestHandler.spec.ts` — “makes a successful request with a single turn” + “makes a tool call turn”.
2. Tool suite timeouts: `findTextInFilesResult`, `getErrorsResult`, `getErrorsTool`, `readFile`, `memoryTool`, `multiReplaceStringTool`, `testFailure`, `toolCalling`.
3. Notebook/agent suites: `notebookPromptRendering`, `platform/notebook/.../alternativeContent`, `summarizedDocumentRendering`, `agentPrompt`, `parseAttachments`, `summarization`.
4. TypeScript server plugin suite: `src/extension/typescriptContext/serverPlugin/src/node/test/simple.spec.ts` (multiple cases).
5. General `[vitest-worker]: Timeout calling "onTaskUpdate"` warning persists.

Re-run and mention these in future handoffs until upstream fixes land.

## Verification Regimen

- `npm run lint`
- `npm run typecheck`
- `npm run compile`
- `npx vitest run src/extension/prompt/vscode-node/test/liveRequestEditorProvider.spec.ts src/extension/prompt/node/test/liveRequestEditorService.spec.ts src/extension/prompt/node/test/defaultIntentRequestHandler.spec.ts`
- `npm run test:unit` (fails as listed above)
- `npm run simulate -- --scenario-test debugCommandToConfig.stest.ts --grep "node test"`
