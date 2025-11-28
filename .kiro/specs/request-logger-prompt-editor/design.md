# Design Document: Live Chat Request Editor

## Overview

The **Live Chat Request Editor** is a debug-oriented feature in the GitHub Copilot Chat VS Code extension. It surfaces the exact ChatML request that is about to be sent to the LLM, visualized using the **same rendering infrastructure as the Copilot Chat panel**, and makes that request **live-editable** before it is dispatched.

The feature builds on the same underlying request model that the `requestLogger` records, but it is not a separate “log viewer”. Instead, it provides a **prompt inspector and editor embedded in the chat experience**, where each logical prompt section can be collapsed and, on hover, shows an action menu with `Edit` and `Delete` controls styled like the **chat code block hover toolbar** in the panel.

**Goals**

- Show the fully composed request (system prompts, user input, context, tools, etc.) for the **next** chat call in a human-readable, chat-like view.
- Allow developers to **edit or delete individual sections** of that request before it is sent.
- Reuse existing **chat panel visualization** (bubbles, markdown, code blocks, inline hover actions) and **prompt rendering** infrastructure (`@vscode/prompt-tsx`).
- Use the same **request data model** that `requestLogger` logs, so logs and the live editor stay in sync.

**Non-goals**

- Creating a separate UI for editing historical log entries in the Request Logger tree.
- Changing the storage format or retention model of `IRequestLogger`.
- Designing a general-purpose prompt authoring environment; scope is “inspect and tweak what Copilot is about to send”.

## Current Architecture

### Chat Request Pipeline

The current chat pipeline (simplified) looks like:

```
User input in chat panel
   ↓
Conversation / intents layer
   (Conversation, IIntent, IBuildPromptContext)
   ↓
Prompt renderer (PromptRenderer / renderPromptElement)
   - Builds Raw.ChatMessage[] + token counts
   - Uses HTMLTracer + IRequestLogger.addPromptTrace
   ↓
ChatML fetcher (ChatMLFetcher.fetchMany)
   - Creates ChatML request body via IChatEndpoint
   - Logs request via IRequestLogger.logChatRequest
   ↓
LLM endpoint
```

Key components:

- `src/extension/prompt/node/defaultIntentRequestHandler.ts`
  - Orchestrates intent resolution, prompt building, and streaming responses.
  - Holds `Conversation` state and builds `IBuildPromptContext`.
- `src/extension/prompts/node/base/promptRenderer.ts`
  - `PromptRenderer` uses `@vscode/prompt-tsx` to render prompt elements into:
    - `RenderPromptResult`: `messages: Raw.ChatMessage[]`, `tokenCount`, `references`, etc.
    - `HTMLTracer`: rich HTML trace of each rendered section.
  - For internal team members, it calls:

    ```ts
    this.tracer = new HTMLTracer();
    ...
    this._requestLogger.addPromptTrace(this.ctorName!, this.endpoint, result, this.tracer);
    ```

- `src/extension/prompt/node/chatMLFetcher.ts`
  - `ChatMLFetcher.fetchMany` creates the final request body:

    ```ts
    const requestBody = chatEndpoint.createRequestBody({ ...opts, requestId, postOptions });
    const pendingLoggedChatRequest = this._requestLogger.logChatRequest(debugName, chatEndpoint, {
      messages: opts.messages,
      model: chatEndpoint.model,
      ourRequestId,
      location: opts.location,
      body: requestBody,
      ignoreStatefulMarker: opts.ignoreStatefulMarker
    });
    ```

  - Sends the request to the endpoint and logs responses.

- `src/platform/requestLogger/node/requestLogger.ts` and  
  `src/extension/prompt/vscode-node/requestLoggerImpl.ts`
  - Define and implement `IRequestLogger`, `ILoggedRequestInfo`, `ILoggedElementInfo`, and `LoggedRequestKind.ChatML*`.
  - Store:
    - The **same messages and body** that will be sent by `ChatMLFetcher`.
    - Prompt traces contributed by `PromptRenderer` via `addPromptTrace`.

### Chat Panel Visualization

The Copilot Chat UI (conversation panel) lives under `src/extension/conversation` and related `chat` modules. It:

- Renders user and assistant messages as “chat bubbles”.
- Uses shared primitives such as:
  - `CodeBlock` for fenced code sections.
  - Prompt references (from `@vscode/prompt-tsx`) for context snippets.
- Provides **hover toolbars** for inline code and prompt references:
  - E.g., copy, insert, open file actions that appear only on hover.

