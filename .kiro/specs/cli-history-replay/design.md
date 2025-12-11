# Design Document: CLI History Replay Sample

**Feature name:** CLI history replay sample (Copilot CLI native-parity demo)

## Overview

This MVP adds a small workflow that demonstrates “native-parity” history replay for **Copilot CLI sessions**:

- Given an existing Copilot CLI chat session, we create a **new** CLI session.
- We **do not modify** the original session’s history.
- We **seed** the new session with a synthetic chat history built from the original, using the same mechanisms the CLI SDK uses for its own event log.
- The new session then appears in the **Copilot CLI chat sessions view** and opens in the standard CLI chat editor.

The goal is to show that we can approximate “native history replay” for Copilot CLI by using the same underlying session and history machinery, without needing special VS Code core APIs.

## Current Architecture (CLI sessions)

Key components involved in Copilot CLI chat sessions:

- `ICopilotCLISessionService` (`src/extension/agents/copilotcli/node/copilotcliSessionService.ts`)
  - Wraps the Copilot CLI SDK’s `internal.LocalSessionManager`.
  - Creates and rehydrates sessions (`createSession`, `getSession`).
  - Enumerates existing sessions from on-disk state (`getAllSessions`).

- `CopilotCLISession` (`src/extension/agents/copilotcli/node/copilotcliSession.ts`)
  - Thin wrapper over an SDK `Session`.
  - Listens to SDK events (`user.message`, `assistant.message`, `tool.execution_*`, etc.).
  - Exposes:
    - `handleRequest(...)` to run the CLI agent.
    - `addUserMessage(content)` / `addUserAssistantMessage(content)` to inject synthetic messages into the session event stream.
    - `getChatHistory()` which builds `ChatRequestTurn2` / `ChatResponseTurn2` from the SDK event log.

- `CopilotCLIChatSessionItemProvider` and `CopilotCLIChatSessionContentProvider`
  (`src/extension/chatSessions/vscode-node/copilotCLIChatSessionsContribution.ts`)
  - `ChatSessionItemProvider` lists existing CLI sessions (`chatSessionType == 'copilotcli'`).
  - `ChatSessionContentProvider` maps a session id → `ChatSession`:
    - Calls `ICopilotCLISessionService.getSession(..., readonly: true)` and then `getChatHistory()`.
    - Returns the result as `history` for the chat view.

- `CopilotCLIChatSessionParticipant`
  - Handles requests in the CLI session chat editor.
  - Uses `ICopilotCLISessionService` to get or create sessions and then calls `session.object.handleRequest(...)`.

## Proposed Architecture (CLI history replay sample)

We add a **small, opt-in sample command** that:

1. Lets the user select an existing Copilot CLI session (via the chat sessions view).
2. Creates a **new** Copilot CLI session with similar options (model, agent, isolation/worktree where possible).
3. Reads the source session’s chat history (user + assistant turns).
4. Replays that history into the new session using **synthetic events**:
   - `ICopilotCLISession.addUserMessage(...)`
   - `ICopilotCLISession.addUserAssistantMessage(...)`
5. Appends a short, synthetic “explain this replay session” exchange so the new session is self‑describing (MVP convenience).
6. Refreshes the CLI sessions list and opens the new session in the standard CLI chat editor.
7. Optionally lets the user **rename** the session tab/title to reflect the task it is running.

In addition, we add a **simple sample command** that creates a brand new Copilot CLI session and seeds it with a tiny, hard-coded history for quick demos:

- `github.copilot.cli.sessions.createSampleNative`:
  - Uses `ICopilotCLISessionService.createSession(...)` to open a fresh session (no source/replay).
  - Immediately calls `addUserMessage(...)` / `addUserAssistantMessage(...)` a few times with fixed strings (e.g. “hi”, “This is a sample Copilot CLI session created by the extension.”).
  - Applies a custom label via `CopilotCLIChatSessionItemProvider.setCustomLabel(...)` (for example, `Sample CLI session · <shortId>`) so these demo sessions are easy to recognize in the sessions list.
  - Refreshes the sessions view and opens the new session so the pre-made history is visible in the native CLI chat editor.

### Components and flow

- New replay command (e.g. `github.copilot.cli.sessions.replaySampleNative`):
  - Registered in `package.json` under `contributes.commands`.
  - Context menu entry for `chatSessionType == copilotcli` in `menus.chat/chatSessions`.

- New rename command (e.g. `github.copilot.cli.sessions.rename`):
  - Registered in `package.json` under `contributes.commands`.
  - Also exposed in the `chat/chatSessions` context menu when `chatSessionType == copilotcli`.
  - Uses `CopilotCLIChatSessionItemProvider.swap(...)` to update the `ChatSessionItem.label` (tab title) for that session.

