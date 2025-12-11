# Requirements Document: CLI History Replay Sample

## Introduction

This document defines functional requirements for an MVP feature that demonstrates **history replay** for Copilot CLI sessions by:

- Creating a **new** Copilot CLI session.
- Seeding it with a synthetic history derived from an existing CLI session.
- Presenting that new session through the standard Copilot CLI chat view.

The feature is intended as a sample / internal tool to explore “native-parity” replay patterns, not as a polished end-user feature.

## Glossary

- **Source session**: An existing Copilot CLI chat session whose history we want to replay.
- **Replay session**: A newly created Copilot CLI session whose event log is seeded with synthetic messages derived from the source session.
- **CLI chat view**: The VS Code chat editor surfaced for `chatSessionType == 'copilotcli'`.

## Requirements

### Requirement 1 – Create replay sessions without mutating source

**User Story:** As a Copilot engineer, I want to create a new Copilot CLI session from an existing one’s history so that I can experiment with “native-parity” replay flows without risking the original data.

#### Acceptance Criteria

1. THE system SHALL provide a command that can be invoked from the CLI chat sessions context (e.g. right-click on a `copilotcli` session item) to initiate a history replay.
2. WHEN the replay command runs, THE system SHALL NOT call any mutation APIs on the **source** session (only read history/options and, if needed, model/agent settings).
3. WHEN the replay command succeeds, THE system SHALL create a new Copilot CLI session with a different session id from the source.

### Requirement 2 – Seed replay session history using synthetic messages

**User Story:** As a Copilot engineer, I want the replay session to show a reconstructed conversation that closely mirrors the source session’s user/assistant messages.

#### Acceptance Criteria

1. THE system SHALL read the source session history via `ICopilotCLISession.getChatHistory()`.
2. THE system SHALL transform each user turn in the source history into at least one `addUserMessage(...)` call on the replay session.
3. THE system SHALL transform each assistant turn in the source history into at least one `addUserAssistantMessage(...)` call on the replay session.
4. WHEN the replay session is displayed in the CLI chat view, THEN the user SHALL see a sequence of turns that reflect the original conversation order (user→assistant).
5. THE system MAY omit or simplify low-level tool/telemetry events; only high-level user/assistant content is required for this MVP.

### Requirement 3 – Surface replay session in the standard CLI chat UI

**User Story:** As a user of the sample, I want to interact with the replayed history in the normal Copilot CLI chat UI so it feels “native”.

#### Acceptance Criteria

1. AFTER replay is complete, THE system SHALL ensure the replay session is listed in the Copilot CLI sessions view (`chatSessionType == 'copilotcli'`).
2. THE system SHALL open the replay session in the CLI chat editor automatically after creation, or provide a clear way to open it (e.g. via `vscode.open` on the resource).
3. WHEN the replay session is opened, THE chat editor SHALL show the replayed history using the same rendering as any other CLI session history (via `CopilotCLIChatSessionContentProvider`).

### Requirement 4 – Manual session title rename

**User Story:** As a Copilot engineer, I want to rename a CLI session tab so that its title reflects the task it is currently running (e.g. “index repo”, “run tests”), making it easier to distinguish sessions.

#### Acceptance Criteria

1. THE system SHALL provide a command that allows the user to rename an existing Copilot CLI session from the chat sessions context menu.
2. WHEN the rename command is invoked, THE system SHALL prompt the user for a new title, prefilled with the current label where possible.
3. WHEN the user confirms a non-empty title, THE system SHALL update the `ChatSessionItem.label` used for that session (tab title and list label) via `CopilotCLIChatSessionItemProvider.swap(...)`.
4. THE system SHALL NOT rename or touch the underlying CLI SDK metadata; this change is purely a UI label update.

### Requirement 5 – MVP scope and safety

**User Story:** As a maintainer, I want this sample to be easy to remove or evolve, and clearly marked as experimental.

#### Acceptance Criteria

1. THE implementation SHALL be small and self-contained (one command, minimal integration).
2. THE command title and description SHALL clearly indicate that this is a **sample** or **experiment**.
3. THE feature SHALL NOT introduce new configuration surface that affects default CLI behavior (e.g. no new settings that change how real CLI sessions are logged).

### Requirement 6 – Simple sample CLI session command

**User Story:** As a Copilot engineer, I want a one-click way to open a brand new Copilot CLI session pre-populated with a tiny, hard-coded history so that I can quickly demo native session behavior without depending on any existing session data.

#### Acceptance Criteria

1. THE system SHALL expose a command (e.g. `github.copilot.cli.sessions.createSampleNative`) that creates a new Copilot CLI session without requiring a selected source session.
2. WHEN this command is executed, THE system SHALL call `ICopilotCLISessionService.createSession(...)` to obtain a fresh `CopilotCLISession` wrapper and SHALL NOT read or mutate any existing session state.
3. AFTER the session is created, THE system SHALL seed it with at least one user message and one assistant message using `addUserMessage(...)` and `addUserAssistantMessage(...)`, using simple, hard-coded text that explains the demo.
4. AFTER seeding, THE system SHALL assign a distinct, human-readable label to the session (e.g. `Sample CLI session · <shortId>`) via `CopilotCLIChatSessionItemProvider.setCustomLabel(...)` so it is clearly identifiable in the sessions list.
5. AFTER labelling, THE system SHALL refresh the Copilot CLI sessions view and open the new session in the standard CLI chat editor so the pre-made history is immediately visible.

