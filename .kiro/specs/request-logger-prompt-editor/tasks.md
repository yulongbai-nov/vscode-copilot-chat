# Implementation Plan

## Status Snapshot

- ✅ Backend plumbing landed: the feature flag is in `package.json`, the `ILiveRequestEditorService` + builder produce editable sections, and `defaultIntentRequestHandler` now feeds edited messages to the fetcher.
- ✅ Send/reset helpers exist server-side (`getMessagesForSend`, `resetRequest`, `isDirty`), ensuring the prompt pipeline can already consume edited sections once a UI drives the mutations.
- 🚧 Next sprint focus flows directly from the open items: (1) build the Prompt Inspector drawer UI (Tasks 4.1–4.10), (2) enforce send blocking/reset UX (Task 5.4 plus associated messaging), (3) add telemetry + accessibility polish + tests (Tasks 6.x/7.x).

---

- [ ] 1. Feature flag and configuration  
  - [x] 1.1 Add configuration key `github.copilot.chat.advanced.livePromptEditorEnabled` with appropriate default and description. _Requirements: 1.1, 1.5_  
  - [x] 1.2 Gate all Live Chat Request Editor UI and logic behind this flag. _Requirements: 1.5, 5.5_  

- [ ] 2. Editable request model and section builder  
  - [x] 2.1 Define `EditableChatRequest` and `LiveRequestSection` types in a shared chat/prompt module. _Requirements: 2.1, 4.1, 5.1_  
  - [x] 2.2 Implement a builder that maps `RenderPromptResult` (`messages`, `tokenCount`, `metadata`, `references`) into an initial `EditableChatRequest`. _Requirements: 2.1, 2.3, 5.2_  
  - [x] 2.3 Use message roles, references, and metadata to classify sections as `system`, `user`, `context`, `tool`, `history`, etc. _Requirements: 2.2, 3.7_  
  - [ ] 2.4 Integrate optional `HTMLTracer` data (when available) to refine section boundaries and token counts, falling back gracefully when tracing is disabled. _Requirements: 2.5, 5.3_  
  - [x] 2.5 Track original messages and content to support reset and diffing. _Requirements: 3.4, 4.4_  

- [ ] 3. Wiring into the chat request pipeline  
  - [x] 3.1 Update the intents/prompt-building layer (e.g., `defaultIntentRequestHandler`) to request an `EditableChatRequest` instead of raw `messages` when the feature flag is enabled. _Requirements: 1.2, 4.1, 5.1_  
  - [x] 3.2 Ensure `ChatMLFetcher.fetchMany` consumes `EditableChatRequest.messages` when edits are present, and preserves existing behaviour when no edits exist or the feature is disabled. _Requirements: 4.2, 4.3_  
  - [x] 3.3 Confirm that `IRequestLogger.logChatRequest` sees the final, edited request and add tests/diagnostics to verify parity with what the editor displayed. _Requirements: 5.1, 5.4_  
  - [x] 3.4 Handle error cases where the editor state cannot be mapped back into valid ChatML messages, surfacing clear errors and offering reset. _Requirements: 4.5, 6.4_  

- [x] 4. Prompt Inspector UI (webview-first while native drawer is unavailable)  
  - [x] 4.1 Add a “View Prompt” / Prompt Inspector toggle to the chat panel UI when the feature flag is enabled. _Requirements: 1.2, 1.3_  
  - [x] 4.2 Implement the next-generation Prompt Inspector inside the existing webview (drawer-style layout, sticky metadata, section stack) while wiring it to the live `EditableChatRequest` model. _Requirements: 1.3, 2.1_  
  - [x] 4.3 Render Prompt Sections in the webview using components that visually match the chat panel (chat bubbles, markdown, code blocks) and section headers with labels + token counts. _Requirements: 2.2, 2.3, 2.5_  
  - [x] 4.4 Implement per-section collapse/expand controls with persistent state for the current editor session (stored in the webview state). _Requirements: 2.4_  
  - [x] 4.5 Implement the Section Action Menu that appears on hover/focus with `Edit` / `Delete` actions, visually matching the **chat code block hover toolbar** even though it runs inside the webview. _Requirements: 3.1, 3.2_  
  - [x] 4.6 Implement inline edit mode per section (textarea/editor embedded in the webview) and update both section content and the underlying `EditableChatRequest.messages`. _Requirements: 3.3, 3.4, 4.1_  
  - [x] 4.7 Implement delete/restore semantics per section (soft delete with clear visual treatment and “Restore” affordance). _Requirements: 3.5, 3.6_  
  - [x] 4.8 Add a metadata area showing model, location, and token limits derived from the request. _Requirements: 2.6_  
  - [x] 4.9 Ensure keyboard accessibility and ARIA labelling for sections, menus, and actions within the webview DOM. _Requirements: 6.1, 6.2_  
  - [x] 4.10 Add a conversation selector (drop-down) inside the webview that lists other open conversations in the current window and allows switching the inspector’s target session. _Requirements: 7.3, 7.4, 7.5_  
  - [x] 4.11 Surface tool invocation metadata (tool name + JSON arguments) inside tool sections so auditors can inspect the exact call inputs. _Requirements: 2.7_  

