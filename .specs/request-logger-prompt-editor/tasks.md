# Implementation Plan

## Status Snapshot

- ✅ Backend plumbing landed: the feature flag is in `package.json`, the `ILiveRequestEditorService` + builder produce editable sections, and `defaultIntentRequestHandler` now feeds edited messages to the fetcher.
- ✅ Send/reset helpers exist server-side (`getMessagesForSend`, `resetRequest`, `isDirty`), ensuring the prompt pipeline can already consume edited sections once a UI drives the mutations.
- ✅ HTML tracer enrichment is applied end-to-end, aligning token counts/trace paths with sections even when tracing is optional.
- ✅ Legacy section edit/delete/reset logic is covered by unit + simulation tests; interception/subagent flows are validated.
- 🚧 Remaining focus: (1) message-level fidelity editing UI (Tasks 2.6, 4.12–4.15, 7.8), (2) performance/accessibility hardening (Tasks 6.x), and (3) deeper integration/simulation coverage (Tasks 7.3–7.6).
- Reality gap: snapshot-based rendering from `IBuildPromptContext` (Tasks 14.x / Requirement 17) is **not implemented**; the editor still runs on `RenderPromptResult.messages`. Leaf-level/structural editing is also pending.

---

- [ ] 1. Feature flag and configuration  
  - [x] 1.1 Add configuration key `github.copilot.chat.advanced.livePromptEditorEnabled` with appropriate default and description. _Requirements: 1.1, 1.5_  
  - [x] 1.2 Gate all Live Chat Request Editor UI and logic behind this flag. _Requirements: 1.5, 5.5_  

- [ ] 2. Editable request model and section builder  
  - [x] 2.1 Define `EditableChatRequest` and `LiveRequestSection` types in a shared chat/prompt module. _Requirements: 2.1, 4.1, 5.1_  
  - [x] 2.2 Implement a builder that maps `RenderPromptResult` (`messages`, `tokenCount`, `metadata`, `references`) into an initial `EditableChatRequest`. _Requirements: 2.1, 2.3, 5.2_  
  - [x] 2.3 Use message roles, references, and metadata to classify sections as `system`, `user`, `context`, `tool`, `history`, etc. _Requirements: 2.2, 3.7_  
  - [x] 2.4 Integrate optional `HTMLTracer` data (when available) to refine section boundaries and token counts, falling back gracefully when tracing is disabled. _Requirements: 2.5, 5.3_  
  - [x] 2.5 Track original messages and content to support reset and diffing. _Requirements: 3.4, 4.4_  
  - [ ] 2.6 Refine `LiveRequestSection` to support hierarchical projections (message nodes grouping child content/toolCall/metadata nodes) keyed by Raw indices and `rawPath`, without introducing a separate payload structure. _Requirements: 16.1–16.3_  
  - [x] 2.7 Add a per-request `EditHistory` model that records leaf-level edits (per-field `oldValue`/`newValue`) against stable targets, suitable for undo/redo without aggregate text redistribution. _Requirements: 15.2–15.7_  

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
  - [x] 4.6 Implement inline edit mode per section (legacy textarea editor) and update both section content and the underlying `EditableChatRequest.messages`. _Requirements: 3.3, 3.4, 4.1_  
  - [x] 4.7 Implement delete/restore semantics per section (soft delete with clear visual treatment and “Restore” affordance). _Requirements: 3.5, 3.6_  
  - [x] 4.8 Add a metadata area showing model, location, and token limits derived from the request. _Requirements: 2.6_  
  - [x] 4.9 Ensure keyboard accessibility and ARIA labelling for sections, menus, and actions within the webview DOM. _Requirements: 6.1, 6.2_  
  - [x] 4.10 Add a conversation selector (drop-down) inside the webview that lists other open conversations in the current window and allows switching the inspector’s target session. _Requirements: 7.3, 7.4, 7.5_  
  - [x] 4.11 Surface tool invocation metadata (tool name + JSON arguments) inside tool sections so auditors can inspect the exact call inputs. _Requirements: 2.7_  
  - [ ] 4.12 Update the webview layout so each message card contains a structured, foldable “Raw structure” panel: keys (`content[i].text`, `toolCalls[i].function.arguments`, `name`, `requestOptions.temperature`) as headers and values as editable leaf editors or nested groups, respecting the Raw JSON hierarchy. _Requirements: 15.2, 16.1–16.5_  
  - [ ] 4.13 Wire new leaf-level edit actions from the webview to the extension host (e.g., `editLeaf` messages) so that each edit targets a single Raw field; update section projections to reflect the modified message while preserving all other fields. _Requirements: 15.2–15.7_  
  - [ ] 4.14 Retire the legacy textarea editor: route `Edit` to the Raw structure editor only, hide `Edit` in “Send normally”, and ensure displayed `rawPath` indices match the payload view after deletions. _Requirements: 3.8, 3.9, 16.3_  
  - [ ] 4.15 Add undo/redo controls for leaf edits in the Raw structure editor, using the per-request `EditHistory` (`undoLastEdit` / `redoLastEdit`). _Requirements: 3.4, 15.2_  

