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
