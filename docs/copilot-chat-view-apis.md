# Copilot Chat View APIs – VS Code Core vs Extension

This document summarizes how the Copilot Chat extension integrates with the VS Code chat view, and which **stock (stable) APIs** vs **proposed APIs** are involved.

It is written from the perspective of this repo (the Copilot Chat extension), not VS Code core.

---

## 1. Stock VS Code Chat APIs (core)

### 1.1 Stable `vscode.chat` surface

Core chat concepts live in `src/extension/vscode.d.ts`:

- `ChatParticipant`
- `ChatRequest`
- `ChatResponseStream`
- `ChatResult`, `ChatResultFeedback`
- `ChatContext` (per‑participant, per‑session history)
- `ChatRequestHandler`

In this repo:

- We create participants via `vscode.chat.createChatParticipant(id, handler)` and implement the handler using `ChatParticipantRequestHandler`:
  - `src/extension/prompt/node/chatParticipantRequestHandler.ts`
- Core uses `ChatContext.history` to provide prior turns for that participant.

Limits of the stable surface (for our purposes):

- You cannot:
  - Directly create or fork the **default Copilot chat session** with arbitrary history.
  - Attach a custom `ChatSession` object to the built‑in session.
- You can:
  - Register your own participants.
  - Receive the per‑participant history through `ChatContext.history`.
  - Open/focus the chat view via commands (see below).

### 1.2 Built‑in chat commands we call

The extension uses several built‑in VS Code commands that control the chat view:

- `workbench.action.chat.open`
  - Opens the chat view, optionally with `{ query, isPartialQuery, mode }`.
  - Used to start or steer chat from other flows:
    - `src/extension/conversation/vscode-node/conversationFeature.ts`
    - `src/extension/intents/node/testIntent/setupTestsFrameworkQueryInvocation.tsx`

- `workbench.action.chat.openAsk`, `workbench.action.chat.openEdit`, `workbench.action.chat.openAgent`
  - Mode‑specific open commands documented in `CHANGELOG.md`.
  - Not directly invoked from this repo, but part of the stock command surface we can reference in docs and links.

- `workbench.panel.chat.view.copilot.focus`
  - Focuses the Copilot chat view.
  - Used when toggling between Prompt Inspector and chat, or when activating replay:
    - `src/extension/prompt/vscode-node/liveRequestEditorContribution.ts`
    - `src/extension/prompt/vscode-node/liveReplayChatProvider.ts`
    - `src/extension/replay/vscode-node/replayDebugSession.ts`

- `workbench.action.chat.openNewSessionEditor.<sessionType>`
  - Used for **custom session types** contributed by extensions (e.g. Claude, CLI, Cloud).
  - Example usage:
    - `src/extension/chatSessions/vscode-node/claudeChatSessionParticipant.ts` calls `workbench.action.chat.openNewSessionEditor.claude-code`.
  - CLI and Cloud session links in `package.nls.json` refer to `workbench.action.chat.openNewSessionEditor.copilotcli` and `.copilot-cloud-agent`.

Important: none of these commands let us **inject arbitrary history** into the default Copilot chat session; they only open/focus the view or create new sessions for types that VS Code core knows how to create.

---

## 2. Proposed Chat Session APIs (`chatSessionsProvider@3`)

VS Code’s proposed “chat sessions” API is vendored at:

- `src/extension/vscode.proposed.chatSessionsProvider.d.ts`

Key types:

- `ChatSessionItemProvider`
  - Lists chat sessions for a given session type.
  - Optional:
    - `onDidCommitChatSessionItem` – signal that one session should be replaced by another.
    - `provideNewChatSessionItem` (deprecated) – create a new session item for **providers we own**.

- `ChatSessionContentProvider`
  - Supplies a `ChatSession` for a URI:
    - `history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn2>`
    - `requestHandler?: ChatRequestHandler` (if undefined, session is read‑only)
    - optional `options`, `activeResponseCallback`

- `ChatSessionProviderOptions`, `ChatSessionProviderOptionGroup`, `ChatSessionProviderOptionItem`
  - Allow a provider to expose **option groups** (e.g. model picker, custom agent selector).
  - Used to render dropdowns in the chat UI for that session type.

- `ChatSessionCapabilities`
  - Provider‑level flags (e.g. `supportsInterruptions`), passed when registering a content provider.

- `vscode.chat.registerChatSessionItemProvider(chatSessionType, provider)`
- `vscode.chat.registerChatSessionContentProvider(scheme, provider, chatParticipant, capabilities?)`

### 2.1 How this repo uses `chatSessionsProvider`

We use this proposed surface to implement **custom chat session types** that appear as tabs in the chat view:

- **Claude sessions**
  - Contribution:
    - `package.json` → `"chatSessions": [{ "type": "claude-code", ... }]`
  - Registration:
    - `src/extension/chatSessions/vscode-node/chatSessions.ts`
      - Registers `ClaudeChatSessionItemProvider` and `ClaudeChatSessionContentProvider`
      - Associates them with the `claude-code` session type and a `ChatParticipant`.