- [x] 5. Apply, reset, and send integration  
  - [x] 5.1 Implement a mechanism to mark the `EditableChatRequest` as “dirty” when edits occur, and surface this in the UI. _Requirements: 4.1, 4.4_  
  - [x] 5.2 Wire the Send action to use edited messages when the request is dirty, and original messages otherwise. _Requirements: 4.2, 4.3_  
  - [x] 5.3 Implement “Reset to default prompt” to restore `EditableChatRequest` from `originalMessages` and clear edits. _Requirements: 4.4_  
  - [x] 5.4 Guard against invalid/empty requests (e.g., all sections deleted) by blocking send with explanatory error UI and offering reset. _Requirements: 4.5_  
- [x] 5.5 Provide configuration-driven “extra detail” surfaces: keep telemetry as an optional panel inside the Live Request Editor and surface `requestOptions` / raw payload data through the Live Request Metadata view whenever the corresponding `extraSections` entries are enabled. _Requirements: 5.6, 10.9, 10.10_  

- [ ] 6. Performance, reliability, and security hardening  
  - [ ] 6.1 Add lazy rendering or truncation for very large sections with “Show more” links to protect UI responsiveness. _Requirements: 6.3_  
  - [ ] 6.2 Add robust error handling around section building and rendering, including fallbacks to plain-text views. _Requirements: 6.4, 6.6_  
  - [ ] 6.3 Ensure rendered content respects existing sanitization and CSP constraints used by the chat panel. _Requirements: 6.5_  
  - [ ] 6.4 Verify that enabling the feature has minimal impact on baseline request latency when the Prompt Inspector is not opened or edits are not made. _Requirements: 6.3_  

- [ ] 7. Tests and validation  
  - [x] 7.1 Add unit tests for the `EditableChatRequest` / section builder mapping from `RenderPromptResult`. _Requirements: 2.1, 2.3, 5.2_  
  - [x] 7.2 Add tests for section editing, deletion, restore, and reset logic (state reducer level). _Requirements: 3.3–3.6, 4.4_  
  - [ ] 7.3 Add integration tests that simulate a chat turn with the feature enabled, including viewing the prompt, editing sections, and confirming that `ChatMLFetcher` receives updated messages. _Requirements: 1.2, 4.3, 5.4_  
  - [ ] 7.4 Perform manual validation for representative prompts: simple prompts, prompts with multiple system messages, heavy context, and tool hints. _Requirements: 2.2, 2.5_  
  - [ ] 7.5 Manually test keyboard navigation and screen reader behaviour within the Prompt Inspector. _Requirements: 6.1, 6.2_  
- [ ] 7.6 Manually validate behaviour with multiple concurrent chat sessions (panel, side panel, editor-embedded) and switching via the conversation selector. _Requirements: 7.1–7.5_  
  - [x] 7.7 Evaluate adding a simulation/extension-harness scenario for edited-send flow (feature flag on, edit + replay through ChatMLFetcher) to raise stability signal. _Requirements: 1.2, 4.3, 5.4_  
  - [ ] 7.8 Add targeted unit tests for leaf edits + hierarchy projection (multiple text parts, tool arguments, request options; `rawPath` alignment after deletions). _Requirements: 15.7, 16.7_  