This is the **visual language** and component set we want to reuse for the Live Chat Request Editor. The editor should feel like “another view inside the chat panel”, not a completely new webview UI.

### Endpoint JSON Model (Request Body)

After `PromptRenderer` produces `RenderPromptResult.messages` (an array of `Raw.ChatMessage`), the concrete JSON body is assembled as follows:

- `ChatMLFetcherImpl.fetchMany` calls:

  ```ts
  const requestBody = chatEndpoint.createRequestBody({
    ...opts,
    requestId: ourRequestId,
    postOptions
  });
  ```

- `ChatEndpoint.createRequestBody` delegates to `createCapiRequestBody` / `createMessagesRequestBody` / `createResponsesRequestBody` depending on the configured API. For the common CAPI/chat-completions path:

  ```ts
  export function createCapiRequestBody(options: ICreateEndpointBodyOptions, model: string, callback?: RawMessageConversionCallback) {
    const request: IEndpointBody = {
      messages: rawMessageToCAPI(options.messages, callback),
      model,
    };
    if (options.postOptions) {
      Object.assign(request, options.postOptions);
    }
    return request;
  }
  ```

- `IEndpointBody` (the JSON payload) includes:
  - `model`
  - `messages: CAPIChatMessage[]` (converted from `Raw.ChatMessage[]`)
  - plus optional fields such as `max_tokens`, `max_output_tokens`, `temperature`, `tools`, `tool_choice`, `prediction`, `reasoning`, `intent`, etc.
- `networkRequest` (`postRequest`) finally sends this as `request.json = body` over HTTP.

Implication for the Live Chat Request Editor:

- The **true source of what gets sent** is `Raw.ChatMessage[]` (`options.messages`) plus `postOptions` (`OptionalChatRequestParams`).
- If we update `EditableChatRequest.messages` and the associated request options before `fetchMany` runs, the JSON body will automatically reflect those edits; we do not need to edit `IEndpointBody` directly.

### Request Logger UI (for reference only)

`src/extension/log/vscode-node/requestLogTree.ts` provides the Copilot Chat debug tree (`copilot-chat` view) that:

- Groups `LoggedInfo` by `CapturingToken` (prompt-level grouping).
- Shows ChatML request entries, tool calls, and prompt traces.
- Exposes export and raw-view commands.

For this feature, the **Request Logger UI** is a reference only:

- We do not extend the tree with an editor.
- Instead, we rely on the **same data model** (`LoggedRequest`, `RenderPromptResult`, `HTMLTracer`) to power the live editor embedded in the chat panel.

## Proposed Architecture

### High-Level Design

We introduce a **Live Chat Request Editor** surface attached to the chat panel that:

- Shows the fully composed request that will be sent for the **next** chat turn.
- Breaks the request into **prompt sections** (system, user, context, tools, history, prediction, etc.).
- Renders these sections using the **same TSX components and styles** as the conversation view.
- Allows sections to be **collapsed/expanded**.
- On hover, shows an inline **section action menu** with `Edit` and `Delete` buttons, styled like the **chat code block hover toolbar** (same visual language as the `ChatCodeBlock` menu).
- Applies edits to an **editable request model** that is used when `ChatMLFetcher` constructs and sends the final request.

RequestLogger stays as an **observer**:

- It continues to log the final request that was actually sent.
- It can also log the **original, unedited** request as a debug entry when the user modifies the prompt before send.

### Active Chat Binding and Multi-Session Support

VS Code can host multiple Copilot chat widgets at once (main chat view, side panel, editor-embedded chat, separate windows). The Live Chat Request Editor must attach to the **correct conversation**:

- Each request the extension sees carries:
  - A `ChatLocation` (panel/editor/terminal/etc.).
  - A `Conversation` with a stable `sessionId` (used in telemetry in `defaultIntentRequestHandler`, e.g. `conversation.sessionId`).
- The editor will:
  - Key `EditableChatRequest` instances by `(sessionId, ChatLocation)`.
  - By default, bind to the conversation associated with the **chat widget that is currently active** (the one whose `ChatRequest` / `ChatContext` triggered prompt building for the pending turn).
  - Maintain an in-memory registry of active `EditableChatRequest` objects per conversation in the current VS Code window only (each window has its own extension host).
- Prompt Inspector UI:
  - Defaults to showing the active conversation (the one for which we most recently built a prompt in that widget).
  - Optionally exposes a small **drop-down selector** listing other open conversations in this window (e.g., by short title or last user prompt), allowing the user to switch the inspector’s target conversation.
  - Does not cross window boundaries; switching between VS Code windows is handled by VS Code itself, and each window will have its own instance of the Prompt Inspector.