- **Copilot CLI sessions**
  - Contribution:
    - `package.json` → `"chatSessions": [{ "type": "copilotcli", ... }]`
  - Registration:
    - `src/extension/chatSessions/vscode-node/chatSessions.ts`
    - `src/extension/chatSessions/vscode-node/copilotCLIChatSessionsContribution.ts`
  - Uses `provideChatSessionProviderOptions` to expose **model** and **agent** pickers specific to CLI sessions.

- **Copilot Cloud sessions**
  - Contribution:
    - `package.json` → `"chatSessions": [{ "type": "copilot-cloud-agent", ... }]`
  - Registration:
    - `src/extension/chatSessions/vscode-node/chatSessions.ts`
    - `src/extension/chatSessions/vscode-node/copilotCloudSessionsProvider.ts`
  - Uses `provideChatSessionProviderOptions` to surface a **custom agents** picker for cloud sessions.

- **Replay debug sessions (`chat-replay`)**
  - Registration:
    - `src/extension/replay/vscode-node/chatReplayContrib.ts`
    - `src/extension/replay/vscode-node/chatReplaySessionProvider.ts`
  - Uses `ChatSessionContentProvider` to render a **read‑only** session from a replay log file.

- **Live Request Editor replay sessions (`copilot-live-replay`)**
  - Contribution:
    - `package.json` → `"chatSessions": [{ "type": "copilot-live-replay", ... }]`
  - Registration:
    - `src/extension/prompt/vscode-node/liveReplayChatProvider.ts`
  - Uses:
    - `ChatSessionItemProvider` to list replay sessions in the chat sessions view.
    - `ChatSessionContentProvider` to:
      - Render either a projection‑only “summary” view, or
      - A payload view backed by the default agent via `ChatParticipantRequestHandler`.

Crucially, all of these are **session types we own**. We do *not* and cannot use this API to create or modify the **default Copilot chat session** provided by core.

---

## 3. Other chat‑related proposed APIs

This repo also vendors other proposed chat APIs that are adjacent to the chat view but not specific to session creation:

- `src/extension/vscode.proposed.chatProvider.d.ts`
  - `LanguageModelChatProvider`, `LanguageModelChatInformation`, `LanguageModelChatCapabilities`
  - Used to contribute language models and tools behind chat participants.

- `src/extension/vscode.proposed.defaultChatParticipant.d.ts`
  - `ChatWelcomeMessageContent`, `ChatTitleProvider`, `ChatSummarizer`
  - Lets extensions customize how their participants present themselves and summarize conversations.

- `src/extension/vscode.proposed.chatParticipantAdditions.d.ts`, `chatStatusItem`, etc.
  - Smaller additions for status items, extra metadata, and so on.

These shape how Copilot appears and behaves inside the chat view (identity, prompts, status), but they do not change the fundamental limitation: we still cannot programmatically fork the default Copilot chat session with arbitrary history.

---

## 4. Extension‑side integration points for the Copilot chat view

From the extension’s perspective, the Copilot chat view is wired up through:

### 4.1 Contributions in `package.json`

- `chatParticipants`
  - Defines Copilot chat participants (default, edits, editor, etc.).
  - Example: `"id": "github.copilot.default", "isDefault": true` for the panel’s primary participant.

- `chatSessions`
  - Declares custom session types (Claude, CLI, Cloud, Replay) that show up as separate tabs or entries in the sessions view.

- `menus.chat/chatSessions`
  - Adds context menu commands for session items (e.g. refresh, delete, open in browser).

- `commands`
  - Defines extension commands that integrate with the chat view:
    - Live Request Editor commands (toggle, show, replay, start replay chat, toggle replay view).
    - Cloud/CLI session management commands.

### 4.2 Participant / request handling

- `ChatParticipantRequestHandler` (extension‑side orchestration)
  - File: `src/extension/prompt/node/chatParticipantRequestHandler.ts`
  - Wraps the stable `ChatRequestHandler` to:
    - Maintain conversation history and metadata.
    - Run intent detection and tool selection.
    - Drive intents that open chat, editors, or other UI.

- Top‑level chat feature wiring:
  - `src/extension/conversation/vscode-node/conversationFeature.ts`
    - Registers core Copilot chat behavior and calls `workbench.action.chat.open` in response to certain triggers.

### 4.3 Live Request Editor and Replay integration

- Live Request Editor (Prompt Inspector):
  - `src/extension/prompt/vscode-node/liveRequestEditorContribution.ts`
  - Uses:
    - `github.copilot.liveRequestEditor.show` to open the inspector webview.
    - `workbench.panel.chat.view.copilot.focus` to return focus to the chat panel.

- Replay via Live Request Editor:
  - `src/extension/prompt/vscode-node/liveReplayChatProvider.ts`
  - Uses `ChatSessionContentProvider` + a default‑agent `ChatParticipantRequestHandler` to:
    - Render a projection/payload view inside the chat UI.
    - Handle “Start chatting from this replay” **within** a custom `copilot-live-replay` session, not the default Copilot session.

