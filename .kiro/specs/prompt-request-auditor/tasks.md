# Tasks – Prompt Request Auditor

> This checklist is meant as a hand-off for the next agent. Treat it as source-of-truth for remaining work and verification steps.

## 1. Wire PromptStateManager to ChatML Fetcher (DONE)

- [x] Inject `IChatMLFetcher` into `PromptStateManager` via the existing service registration in `extension/vscode-node/services.ts`.
- [x] Subscribe to `chatMLFetcher.onDidMakeChatMLRequest` in `PromptStateManager` and register the listener for disposal.
- [x] Implement a private `_updateFromChatRequest(event)` helper that:
  - [x] Returns early when the visualizer is disabled.
  - [x] Filters `event.messages` to `Raw.ChatRole.User`.
  - [x] Extracts the last user message and converts it to plain text with `getTextPart`.
  - [x] Calls `updatePrompt(promptText)` in a try/catch and reports failures to `ErrorHandler`.

## 2. Keep `/visualize-prompt` as a Debug Entry Point (DONE)

- [x] Verify that `PromptVisualizerChatParticipant` still:
  - [x] Uses `request.prompt` when `/visualize-prompt` is invoked.
  - [x] Falls back to `PromptStateManager.getCurrentState()` when no prompt is provided.
- [x] Confirm that running `/visualize-prompt` after a ChatML request shows the same sections/token counts for the user’s XML-tagged prompt.

## 3. Tests & Safety (DONE)

- [x] Update `promptStateManager.spec.ts` to:
  - [x] Provide a stub `IChatMLFetcher` with an `onDidMakeChatMLRequest` event.
  - [x] Reuse that stub when constructing any additional `PromptStateManager` instances in tests.
- [x] Run prompt visualizer unit suites:
  - [x] `promptStateManager.spec.ts`
  - [x] `promptSectionRenderer.spec.ts`
  - [x] `nativeChatRenderer.spec.ts`
  - [x] `promptSectionVisualizerProvider.spec.ts`
- [x] Ensure no new dependencies or side effects are introduced into the ChatML pipeline beyond the read-only subscription.

## 4. Documentation & Handoff (PARTIAL)

- [x] Add this spec folder: `.kiro/specs/prompt-request-auditor/` with:
  - [x] `design.md` describing the ChatML-powered visualizer architecture.
  - [x] `requirements.md` capturing prompt-auditing behavior.
  - [x] `tasks.md` (this file) summarizing work and status.
- [ ] Update `docs/prompt-visualizer-manual-test.md` to:
  - [ ] Explain that the panel now follows live ChatML requests automatically.
  - [ ] Call out `/visualize-prompt` as a debug entry point that shares the same state.

## 5. Nice-to-Have Follow-ups (OPEN)

- [ ] Add a small indicator in the standalone panel header (e.g., “Live from ChatML”) when the last update came from `onDidMakeChatMLRequest` vs `/visualize-prompt`.
- [ ] Consider a “pause live updates” control in the panel to freeze the current prompt while ChatML continues to run.
- [ ] Explore whether to surface **system** or **tool** messages in a separate section for deeper auditing, without overloading the core XML section view.

