# Implementation Plan – CLI History Replay Sample

- [ ] 1. Wiring & command surface  
  - [ ] 1.1 Add a CLI replay sample command (e.g. `github.copilot.cli.sessions.replaySampleNative`) in `package.json` under `contributes.commands`.  
  - [ ] 1.2 Add a context menu entry for `chatSessionType == 'copilotcli'` in `menus.chat/chatSessions` that passes the selected `ChatSessionItem` to the command.

- [ ] 2. Session access & creation  
  - [ ] 2.1 Extend `registerCLIChatCommands(...)` in `src/extension/chatSessions/vscode-node/copilotCLIChatSessionsContribution.ts` to register the new command.  
  - [ ] 2.2 Inside the handler, use `SessionIdForCLI.parse(sessionItem.resource)` to locate the **source** session id.  
  - [ ] 2.3 Use `ICopilotCLISessionService.getSession(sourceId, { readonly: true, ... })` to read the source session and its chat history.  
  - [ ] 2.4 Create a **new** session via `ICopilotCLISessionService.createSession(...)`, reusing model/agent/isolation options where reasonable.

- [ ] 3. History replay into new session  
  - [ ] 3.1 Iterate the source history (`getChatHistory()`) and map user turns to `addUserMessage(...)` on the new session.  
  - [ ] 3.2 Map assistant turns to `addUserAssistantMessage(...)` on the new session, concatenating Markdown parts as needed.  
  - [ ] 3.3 Ensure no write/mutation calls are made on the source session object.

- [ ] 4. Surfacing the replay session  
  - [ ] 4.1 Call `copilotcliSessionItemProvider.notifySessionsChange()` after replay to refresh the sessions list.  
  - [ ] 4.2 Open the replay session in the CLI chat editor, using `SessionIdForCLI.getResource(newSessionId)` plus `vscode.commands.executeCommand('vscode.open', resource)` or an equivalent chat open command.  
  - [ ] 4.3 Manually verify that the replay session appears and shows a reconstructed history without affecting the original session.

- [ ] 5. Manual title rename support  
  - [ ] 5.1 Add a `github.copilot.cli.sessions.rename` command in `package.json`, under `contributes.commands`.  
  - [ ] 5.2 Add a `chat/chatSessions` context menu entry for `chatSessionType == 'copilotcli'` that invokes the rename command.  
  - [ ] 5.3 Implement the handler in `registerCLIChatCommands(...)` to prompt for a new label and call `CopilotCLIChatSessionItemProvider.swap(original, { ...original, label: newLabel })`.  
  - [ ] 5.4 Add unit coverage to ensure the history builder ignores non-string content and that the rename plumbing is exercised.  

- [ ] 6. Simple sample CLI session command  
  - [ ] 6.1 Add a `github.copilot.cli.sessions.createSampleNative` command in `package.json` under `contributes.commands` (category: "Copilot CLI").  
  - [ ] 6.2 Implement the handler in `registerCLIChatCommands(...)` to create a brand new `CopilotCLISession` (no source session) via `ICopilotCLISessionService.createSession(...)`.  
  - [ ] 6.3 Seed the new session with a small, hard-coded history using `addUserMessage(...)` / `addUserAssistantMessage(...)` to demonstrate native-parity history (no replay dependency).  
  - [ ] 6.4 Apply a custom label for the sample session (e.g. `Sample CLI session · <shortId>`) using `CopilotCLIChatSessionItemProvider.setCustomLabel(...)` so it stands out in the sessions list.  
  - [ ] 6.5 Refresh the CLI sessions view and open the new session so it is immediately visible in the standard Copilot CLI chat editor.  

- [ ] 7. Align forked CLI sessions with agent responses (future)  
  - [ ] 7.1 Investigate how Live Request Editor / agent sessions (e.g. `LiveRequestSessionKey.sessionId`) map onto Copilot CLI session ids and what metadata is available to correlate them.  
  - [ ] 7.2 Design a cross-session mapping so that when an agent turn is logically associated with a CLI background session, we can identify the corresponding `CopilotCLISession`.  
  - [ ] 7.3 Prototype a hook that, given an agent’s final assistant response text, can safely append that text into the associated CLI session via `addUserAssistantMessage(...)` without breaking existing history semantics.  
  - [ ] 7.4 Evaluate how this mapping interacts with replay (e.g. whether replay should include agent-only turns) and document any limitations in `docs/cli-history-replay-handoff.md`.  