- Replay via request logs (debug):
  - `src/extension/replay/vscode-node/chatReplayContrib.ts`
  - Uses `chat-replay` scheme and a `ChatSessionContentProvider` to show recorded chats as read‑only sessions.

---

## 5. Practical limitations and capabilities

From this extension’s point of view:

- **We can:**
  - Define new participants and tools that appear in the chat view.
  - Define new chat session types (tabs) with custom history, participants, and options.
  - Open/focus the chat view and specific session editors via built‑in commands.
  - Seed history and request handling for **our own** session types via `ChatSessionContentProvider`.

- **We cannot (with the current APIs):**
  - Create or fork the **default Copilot chat session** with arbitrary, extension‑supplied history.
  - Change the core session type or label of the default Copilot chat.
  - Bypass the stock chat UI to inject history into core‑owned sessions.

This is why features like replay are implemented as **custom session types** (`copilot-live-replay`, `chat-replay`) that can show history inside the native chat UI, rather than true forks of the default Copilot session itself.

---

## 6. Replay → native Copilot handoff constraints

This section is the normative reference for `docs/replay-native-handoff-investigation.md`.

### 6.1 What replay does today

- Live Request Editor replay uses a **custom session type**:
  - Scheme: `copilot-live-replay` (URI scheme and chat session type).
  - Provider: `LiveReplayChatProvider` (`src/extension/prompt/vscode-node/liveReplayChatProvider.ts`).
  - Contribution: `"chatSessions": [{ "type": "copilot-live-replay", ... }]` in `package.json`.
- The payload view:
  - Renders history using the **default Copilot agent ID** (via `getChatParticipantIdFromName(defaultAgentName)`).
  - Still lives under the `copilot-live-replay` session type and label in the chat UI.
- “Start chatting from this replay”:
  - Executes `github.copilot.liveRequestEditor.startReplayChat`.
  - That command:
    - Activates the replay session (marks it `forkActive` in `ILiveRequestEditorService`).
    - Calls `vscode.open` on the `copilot-live-replay` URI.
    - Focuses the Copilot chat panel via `workbench.panel.chat.view.copilot.focus`.
  - The session’s `requestHandler` uses `ChatParticipantRequestHandler` with the default agent, but still within the `copilot-live-replay` session.

Net effect: replay **simulates** a Copilot conversation in a custom tab that looks and behaves like a Copilot chat, but it is *not* the core “default Copilot” session.

### 6.2 Why true native handoff is not possible (today)

Given the APIs available in this repo:

- There is **no API or command** that:
  - Creates a new **default Copilot chat session** and
  - Accepts an arbitrary `ChatSession.history` or equivalent injected history.
- The only extension‑visible ways to affect sessions are:
  - `registerChatSessionItemProvider` / `registerChatSessionContentProvider` for **session types we own**.
  - Built‑in commands like:
    - `workbench.action.chat.open` (open chat view, optional query/mode).
    - `workbench.panel.chat.view.copilot.focus` (focus the Copilot chat panel).
    - `workbench.action.chat.openNewSessionEditor.<sessionType>` (for other contributed session types like `claude-code`, `copilotcli`, `copilot-cloud-agent`).
- We cannot:
  - Address “the default Copilot session” as a `Uri` whose content we control.
  - Call `provideNewChatSessionItem` on a provider we *don’t* own (it is just an optional method on providers, not a global function).

Therefore, a “Start chatting from this replay” button **cannot**:

- Spawn a *core* Copilot chat session that is indistinguishable (in type/label/badging) from a user‑created Copilot session, and
- Seed it with arbitrary replay history from the extension side.

It can only:

- Open the chat view in a particular mode, or
- Open a session whose content we control via a custom provider.

### 6.3 Feasible patterns for replay handoff

Within current APIs, realistic options are:

1. **Custom fork session type (recommended interim)**
   - Define a new `chatSessions` type (e.g. `copilot-live-replay-fork`).
   - Implement `ChatSessionContentProvider` that:
     - Seeds `ChatSession.history` with the replay payload.
     - Uses `ChatParticipantRequestHandler` with the default agent.
     - Optionally exposes provider options (model picker, custom agent picker).
   - Wire “Start chatting from this replay” to:
     - Create a URI for the fork session.
     - Open/focus that session via `vscode.open` / `workbench.action.chat.openNewSessionEditor.<forkType>`.
   - Caveat: still a custom session type, with its own label and (likely) preview badge.

2. **Remain within `copilot-live-replay`**
   - The current implementation:
     - Keeps projection and payload views in one `copilot-live-replay` session.
     - Uses default agent handling internally for the payload view.
   - We can refine:
     - UI labeling (“Forked from …”), breadcrumbs, and telemetry attribution.
   - But we cannot convert this into the *exact* default Copilot session.

Any future “native handoff” must rely on **new** VS Code core or internal Copilot APIs that:

- Either expose a way to create/fork default Copilot sessions with injected history, or
- Accept a “replay payload” through some other supported integration point.