- [x] 8. Prompt interception mode  
  - [x] 8.1 Add a persisted configuration + command + status bar indicator for Prompt Interception Mode (default off). _Requirements: 8.1, 8.8_  
  - [x] 8.2 Extend `defaultIntentRequestHandler` (or equivalent) to pause sends when interception is enabled, storing pending requests/resolvers per conversation without triggering offline UI. _Requirements: 8.2, 8.3, 8.9_  
  - [x] 8.3 Update the Live Request Editor webview to react to interception events: auto-focus, display the interception banner, highlight the view, and show prominent “Resume Send” / “Cancel” buttons. _Requirements: 8.4, 8.5_  
  - [x] 8.4 Wire the “Resume Send” and “Cancel” actions back to the extension host so edits are applied before resuming or discarded on cancel, including cleanup when the user switches conversations or closes the view. _Requirements: 8.6, 8.7_  
- [x] 8.5 Emit telemetry for mode toggles and interception outcomes (resume/cancel/timeout) to aid adoption tracking. _Requirements: 8.10_  
- [x] 8.6 Add tests covering the interception flow (pending send, resume, cancel, multi-session interactions) and manual QA instructions for the new mode. _Requirements: 8.3–8.9_  
- [x] 8.7 Auto-cancel pending interceptions when the backing chat session or model context changes, removing stale requests from the editor and surfacing a “context changed” reason. _Requirements: 8.7, 8.11_  
- [x] 8.8 Skip interception for subagent/tool (`isSubagent`) requests so automation never pauses; guard both the request handler and service layer to guarantee these turns proceed immediately. _Requirements: 9.2_  

- [x] 9. Session-alignment metadata + collapsible extras
  - [x] 9.1 Add `github.copilot.chat.promptInspector.sessionMetadata.fields` (string array) setting, documenting defaults and gating behind the main feature flag. _Requirements: 10.1_  
- [x] 9.2 Extend `ILiveRequestEditorService` to publish per-session metadata snapshots (session id, request id, model, location, interception state) and expose an event the Live Request Metadata view can subscribe to. _Requirements: 10.2_  
- [x] 9.3 Implement the `github.copilot.liveRequestMetadata` tree view that lists metadata rows, the token budget entry, and optional outline nodes for request options/raw payloads when enabled via `extraSections`. _Requirements: 10.1–10.11_  
- [x] 9.4 Keep the metadata view reactive when fields are removed/flag is off, ensuring metadata nodes hide while token + idle messaging continue to work. _Requirements: 10.4–10.6_  
- [x] 9.5 Surface the “Configure metadata” toolbar command and persist Quick Pick selections back into `sessionMetadata.fields`. _Requirements: 10.7_  
- [x] 9.6 Wire the metadata/outline leaves to `github.copilot.liveRequestMetadata.copyValue`, ensuring clipboard operations provide status feedback. _Requirements: 10.8_  
- [x] 9.7 Keep telemetry as the only optional “extra” panel inside the webview inspector and move `requestOptions` / `rawRequest` rendering to the metadata outline nodes. _Requirements: 2.8, 10.9, 10.10_  

- [ ] 10. Auto intercept & prefix override
  - [x] 10.1 Extend `ILiveRequestEditorService` with a `LiveRequestEditorMode` enum/state, persistence helpers for overrides (session/workspace/global scopes), and events for mode/scope changes. _Requirements: 11.1, 11.4, 11.7_  
  - [x] 10.2 Add new settings + commands (`autoOverride.previewLimit`, `…scopePreference`, `liveRequestEditor.setMode`, etc.) and plumb them through the configuration service. _Requirements: 11.2, 11.4_  
  - [x] 10.3 Update the Live Request Editor UI (header toggle, banner, status bar) to reflect the new mode, expose Pause/Edit/Clear actions, and prompt for scope via Quick Pick. _Requirements: 11.1, 11.6_  
  - [x] 10.4 Implement auto-override preview limiting (first `N` sections) during the initial interception and resume automatic sends once overrides are saved. _Requirements: 11.2, 11.3_  