- [x] 8. Replay edited prompt into new CLI session from Live Request Editor  
  - [x] 8.1 Add a new command id (e.g. `github.copilot.liveRequestEditor.openInCopilotCLI`) in `package.json` and surface it via a button in the Live Request Editor UI next to “Replay edited prompt” (e.g. “Replay edited prompt in CLI session”).  
  - [x] 8.2 Extend `registerCLIChatCommands(...)` in `src/extension/chatSessions/vscode-node/copilotCLIChatSessionsContribution.ts` to register a handler for this command that accepts either a `LiveRequestReplayKey` or a `LiveRequestSessionKey` (session id + location).  
  - [x] 8.3 Within the handler, use `ILiveRequestEditorService.buildReplayForRequest(key)` (or `getReplaySnapshot(...)` when a replay key is provided) to fetch the replay payload, create a new CLI session via `ICopilotCLISessionService.createSession(...)`, and seed its history by iterating `snapshot.payload` and calling `addUserMessage(...)` / `addUserAssistantMessage(...)` with text rendered using the same rules as the replay payload view.  
  - [x] 8.4 Apply a distinct label (e.g. `Replay from Live Request Editor · <shortId>`) via `CopilotCLIChatSessionItemProvider.setCustomLabel(...)`, refresh the CLI sessions list, and open the new CLI session in the chat editor.  
  - [x] 8.5 Add unit coverage to validate that the Live Request Editor webview issues the correct command id, and that the CLI replay-from-replay path correctly renders simple system/user/assistant payload messages into seeded CLI history for both replay-key and session-key invocations.  

- [x] 9. Payload diff helper for Live Request Editor replay  
  - [x] 9.1 Add a new command id (e.g. `github.copilot.liveRequestEditor.showReplayPayloadDiff`) in `package.json` that is not directly visible in menus, but is invokable from the Live Request Editor webview with a `LiveRequestReplayKey` or `{ sessionId, location }` argument.  
  - [x] 9.2 Implement a helper in `src/extension/prompt/vscode-node/liveRequestEditorProvider.ts` (or a small dedicated module) that, given the current `EditableChatRequest` and/or `LiveRequestReplaySnapshot`, constructs:
    - A “before” payload document by serializing `originalMessages` (or equivalent Raw source) to pretty-printed JSON, and  
    - An “after” payload document by serializing the edited payload used for replay (the same `sendResult.messages` that `buildReplayForRequest(...)` relies on), using stable key ordering and indentation.  
  - [x] 9.3 Wire the new command to open a VS Code diff editor over two virtual, read-only text documents labelled “Original payload” and “Edited payload”, with a descriptive diff title (e.g. `Live Request Editor · Payload diff · <shortId>`).  
  - [x] 9.4 Extend the Live Request Editor webview replay metadata row in `src/extension/prompt/webview/vscode/liveRequestEditor/main.tsx` with a “Show payload diff” button next to “Replay edited prompt in CLI session”, which posts a message back to the provider to invoke the diff command for the current request/replay.  
  - [x] 9.5 Add targeted unit tests (or lightweight integration tests) that:
    - Verify the diff command builds the expected JSON strings for a simple request with one or two edited messages, and  
    - Assert that the “before” payload matches `originalMessages` while the “after” payload reflects edited `messages`, without mutating any underlying state.  

- [x] 10. Live Request Payload view (dedicated)  _Requirements: 10.4_
  - [x] 10.1 Add a draggable webview view `github.copilot.liveRequestPayload` that renders the active request `messages[]` as pretty JSON and supports copy/open-in-editor.
  - [x] 10.2 Wire the Live Request Editor provider to notify the payload view when the active session changes.

- [x] 11. LRE follow-mode binding + persistence  _Requirements: 10.1–10.4, 11.1–11.3_
  - [x] 11.1 Add follow-mode semantics (manual selection disables follow; follow enables newest-wins) and visual flash cues.
  - [x] 11.2 Fix webview event wiring so the dropdown selection reliably propagates to provider state (no stale sections/payload).
  - [x] 11.3 Persist follow-mode + last manual selection in the LRE webview state (`acquireVsCodeApi().setState`) and restore on reload.
  - [x] 11.4 Persist intercepted sessions across restart in `LiveRequestEditorService` (`workspaceState`) and rehydrate on activation.

- [x] 12. Open selected conversation in chat  _Requirements: 12.1–12.3_
  - [x] 12.1 Capture `ChatContext.chatSessionContext.chatSessionItem.resource` when available and store it on `EditableChatRequestMetadata`.
  - [x] 12.2 Add “Open in chat” button next to the LRE conversation dropdown that opens the stored session resource, or shows a fallback message.

- [x] 13. Declare session participants in package.json  _Requirements: 13.1–13.2_
  - [x] 13.1 Add `contributes.chatParticipants` entries for session-backed participants created at runtime (e.g. `copilotcli`, `copilot-cloud-agent`, `claude-code`, `copilot-live-replay`, `copilot-live-replay-fork`).

- [x] 14. LRE raw-structure leaf editor (messages[])  _Requirements: 14.1–14.5, 15.1–15.5_
  - [x] 14.1 Add a per-card raw-structure tree editor in `src/extension/prompt/webview/vscode/liveRequestEditor/main.tsx`.
  - [x] 14.2 Wire leaf-edit messages (`editLeaf`, `undoLeafEdit`, `redoLeafEdit`) through `src/extension/prompt/vscode-node/liveRequestEditorProvider.ts`.
  - [x] 14.3 Implement leaf editing + undo/redo history in `src/extension/prompt/node/liveRequestEditorService.ts`.
  - [x] 14.4 Add unit coverage for leaf edits in `src/extension/prompt/node/test/liveRequestEditorService.spec.ts`.