### Requirement 7 – Forked CLI sessions and agent parity (future)

**User Story:** As a Copilot engineer, when I “fork” a CLI session via replay and then continue the conversation, I want the forked CLI session to include the same final assistant response that I saw in the intercepted/agent view (e.g. a code-generation joke), so that the CLI history and the agent view stay in sync.

#### Acceptance Criteria (not yet implemented)

1. THE system SHOULD maintain a mapping between the higher-level agent/Live Request Editor session id and the underlying Copilot CLI session id so that turns can be correlated across both layers.
2. WHEN the agent pipeline produces a final assistant response for a turn that is logically associated with a CLI background session, THE system SHOULD also add that response into the CLI session via `CopilotCLISession.addUserAssistantMessage(...)` (or an equivalent hook), so that it appears in the CLI JSONL event log.
3. WHEN the CLI history replay sample command is used to fork a new CLI session from an existing one, THEN the replayed history SHOULD include any such synchronized agent responses, allowing the user to continue the conversation from the latest visible answer.
4. THESE behaviours SHALL be introduced behind a clearly documented feature flag or experimental path, as they depend on additional cross-session mapping infrastructure that does not exist in the current MVP.

### Requirement 8 – Replay edited prompt into new CLI session from Live Request Editor

**User Story:** As a Copilot engineer, when I have edited a prompt in the Live Request Editor, I want to “fork” that edited prompt (and its final answer) into a new Copilot CLI session so that I can continue the conversation from that state under the native CLI session model, without going through a separate replay chat provider.

#### Acceptance Criteria

1. THE system SHALL expose a command (e.g. `github.copilot.liveRequestEditor.openInCopilotCLI`) that can be invoked from the Live Request Editor UI (for the currently edited request) to create a new Copilot CLI session.
2. WHEN this command is executed for an edited request, THE system SHALL create a new `CopilotCLISession` via `ICopilotCLISessionService.createSession(...)` without mutating the original CLI session (if any).
3. AFTER the CLI session is created, THE system SHALL seed its history by iterating the replay payload (`Raw.ChatMessage[]`) and, for each message:
   - IF the message role is `user`, call `addUserMessage(<rendered text>)` on the CLI session.
   - IF the message role is `assistant` (or any non-user role that produces visible text), call `addUserAssistantMessage(<rendered text>)` on the CLI session.
4. THE rendering of each replay payload message into text SHALL follow the same rules used by the Live Request Editor replay pipeline (e.g. the same logic as `_renderMessageText(...)`), so that what appears in the forked CLI session matches what the user would see in the replay payload view.
5. AFTER seeding, THE system SHALL apply a distinct, human-readable label to the forked CLI session (e.g. `Replay from Live Request Editor · <shortId>`) via `CopilotCLIChatSessionItemProvider.setCustomLabel(...)`, refresh the CLI sessions view, and open the new session in the Copilot CLI chat editor so the user can continue from the forked state.

### Requirement 9 – Diff original vs edited payload for Live Request Editor replay

**User Story:** As a Copilot engineer debugging replay behaviour, I want a quick way to see the exact JSON payload difference between the original request and the edited request used for replay/forking, so that I can inspect what changed at the Raw level without manually copying JSON out of logs.

#### Acceptance Criteria

1. THE system SHALL expose a command (e.g. `github.copilot.liveRequestEditor.showReplayPayloadDiff`) that, given a `LiveRequestReplayKey` or `LiveRequestSessionKey`, opens a VS Code diff editor showing the **original** vs **edited** `Raw.ChatMessage[]` payloads for the current Live Request Editor replay.  
2. WHEN invoked from the Live Request Editor replay row for a given request, THE system SHALL:
   - Use `LiveRequestEditorService` to obtain the current edited payload (the same payload that `buildReplayForRequest(...)` would produce for send/CLI fork), and  
   - Rebuild the original payload from `EditableChatRequest.originalMessages` (or equivalent source of truth), ensuring both sides use the same serialization shape (for example, pretty-printed JSON with stable key ordering).  
3. THE diff view SHALL:
   - Use in-memory, untitled documents (no workspace files),  
   - Label the left side clearly as “Original payload” and the right side as “Edited payload”, and  
   - Use a stable, descriptive title (for example, `Live Request Editor · Payload diff · <shortId>`).  
4. THE Live Request Editor webview replay metadata row SHALL surface a **“Show payload diff”** button adjacent to the existing replay actions (for example, next to “Replay edited prompt in CLI session”), which invokes the diff command for the currently selected request/replay.  
5. THE diff helper SHALL be read-only and SHALL NOT modify the underlying request, replay state, or any Copilot CLI sessions; its sole purpose is observability.  