- [x] 10.5 Add per-section “Show diff” buttons that invoke `vscode.diff` with temp documents plus tooltips showing scope + timestamps. _Requirements: 11.5_  
- [x] 10.6 Persist overrides across reloads (global/workspace storage) and ensure clearing overrides removes the stored payload + returns to normal interception. _Requirements: 11.4, 11.7_  
- [x] 10.7 Emit telemetry for mode/scope transitions, override saves/clears, and diff launches; document the new behavior in docs/handoff. _Requirements: 11.8_  
- [x] 10.8 Simplify Auto-apply UX labels and controls: rename modes to “Send normally” / “Pause & review every turn” / “Auto-apply saved edits”, treat “Pause next turn” as a one-shot action, and expose a primary “Capture new edits” flow with a secondary menu for scope/preview/clear. _Requirements: 11.1, 11.4, 11.5_  
- [x] 10.9 Rework Auto-apply state handling to two user-visible states (Capturing vs Applying), auto-arm capture when no overrides exist or after clearing, and hide redundant actions while capturing. _Requirements: 11.2, 11.3, 11.7_  
- [x] 10.10 Update telemetry and status/banners to use simplified copy (“Auto-apply edits · <scope> · Applying/Capturing”), ensure one-shot “Pause next turn” does not alter persisted mode, and refresh docs accordingly. _Requirements: 11.5, 11.8_  

- [ ] 11. Chat timeline prompt replay (moved)  
  - Tracked in `.specs/chat-timeline-replay/tasks.md`.  

- [ ] 12. Chat history persistence (moved)  
  - Tracked in `.specs/chat-history-persistence/tasks.md`.  

- [ ] 13. Graphiti memory layer (moved)  
  - Tracked in `.specs/graphiti-memory-integration/tasks.md`.  

- [ ] 14. Session-sourced Live Request model  
  - [x] 14.1 Capture a per-session snapshot (normalized `IBuildPromptContext`, requestOptions, endpoint/model info) before prompt rendering and persist it in `LiveRequestEditorService`. _Requirements: 17.1_  
  - [x] 14.2 Add a snapshot-based renderer (reuse `PromptRenderer` with the captured context/config) to regenerate `Raw.ChatMessage[]` for section building/reset, with graceful fallback to existing `RenderPromptResult.messages`. _Requirements: 17.2, 17.3_  
  - [x] 14.3 Update the Live Request Builder/Editor to treat snapshot-rendered messages as the base, applying edits/deletes atop them and preserving `originalMessages` for reset/diff. _Requirements: 17.2, 17.4_  
  - [ ] 14.4 Emit parity telemetry (snapshot render vs fallback) and wire error logging without user content. _Requirements: 17.3, 17.5_  
  - [ ] 14.5 Add unit/integration coverage: snapshot capture, rerender parity, fallback path, and ensuring `ChatMLFetcher` sees edited snapshot-derived messages. _Requirements: 17.1–17.4_  
  - [x] 14.6 Add a “Session” view in the webview to edit the snapshot (turns/tool-call rounds: add/edit/delete/restore) and re-render to messages on apply; fallback to original messages on render failure. _Requirements: 17.2, 17.4_  
  - [ ] 14.7 Add tests per increment: snapshot prune/capture (unit), snapshot edit → re-render → send (integration), and session-view UI wiring (webview tests). (Baseline prune/render unit coverage landed; integration/UI coverage pending.) _Requirements: 17.1–17.4_  

- [ ] 15. Replay edited session into new chat  
  - [ ] 15.1 Add “Apply & Replay” action to fork a new chat session using the edited snapshot, preserving lineage (orig session/turn → replay session/turn). _Requirements: 18.1, 18.5_  
  - [ ] 15.2 Use snapshot re-render for the replay payload, with fallback to last rendered/original messages and warning on failure. _Requirements: 18.2_  
  - [ ] 15.3 Send the replayed request and continue the conversation in the new session; ensure the original transcript remains unchanged. _Requirements: 18.3, 18.4_  
  - [ ] 15.4 Tests: replay flow integration (edit snapshot → re-render → replay session send → response received) and lineage recording. _Requirements: 18.1–18.5_  

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

- Feature flag, editable request model, prompt inspector UI, and interception mode are fully wired behind the advanced flag; HTML tracer enrichment is applied end-to-end and edits propagate through `ChatMLFetcher`, including subagent skips.  
- Remaining tracked work: performance/reliability/accessibility hardening (Tasks 6.x), deeper integration + manual validation (Tasks 7.3–7.6), the new chat timeline replay and persistence/Graphiti layers (Tasks 11–13).  
