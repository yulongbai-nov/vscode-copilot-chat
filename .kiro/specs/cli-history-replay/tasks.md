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

- [x] 8. Replay edited prompt into new CLI session from Live Replay  
  - [x] 8.1 Add a new command id (e.g. `github.copilot.liveRequestEditor.openInCopilotCLI`) in `package.json` and surface it via a button in the Live Replay summary bubble (e.g. “Open in Copilot CLI”).  
  - [x] 8.2 Extend `registerCLIChatCommands(...)` in `src/extension/chatSessions/vscode-node/copilotCLIChatSessionsContribution.ts` to register a handler for this command that accepts a `LiveRequestReplayKey` argument.  
  - [x] 8.3 Within the handler, use `ILiveRequestEditorService.getReplaySnapshot(key)` to fetch the replay payload, create a new CLI session via `ICopilotCLISessionService.createSession(...)`, and seed its history by iterating `snapshot.payload` and calling `addUserMessage(...)` / `addUserAssistantMessage(...)` with text rendered using the same rules as `LiveReplayChatProvider._renderMessageText(...)`.  
  - [x] 8.4 Apply a distinct label (e.g. `Replay from Live Request Editor · <shortId>`) via `CopilotCLIChatSessionItemProvider.setCustomLabel(...)`, refresh the CLI sessions list, and open the new CLI session in the chat editor.  
  - [x] 8.5 Add unit coverage to validate that the Live Replay summary includes the new CLI button wired to the correct command id, and that the CLI replay-from-replay path correctly renders simple system/user/assistant payload messages into seeded CLI history.  