- Implementation location:
  - Extend `registerCLIChatCommands(...)` in
    `src/extension/chatSessions/vscode-node/copilotCLIChatSessionsContribution.ts` to register both commands.

- Command handler behavior:
  1. Accepts an optional `vscode.ChatSessionItem` (clicked from the sessions view).
  2. Uses `SessionIdForCLI.parse(item.resource)` to get `sourceSessionId`.
  3. Opens the **source** session via `ICopilotCLISessionService.getSession(sourceSessionId, { readonly: true, ... })`.
  4. Extracts:
     - `sourceHistory = session.object.getChatHistory()`
     - `sourceModelId = await session.object.getSelectedModelId()`
     - `sourceOptions = session.object.options` (isolation flag, working dir).
  5. Creates a **new** session via `createSession({ model: sourceModelId, workingDirectory, isolationEnabled, agent })`.
  6. Iterates `sourceHistory` and for each user/assistant pair:
     - For `ChatRequestTurn2`: `newSession.object.addUserMessage(text)`
     - For `ChatResponseTurn2`: `newSession.object.addUserAssistantMessage(combinedResponseText)`
  7. Calls `copilotcliSessionItemProvider.notifySessionsChange()` to update the sessions list.
  8. Opens the new session editor using:
     - `SessionIdForCLI.getResource(newSession.object.sessionId)` +
     - `vscode.commands.executeCommand('vscode.open', resource)` or
     - `workbench.action.chat.openNewSessionEditor.copilotcli` seeded with the resource.

### Key properties

- **Read-only source**:
  - We never mutate or delete events from the source session; we only:
    - Read its event stream (`getChatHistory()`).
    - Use its options as hints for the new session.

- **Replay fidelity vs simplicity**:
  - MVP will:
    - Preserve ordering of turns.
    - Preserve essential content (user text, assistant Markdown).
  - It will not:
    - Attempt to replay low-level tool telemetry or edits.
    - Reconstruct exact thinking/streaming behavior.

## Data & Control Flow

High-level flow for the sample replay:

1. User right-clicks a Copilot CLI session in the chat sessions view.
2. Chooses “Replay in new CLI session (sample)” (exact label TBD).
3. Extension handler:
   - Loads source session (read-only).
   - Creates a new session.
   - Feeds synthetic user/assistant messages based on the source.
4. CLI SDK persists the new session’s event log.
5. The chat sessions view refreshes and shows the new session.
6. Chat editor opens on the new session with its **replayed** history.

## Integration Points

- Reuses existing services:
  - `ICopilotCLISessionService`
  - `CopilotCLIChatSessionItemProvider`
  - `CopilotCLIChatSessionContentProvider`
  - `ICopilotCLIAgents`, `ICopilotCLIModels`, `CopilotCLIWorktreeManager` (for baseline options).

- No changes to:
  - Live Request Editor / replay system.
  - Default Copilot chat participants or tools.

## Risks and Considerations

- **SDK expectations**:
  - We rely on `Session.emit('user.message' | 'assistant.message', ...)` being recorded in the event log in a way that `getEvents()` returns them consistently. This already happens in `recordPushToSession`, so we are following an existing pattern.

- **Partial fidelity**:
  - The new session’s history will be “replayed” rather than truly cloned; low-level metadata (e.g., tool execution events) may be missing.
  - This is acceptable for an **MVP sample** and should be clearly documented.

- **User confusion**:
  - Two sessions will exist: source and replayed.
  - The command label and description should make it clear that a **new** session is created and the original is untouched.

## Future Enhancements (Out of Scope for MVP)

- Add a Live Request Editor → Copilot CLI fork path:
  - From a `LiveRequestReplaySnapshot` (edited prompt + replay payload), provide a button in the replay summary that:
    - Creates a new `CopilotCLISession` via `ICopilotCLISessionService.createSession(...)`.
    - Seeds its history by iterating the replay payload (`Raw.ChatMessage[]`) and calling `addUserMessage(...)` / `addUserAssistantMessage(...)` with text rendered using the same rules as the Live Replay view.
    - Labels the new session clearly (e.g. `Replay from Live Request Editor · <shortId>`) and opens it in the Copilot CLI chat view so the user can continue from that forked state using native CLI behaviour.
- Attach a lightweight “source session” link/metadata to the new session (e.g., first synthetic assistant message includes a backlink).
- Support replaying only a selected prefix or range of turns.
- Integrate with Live Request Editor replay snapshots as an alternate history source.
- Align “forked” CLI sessions with agent/Live Request Editor sessions so that:
  - the same logical turn (e.g. a C++ joke generated via code-generation instructions) is visible both in the intercepted agent session and in the CLI session event log, and
  - replayed CLI sessions can faithfully include those final agent responses. This will require an explicit mapping between the higher-level agent session id and the underlying CLI session id, and a hook that adds the agent’s final assistant message into the corresponding CLI session via `addUserAssistantMessage(...)`.