Concurrent requests:

- Multiple requests can be in-flight:
  - The editor operates only on the **next outgoing request** for the selected conversation.
  - Once a request has been sent, it becomes immutable and is only observable via `requestLogger`; further edits apply to subsequent turns only.

### Components

#### 1. Editable Chat Request Model

We add an in-memory model that represents the request as the user sees and edits it:

```ts
interface LiveRequestSection {
  id: string;
  kind: 'system' | 'user' | 'assistant' | 'context' | 'tool' | 'history' | 'prediction' | 'other';
  label: string;
  content: string;              // markdown / rich text
  rendered?: RenderedContent;   // optional, reusing Prompt Section Visualizer types
  tokenCount?: number;
  collapsed: boolean;
  editable: boolean;
  deletable: boolean;
  sourceMessageIndex: number;   // index in Raw.ChatMessage[]
}

interface EditableChatRequest {
  id: string;
  debugName: string;
  model: string;
  location: ChatLocation;
  messages: Raw.ChatMessage[];        // kept in sync with sections
  sections: LiveRequestSection[];
  originalMessages: Raw.ChatMessage[]; // for reset / diff
  metadata: {
    maxPromptTokens?: number;
    maxResponseTokens?: number;
    intent?: string;
    endpointUrl?: string;
  };
}
```

Key properties:

- `messages` is the **authoritative** structure used by `ChatMLFetcher`.
- `sections` is a **projection** used for visualization and editing.
- `originalMessages` allows reset and debugging (and matches what `requestLogger` would see).

#### 2. Live Request Builder / Adapter

We add a builder on the prompt side that:

- Consumes `RenderPromptResult` from `PromptRenderer` (messages, tokenCount, metadata, references).
- Optionally uses `HTMLTracer` segments from `addPromptTrace` for richer, section-level boundaries.
- Produces an `EditableChatRequest`:
  - Infers section kinds from message roles, metadata, and references.
  - Maps context snippets and tool-related parts into distinct sections where useful.

This builder lives close to `renderPromptElement` / `PromptRenderer` so it sees the same data as the Request Logger.

#### 3. Chat Panel Prompt Inspector UI

We extend the chat panel UI (in the same TSX/React layer) with a **Prompt Inspector drawer**:

- Entry point:
  - A “Prompt” / “View Prompt” button or icon near the Send button, visible when the live editor feature flag is enabled.
  - Optionally, a per-message control to inspect the prompt that will be used for a specific turn.
- Layout:
  - Appears as a **drawer or tab** attached to the chat input or side of the panel.
  - Renders `EditableChatRequest.sections` as a vertical list:
    - Chat-bubble-like styling for user/system/context, reusing existing components.
    - Collapsible headers with labels and optional token counts.
  - Per-section hover:
    - Shows a small hover toolbar with `Edit` and `Delete` aligned and styled like the chat **code block** hover toolbar (position, background, icon sizing).
- Editing behaviour:
  - `Edit`:
    - Expands the section if collapsed.
    - Switches the section body into an **embedded inline editor component** that visually matches the chat input (multi-line, markdown-friendly text area), but is implemented inside the Prompt Inspector, not by relocating the core chat input control.
    - On change, updates `content` and triggers a mapping back to `messages`.
  - `Delete`:
    - Marks the section as deleted (ghosted or removed with a “Restore” affordance).
    - Excludes the section’s contribution when recomputing `messages`.
  - In both cases, the underlying `EditableChatRequest.messages` is updated so that a subsequent send uses the edited content.

#### 4. Integration with ChatMLFetcher

We modify the request creation path so that:

- When the live editor feature is **disabled**, behaviour is unchanged.
- When enabled:
  - The intents layer requests an `EditableChatRequest` from the Live Request Builder instead of raw `messages`.
  - `ChatMLFetcher.fetchMany` is invoked with the **edited** `messages` from `EditableChatRequest`.
  - RequestLogger logs:
    - The final, edited request as usual via `logChatRequest`.
    - Optionally, a separate `MarkdownContentRequest` entry describing the diff from the original if the prompt was changed (future enhancement).

### UI / UX Considerations

- Sections should visually align with chat bubbles:
  - System / instructions with a different style than user messages.
  - Context snippets clearly labelled (e.g., “Context: file.ts”).
- The hover toolbar should:
  - Use the same icon sizes, spacing, and animation as the **chat code block hover toolbar**.
  - Appear only on hover or keyboard focus to avoid clutter.