- [ ] 5. Apply, reset, and send integration  
  - [ ] 5.1 Implement a mechanism to mark the `EditableChatRequest` as “dirty” when edits occur, and surface this in the UI. _(Backend plumbing via `isDirty` is ready; UI indicator still required.)_ _Requirements: 4.1, 4.4_  
  - [x] 5.2 Wire the Send action to use edited messages when the request is dirty, and original messages otherwise. _Requirements: 4.2, 4.3_  
  - [ ] 5.3 Implement “Reset to default prompt” to restore `EditableChatRequest` from `originalMessages` and clear edits. _(Service-level `resetRequest` exists; hook up UI action.)_ _Requirements: 4.4_  
  - [ ] 5.4 Guard against invalid/empty requests (e.g., all sections deleted) by blocking send with explanatory error UI and offering reset. _Requirements: 4.5_  

- [ ] 6. Performance, reliability, and security hardening  
  - [ ] 6.1 Add lazy rendering or truncation for very large sections with “Show more” links to protect UI responsiveness. _Requirements: 6.3_  
  - [ ] 6.2 Add robust error handling around section building and rendering, including fallbacks to plain-text views. _Requirements: 6.4, 6.6_  
  - [ ] 6.3 Ensure rendered content respects existing sanitization and CSP constraints used by the chat panel. _Requirements: 6.5_  
  - [ ] 6.4 Verify that enabling the feature has minimal impact on baseline request latency when the Prompt Inspector is not opened or edits are not made. _Requirements: 6.3_  

- [ ] 7. Tests and validation  
  - [ ] 7.1 Add unit tests for the `EditableChatRequest` / section builder mapping from `RenderPromptResult`. _Requirements: 2.1, 2.3, 5.2_  
  - [ ] 7.2 Add tests for section editing, deletion, restore, and reset logic (state reducer level). _Requirements: 3.3–3.6, 4.4_  
  - [ ] 7.3 Add integration tests that simulate a chat turn with the feature enabled, including viewing the prompt, editing sections, and confirming that `ChatMLFetcher` receives updated messages. _Requirements: 1.2, 4.3, 5.4_  
  - [ ] 7.4 Perform manual validation for representative prompts: simple prompts, prompts with multiple system messages, heavy context, and tool hints. _Requirements: 2.2, 2.5_  
  - [ ] 7.5 Manually test keyboard navigation and screen reader behaviour within the Prompt Inspector. _Requirements: 6.1, 6.2_  
- [ ] 7.6 Manually validate behaviour with multiple concurrent chat sessions (panel, side panel, editor-embedded) and switching via the conversation selector. _Requirements: 7.1–7.5_  

- [x] 8. Prompt interception mode  
  - [x] 8.1 Add a persisted configuration + command + status bar indicator for Prompt Interception Mode (default off). _Requirements: 8.1, 8.8_  
  - [x] 8.2 Extend `defaultIntentRequestHandler` (or equivalent) to pause sends when interception is enabled, storing pending requests/resolvers per conversation without triggering offline UI. _Requirements: 8.2, 8.3, 8.9_  
  - [x] 8.3 Update the Live Request Editor webview to react to interception events: auto-focus, display the interception banner, highlight the view, and show prominent “Resume Send” / “Cancel” buttons. _Requirements: 8.4, 8.5_  
  - [x] 8.4 Wire the “Resume Send” and “Cancel” actions back to the extension host so edits are applied before resuming or discarded on cancel, including cleanup when the user switches conversations or closes the view. _Requirements: 8.6, 8.7_  
  - [x] 8.5 Emit telemetry for mode toggles and interception outcomes (resume/cancel/timeout) to aid adoption tracking. _Requirements: 8.10_  
  - [x] 8.6 Add tests covering the interception flow (pending send, resume, cancel, multi-session interactions) and manual QA instructions for the new mode. _Requirements: 8.3–8.9_  

## Implementation Notes

- Start by plumbing the editable request model (without UI) and verifying that edited messages can flow through `ChatMLFetcher` and `IRequestLogger` correctly and safely.
- Once the model is stable, add a minimal Prompt Inspector UI that is read-only, then layer in section-level editing and deletion.
- Prefer reusing existing chat panel components, markdown renderers, and hover toolbar styles rather than introducing parallel UI systems.
- VS Code does not yet expose APIs for embedding a drawer directly inside the native chat panel. Until that support lands upstream, all Prompt Inspector UX work (Tasks 4.x) targets the existing webview. Keep the UX/concepts aligned with the eventual drawer so we can migrate quickly once the host enables it.

## Dependencies

- Existing chat conversation and prompt rendering pipeline (`Conversation`, intents, `PromptRenderer`, `ChatMLFetcher`).
- Existing Request Logger infrastructure for request and prompt traces.
- Existing chat panel UI components and styles.

## Testing Priority

- Highest: correctness of the mapping between editor state and the actual ChatML requests that are sent and logged.
- High: stability and responsiveness of the chat UI when Prompt Inspector is open for large prompts.
- Medium: accessibility behaviour and feature-flag gating.

## Current Status Summary

- Feature flag, editable request model, and prompt-pipeline wiring now exist behind the advanced flag; edits propagate through `ChatMLFetcher` even without a UI.  
- Remaining tracked work is focused on the Prompt Inspector drawer UX, error/dirty/reset surfacing, telemetry/accessibility, and the associated automated/manual tests (Tasks 4.x–7.x).  