- Not all sections need to be editable:
  - User and context sections are editable and deletable by default.
  - System prompts may be read-only in the first iteration, or editable behind a secondary toggle; this is an explicit design decision to be confirmed.
- The inspector must expose:
  - A clear indication when the prompt has unsaved edits vs matches the auto-generated form.
  - A “Reset to default prompt” action that restores `messages` and `sections` to `originalMessages`.

## Data & Control Flow

1. **User composes a message** in the chat panel.
2. **Before send**, the chat pipeline:
   - Uses `PromptRenderer` (via `renderPromptElement`) to create a `RenderPromptResult`.
   - Passes that result into the Live Request Builder to construct an `EditableChatRequest`.
3. The **Prompt Inspector UI**:
   - Receives the `EditableChatRequest` for the pending request.
   - Renders `sections` and allows the user to collapse/expand, edit, or delete them.
4. When the user clicks **Send**:
   - If the inspector is disabled or has no edits, the pipeline uses the original `messages`.
   - If edits are present:
     - The inspector ensures `EditableChatRequest.messages` is up to date with all section changes.
     - The intents layer passes those edited `messages` into `ChatMLFetcher.fetchMany`.
5. `ChatMLFetcher`:
   - Creates the request body from the edited `messages`.
   - Logs the request and response via `IRequestLogger` as today.
6. Optionally, the Live Request Editor:
   - Emits additional debug events/entries noting that the request was manually edited.

## Integration Points

- **Prompt rendering (`PromptRenderer`)**
  - Reuse `RenderPromptResult` and `HTMLTracer` outputs as the basis for sections.
  - Avoid duplicating token counting logic.

- **Chat request building (`defaultIntentRequestHandler`, `ChatMLFetcher`)**
  - Introduce an intermediate `EditableChatRequest` that both the UI and fetcher share.
  - Ensure we do not change the semantics of `ChatMLFetcher` when the feature is off.

- **RequestLogger**
  - Continue logging the actual request as-is (with edited messages).
  - Optionally log original vs edited prompts when modifications occur.

- **Chat panel UI**
  - Add the Prompt Inspector drawer/tab and the “View Prompt” toggle.
  - Reuse existing chat visual components (code blocks, inline hover toolbars).

## Migration / Rollout Strategy

- Add a feature flag/config:
  - `github.copilot.chat.advanced.livePromptEditorEnabled` (name TBD).
- When disabled:
  - No new UI is shown.
  - No changes to `ChatMLFetcher` or request construction.
- When enabled:
  - Prompt Inspector appears in the chat panel.
  - Editable request pipeline is active only for supported chat locations (e.g., main chat, not inline chat in the first iteration).

## Performance / Reliability / Security / UX Considerations

- **Performance**
  - Build `EditableChatRequest` only once per pending request.
  - Lazily compute heavy derived data (e.g., rendered content, per-section token counts) on expand.
  - Avoid blocking the extension host; heavy rendering remains in the chat UI layer.

- **Reliability**
  - If section mapping fails, fall back to a single “Raw prompt” section showing the entire prompt as text.
  - If editing produces an invalid ChatML structure, block send with a clear error and offer reset.

- **Security**
  - All content remains local to the VS Code extension and existing LLM endpoints.
  - The chat panel already runs under a constrained environment; any additional rendering should follow existing sanitization and CSP rules used by the conversation view.

- **UX**
  - Make the feature clearly opt-in (debug/advanced).
  - Provide explicit cues when the user is editing the lower-level prompt, not just the visible chat message.
  - Ensure keyboard users can:
    - Focus sections.
    - Trigger hover menus via keyboard.
    - Edit, delete, restore, and reset without a mouse.

## Risks and Open Questions

- **Risk: Editing system prompts**
  - Allowing edits to core system instructions can make behaviour harder to reason about.
  - Open question: should system sections be read-only by default?

- **Risk: Divergence from logged data**
  - We must ensure that what is shown in the inspector is exactly what is sent (and what `requestLogger` logs).
  - Mitigation: treat `EditableChatRequest.messages` as single source of truth for both UI and fetcher.

- **Risk: Complexity for non-expert users**
  - Exposing low-level prompt structure could confuse non-advanced users.
  - Mitigation: keep behind an advanced flag, and clearly label as a debug/pro prompt inspector.

## Future Enhancements

- Side-by-side diff view: auto-generated vs edited prompt.
- Token breakdown per section with budget indicators.
- Hooks to turn edited sections into reusable prompt templates or prompt files.
- Integration with Prompt Section Visualizer when prompts contain XML-like tags, so sections map 1:1 across tools.
