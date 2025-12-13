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

## Current Implementation Status (May 2024)

- **Feature flag + service plumbing**: `github.copilot.chat.advanced.livePromptEditorEnabled` is live in `package.json`, and the new `ILiveRequestEditorService` / builder produce editable section models keyed by session + location. The service already tracks dirty state, soft-delete, restore, and reset to original messages.
- **Prompt pipeline wiring**: `defaultIntentRequestHandler` now asks the service to prepare the editable request and feeds `getMessagesForSend` back into the `ToolCallingLoop`, so edited sections flow through the existing `ChatMLFetcher`/`IRequestLogger` path with no extra fetch-layer changes.
- **VS Code contribution scaffolding**: the `LiveRequestEditorProvider` is registered as an experimental `webviewView`, commands exist for “show/toggle/reset”, and the feature remains fully gated behind the advanced flag.
- **Still pending**: the Prompt Inspector drawer UI that lives inside the chat panel (section list, hover toolbar, inline editors, conversation selector, reset affordance) along with UX that blocks send when all sections are removed, dirty indicators, telemetry, and accessibility polish. These map directly to Tasks 4.x–7.x in the plan.

### Session-alignment diagnostics in the native chat panel

Users still need a fast way to confirm that the intercepted prompt belongs to the conversation they are staring at, especially when multiple turns or subagents are firing in parallel. Instead of relying on VS Code’s experimental chat status API, we now surface the diagnostics via a tree view that lives beside the chat panel:

- Configuration still lives under `github.copilot.chat.promptInspector.sessionMetadata.fields` (ordered string array, default `["sessionId", "requestId"]`). When the array is empty we hide the metadata section while keeping the token budget entry available for quick status checks.
- The `github.copilot.liveRequestMetadata` **tree view** replaces the old webview footer. Users dock it underneath the chat input (Work Bench “Chat” container) so it stays visible while stepping through intercepted prompts.
- Metadata rows render as tree leaves with truncated labels, tooltips, and built-in copy commands. Advanced fields (`model`, `location`, `interception`, `dirty`) reuse the same component so we get consistent behavior across UI surfaces.
- A toolbar-level “Configure metadata” command (`github.copilot.liveRequestMetadata.configureFields`) opens a Quick Pick that writes directly to `sessionMetadata.fields`, letting users curate the view without editing JSON.
- Token awareness: the view exposes a “Token Budget” node that mirrors the inspector’s progress bar (% plus counts) when both `tokenCount` and `maxPromptTokens` are available, and falls back to “awaiting data” otherwise.
- Outline surfaces: when users enable the `requestOptions` / `rawRequest` entries under `github.copilot.chat.promptInspector.extraSections`, the metadata view adds collapsible tree nodes that render those payloads with an outline-style hierarchy (objects → properties, arrays → indexed entries). Each child inherits copy support and truncation so browsing large JSON blobs remains manageable.
- The tree subscribes to `ILiveRequestEditorService.onDidChangeMetadata` and recomputes its nodes synchronously, which keeps the metadata view in lockstep with whichever conversation is currently pending in the editor.
- Empty state: when there is no metadata (idle app, interception disabled), the root node switches to “Live Request Editor idle — send a chat request to populate metadata.” ensuring the view doesn’t look broken.
- Feature gate: the metadata view is only registered/visible when `github.copilot.chat.advanced.livePromptEditorEnabled` is `true`, keeping the extra UI confined to advanced workflows.
- Configuration scope: both `github.copilot.chat.promptInspector.sessionMetadata.fields` and `.extraSections` are marked as **application-scoped** so users can trust/toggle the metadata UI once and have the preference follow every workspace, even when a folder is marked untrusted.

### Auto-apply prefix edits (streamlined Auto Override)

We simplify the Auto Override UX to reduce mode juggling:

- **Modes (user-facing labels)**
  - “Send normally” (`off`), “Pause & review every turn” (`interceptAlways`), “Auto-apply saved edits” (`autoOverride`). A separate one-shot action “Pause next turn” replaces the `interceptOnce` label in the UI.
  - A single `LiveRequestEditorMode` enum remains (`off`, `interceptOnce`, `interceptAlways`, `autoOverride`), but all UI strings use the simplified labels above.
- **Auto-apply states**
  - `autoOverride` has two user-visible states: **Capturing** (no saved edits yet; next turn will pause and show the first `previewLimit` sections) and **Applying** (saved edits exist; turns send automatically with prefixes overlaid).
  - Capturing auto-pauses the next turn; Applying never pauses unless the user explicitly triggers “Pause next turn” or “Capture new edits.”
- **Banner and actions**
  - Banner title: `Auto-apply edits · <scope>`. Subtitle shows `Applying (saved <timestamp>)` or `Capturing next turn · showing first N sections`.
  - Primary button: **Capture new edits** (arms capture; after resume saves and returns to Applying).
  - Secondary menu (kebab or grouped buttons): `Pause next turn` (one-shot intercept without changing mode), `Remove saved edits` (clears overrides and re-arms capture), `Where to save edits` (Session/Workspace/Global), `Sections to capture` (preview limit).
  - Hide redundant buttons when already capturing (e.g., no “Pause next turn” while a capture is armed).
- **Persistence & application**
  - Edited sections remain serialized as `{ scope, sectionId, content, updatedAt }` in session/workspace/global storage. Clearing removes the stored payload and re-enables Capturing for the next turn when in Auto-apply.
  - Scope defaults to Session until the user picks otherwise; selection is persisted in `github.copilot.chat.liveRequestEditor.autoOverride.scopePreference`.
- **Diff affordances**
  - Override chips remain (“Edited · Show diff”), invoking `vscode.diff` with scope/timestamp in the title.
- **Settings / commands**
  - Settings stay the same (`…autoOverride.enabled`, `…previewLimit`, `…scopePreference`), but Quick Picks and commands adopt the new labels:
    - Mode picker: Send normally / Pause & review every turn / Auto-apply edits.
    - Banner menu entries mirror the secondary menu above.
- **Telemetry**
  - Continue logging mode changes, auto-apply capture/apply transitions, saved/cleared overrides, diff launches, and scope changes, tagged with scope and previewLimit (never user content).

### Interim Webview Prompt Inspector (Existing Implementation Surface)

Until the drawer experience lands inside the chat conversation surface, we rely on a dedicated `webviewView` contribution (`github.copilot.liveRequestEditor`). The design intent for this interim UI is:

- **Layout**
  - Header shows feature title, dirty badge, reset button, and a conversation/session summary (model, location, request id).
  - Metadata strip (model, token count, section count, timestamp) is part of a **sticky status banner** that remains docked to the top while the user scrolls through sections; the section list scrolls underneath it.
  - Section list renders vertically, each wrapped in a bordered card that mimics chat bubbles while still looking like a dev tool.
- **Entry point & iconography**
  - The chat panel’s view tab for the Live Request Editor now uses `assets/live-request-editor.svg`, giving it a recognizable glyph next to Prompt Section Visualizer while remaining co-located with other chat debugging tools.
- **Section chrome**
  - Collapsible header with caret, kind badge, label, optional token count, and hover toolbar.
  - Hover toolbar mirrors the chat code-block mini toolbar: icon-only buttons for `Edit`, `Delete`, `Restore`, with tooltips and keyboard focus affordances.
  - Additional **Stick** action pins a section to the top (beneath the status banner) until unstuck; pinned sections keep their order relative to each other and display a “Pinned” indicator.
  - Pinned sections are draggable so users can reorder them relative to other pinned sections without affecting the unpinned list.
  - Deleted sections get a dashed border + reduced opacity and expose a single `Restore` button inline.
  - Tool sections include a metadata strip that surfaces the tool name (or ID) and the JSON arguments passed to the invocation so advanced users can audit exactly what inputs were provided. Arguments reuse the markdown/code styling but are rendered in a monospace block for readability.
- **Editing flow**
  - `Edit` switches the section body into an **advanced “Raw structure” editor** (per-message card):
    - The card body swaps from markdown preview to a nested, foldable view of the underlying `Raw.ChatMessage` (keys as headers, values as leaves).
    - Only **leaf values** are editable (strings/numbers/booleans/null). Object/array values are groups with expand/collapse.
    - There is no aggregate “replace the entire message text” editor in the primary UX; text is edited via the concrete leaf fields (`content[i].text`, `toolCalls[i].function.arguments`, `name`, `toolCallId`, etc.). This preserves the original `content[]`/`toolCalls[]` structure.
  - Editing affordances are **mode-aware**:
    - In “Send normally”, sections are preview-only (no `Edit`).
    - In “Pause & review” / “Auto-apply (Capturing)”, `Edit` is available.
  - `Delete` soft-deletes the section (marks `section.deleted = true`). Subsequent sends omit the message until restored.
  - `Reset` issues `resetRequest` to restore original messages/sections and clears the dirty badge. Confirmation can be implicit (no modal) because reset is undoable by editing again.
  - `Stick` toggles a `section.pinned` flag exposed via `updateSectionPinState`; pinned sections float to the top group, and pressing the button again “unsticks” them, returning them to their natural order.
- **Token visibility / occupancy**
  - The status banner shows overall token usage (absolute count plus percentage of model budget when available).
  - Each section displays its token count and visualizes its share of the total prompt budget with a mini progress meter (e.g., “42 tokens · 8%” plus a bar).
  - Pinned section heading summarizes the cumulative token share of the pinned subset so users can gauge how much budget is locked.
- **Conversation targeting**
  - A conversation drop-down is always available (never greyed out) and sorted by recency, with labels of the form `<location> · <debug name or intent> · …<sessionId tail>` so users can disambiguate concurrent panel/editor/terminal sessions.
  - The editor maintains a single **active session** selection that the dropdown reflects.
  - A single “Auto-follow latest” toggle controls whether newly intercepted requests can change the active session:
    - Auto-follow OFF: new requests update the session list but do not steal focus from the user’s selection.
    - Auto-follow ON: the newest intercepted request becomes active; the editor frame flashes briefly to make the context switch explicit.
  - The Live Request Payload view (raw `messages[]` JSON) stays in sync with the same active session selection.
- **Advanced extras (opt-in)**
  - Some users need insight into the full HTTP payload (tool schemas, requestOptions, telemetry) that would otherwise clutter the default UI.
  - Request options and telemetry remain optional “extra” surfaces.
  - Raw `messages[]` is exposed via a dedicated, draggable **Live Request Payload** view (`github.copilot.liveRequestPayload`) that supports select+copy and open-in-editor.
- **Empty/error states**
  - When no editable request exists, show a centered “Waiting for chat request” message with instructions (“Send a prompt with the feature flag enabled…”).
  - When the service is disabled via settings, the view collapses to a short explanation plus a settings gear link.
- **Accessibility**
  - Header buttons and section actions must be keyboard focusable (`tabindex=0`, `role=button`).
  - Collapse/expand uses `aria-expanded` on the header button; deleted sections announce “deleted”.
  - Dirty badge needs `aria-live="polite"` update when it toggles on/off.

This interim design keeps parity with the backend model and lets early adopters validate editing semantics before the full chat-panel drawer ships. The drawer implementation should inherit these interaction contracts to avoid two divergent Prompt Inspector behaviours.

### Updated UI Deployment Strategy (Feb 2025)

As of today, the VS Code chat panel does not expose extensibility points that would let Copilot Chat embed a custom drawer directly inside the native chat surface. Shipping the prompt inspector “in-panel” therefore requires coordinated work in the core VS Code repository before any code in this repo can attach React/TSX components to the chat input. Until that host support exists, we will continue to invest in the webview-based Prompt Inspector described above, treating it as the primary user experience. All new 4.x tasks now target the webview implementation while mirroring the desired drawer interactions (hover toolbar, inline editors, metadata, conversation picker). Once VS Code surfaces the necessary APIs, we can port the matured webview components into the native drawer with minimal behavioural drift.

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
  // Hierarchical projection metadata (see below)
  parentId?: string;            // undefined for top-level message nodes
  nodeType?: 'message' | 'contentPart' | 'toolCall' | 'metadata';
  contentIndex?: number;        // index into Raw.ChatMessage.content[] for contentPart nodes
  toolCallIndex?: number;       // index into Raw.ChatMessage.toolCalls[] for toolCall nodes
  rawPath?: string;             // human-readable path, e.g. "messages[3].content[1]" or "messages[4].toolCalls[0]"
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
- `sections` is a **projection** used for visualization and editing:
  - Each top-level `section` with `nodeType === 'message'` corresponds 1:1 to a `Raw.ChatMessage` entry.
  - Child sections (`nodeType === 'contentPart' | 'toolCall' | 'metadata'`) represent nested structure within that message and carry direct indices (`contentIndex`, `toolCallIndex`) back into the Raw payload.
- `originalMessages` allows reset and debugging (and matches what `requestLogger` would see).

#### 2. Live Request Builder / Adapter

We add a builder on the prompt side that:

- Consumes `RenderPromptResult` from `PromptRenderer` (messages, tokenCount, metadata, references).
- Optionally uses `HTMLTracer` segments from `addPromptTrace` for richer, section-level boundaries.
- Produces an `EditableChatRequest`:
  - Infers section kinds from message roles, metadata, and references.
  - Maps context snippets and tool-related parts into distinct sections where useful.

This builder lives close to `renderPromptElement` / `PromptRenderer` so it sees the same data as the Request Logger.

#### 3. Hierarchical Message / Content / ToolCall View

To better reflect the structure of the underlying payload and make it easier to reason about complex prompts, the Live Request Editor presents a **hierarchical view** of each request:

- Root level:
  - One `LiveRequestSection` per `Raw.ChatMessage` (`nodeType === 'message'`).
  - `kind` reflects the semantic role (`system`, `user`, `assistant`, `tool`, `context`, etc.).
  - These render as **big “message cards”** in the UI.
- Nested level – content parts:
  - For each message, the builder synthesizes child sections for individual `content` entries:

    ```ts
    {
      id: `${parent.id}/content/${index}`,
      nodeType: 'contentPart',
      parentId: parent.id,
      sourceMessageIndex: messageIndex,
      contentIndex: index,
      kind: inferKindFromContentPart(part), // 'text' | 'image' | 'opaque' | 'cacheBreakpoint' | 'other'
      label: `Content #${index + 1}`,
      content: renderSingleContentPart(part),
      editable: isTextPart(part),
      deletable: false,
      metadata: {
        contentKind: describePartType(part.type)
      },
      rawPath: `messages[${messageIndex}].content[${index}]`
    }
    ```

  - These appear as **nested smaller boxes** inside the parent message card, visually grouping text, image, and opaque payloads.
- Nested level – tool calls:
  - Assistant messages with `toolCalls` get one child section per call:

    ```ts
    {
      id: `${parent.id}/toolCall/${toolIndex}`,
      nodeType: 'toolCall',
      parentId: parent.id,
      sourceMessageIndex: messageIndex,
      toolCallIndex: toolIndex,
      kind: 'tool',
      label: `Tool call · ${call.function?.name ?? call.id}`,
      editable: false, // first iteration: display-only
      deletable: false,
      metadata: {
        toolInvocation: {
          id: call.id,
          name: call.function?.name,
          arguments: extractToolArguments(call.function?.arguments)
        }
      },
      rawPath: `messages[${messageIndex}].toolCalls[${toolIndex}]`
    }
    ```

  - In the UI, these render as nested boxes labelled with tool name + id, with arguments shown in a monospace block.

Editing behaviour in the hierarchical view (current design):

- Edits are **leaf-level**:
  - Primary edit affordances live on individual fields (for example, `messages[i].content[j].text`, `messages[i].toolCalls[k].function.arguments`, `messages[i].name`, `requestOptions.temperature`).
  - The inline editor for a leaf operates on exactly one Raw field; saving creates a single `EditOp` targeting that field.
  - Changes are applied via the per‑leaf `EditOp` model described in “Editing Model and Undo/Redo (Per‑Leaf, 1:1 with Raw Payload),” preserving all other content parts and message‑level metadata.
- Message nodes act as **structural group headers**:
  - The big assistant/system/user/tool cards group their child nodes (content parts, tool calls, metadata, request options).
  - Child nodes render as nested, foldable boxes labelled with their Raw keys (for example, `role`, `name`, `content[1].text`, `toolCalls[0].function.arguments`), making the mapping to the underlying JSON explicit.

This design ensures:

- The Live Request Editor respects the natural hierarchy of the Raw payload (messages → fields → content[] / toolCalls[] → nested objects).
- The viewmodel reuses Raw indices and stable keys (`sourceMessageIndex`, `contentIndex`, `toolCallIndex`, `rawPath`) rather than inventing a parallel structure.
- Every edit is 1:1 with a concrete Raw field; there is no aggregate “message text” editor in the primary UX.

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
    - Switches the section body into the same **advanced “Raw structure” editor** described above:
      - Keys render as headers; only leaf values are editable.
      - Each save applies a single leaf-level mutation (1:1 with a Raw payload field) and records an edit op suitable for undo/redo.
  - `Delete`:
    - Marks the section as deleted (ghosted or removed with a “Restore” affordance).
    - Excludes the section’s contribution when recomputing `messages`.
  - In both cases, the underlying `EditableChatRequest.messages` is updated so that a subsequent send uses the edited content.

#### 4. Integration with ChatMLFetcher

We modify the request creation path so that:

- When the live editor feature is **disabled**, behaviour is unchanged.

### Prompt Interception Mode

To support manual review of every request, we now ship an optional **Prompt Interception Mode** that pauses sends until the user explicitly resumes:

- **Mode toggle & telemetry**
  - Exposed as a command (`github.copilot.liveRequestEditor.toggleInterception`) plus a right-side status bar entry that flips the persisted `github.copilot.chat.advanced.livePromptEditorInterception` setting.
  - When enabled, subsequent chat sends are intercepted before `ChatMLFetcher.fetchMany` executes. Disabling the mode immediately cancels any pending turn.
  - We log every toggle and outcome (resume / cancel / mode disabled) via `liveRequestEditor.promptInterception.*` telemetry, tagged by chat location.

- **Send interception flow**
  1. User hits the normal chat `Send`.
  2. `defaultIntentRequestHandler` builds the editable request as usual but **does not** call the fetcher.
  3. The handler records a “pending turn” (request + completion resolver) inside `LiveRequestEditorService` and keeps the chat panel spinner in a pending state.
  4. The Live Request Editor webview receives the interception state, focuses if needed, and highlights the banner so users know action is required.

- **Live Request Editor UX**
  - The sticky banner explains that the request is paused and exposes **“Resume Send”** and **“Cancel”** buttons. While idle (no pending turn) the banner still reminds the user that prompts will pause before sending.
  - The normal edit/delete actions stay available; edits update the pending request in the same service model so “Resume Send” always forwards the latest edits.
  - When the user presses **Resume Send**, the webview posts `resumeSend`. The handler marks the pending request as “approved” and continues with the fetcher using the latest `EditableChatRequest.messages`.
  - Pressing **Cancel**, switching conversations, or sending a new prompt resolves the pending turn and the chat panel surfaces a benign “Request canceled before sending” message.

- **Status bar & command palette**
  - While interception is active, a status bar item shows `Prompt Interception: On` (or `On (request paused)` with a warning icon). Clicking it when idle toggles the mode; clicking while a request is paused focuses the editor.
  - Command palette entries (`toggle`, `show`, `reset`) remain the quick entry points.

- **Edge cases**
  - If the user closes the editor or hides the view, intercept mode still blocks sends; the next send reopens/focuses the view automatically.
  - Multiple conversations are handled by session/location keys so only the active conversation’s request is paused.
  - Long-idle pending sends can be canceled by toggling the mode off, which resolves the deferred promise with a “modeDisabled” reason.

Architecturally this added:

- A `PendingIntercept` entry in `ILiveRequestEditorService` keyed by session that stores the promise resolvers plus metadata for telemetry/status UI.
- New webview messages (`resumeSend`, `cancelIntercept`) and interception state in the React front-end.
- Status bar contribution tied to the interception setting and pending state.
- When enabled, `ToolCallingLoop` asks the service to await interception approval; `ChatMLFetcher.fetchMany` is only invoked after **edited** `EditableChatRequest.messages` are approved so the Request Logger continues to record exactly what was sent.

#### Context-change cleanup

Interceptions must also unwind automatically when the underlying session becomes invalid (e.g., user opens a new chat, switches the model picker, or VS Code disposes the session). The service now:

- Subscribes to `IChatSessionService.onDidDisposeChatSession` and removes any cached requests for that session, firing a new `onDidRemoveRequest` event consumed by the webview provider to drop stale session cards.
- Resolves any matching `PendingIntercept` entries with `action: 'cancel'` plus a `sessionDisposed` reason so both the chat pipeline and status bar clear without manual intervention.
- Surfaces a human-readable banner message (“Context changed – request discarded”) when this happens, matching the new telemetry reason so diagnostics can distinguish user-initiated cancelations from automatic cleanup.
- Treats “model changed” as a session reset because the VS Code chat host spins up a fresh session when the picker value changes; if future host changes deliver an explicit “model changed” event we can map it to the same cleanup helper.
- Requests flagged as `isSubagent` (Plan/TODO sub-agents, runSubagent tool invocations) bypass interception entirely so automation does not stall waiting for user approval. The default intent handler short-circuits `interceptMessages`, and the service's `waitForInterceptionApproval` immediately returns for these requests so future entry points cannot accidentally pause automation. These requests still render in the editor for observability but proceed immediately through the fetcher.

## Surgical Payload Editing Viewmodel (Legacy Aggregate‑Text Model)

> **Status:** Historical only. The aggregate‑text (`SectionTextMap`/`SectionEditOp`) model described in earlier drafts has been superseded by the per‑leaf `EditOp` model in “Editing Model and Undo/Redo (Per‑Leaf, 1:1 with Raw Payload)” below and is no longer used by the Live Request Editor UI.

Earlier iterations treated each section’s text as a single “aggregate” string and redistributed edits back into multiple `Text` parts via a `SectionTextMap`. This preserved non‑text parts but made it hard to reason about where edits landed in the Raw payload and conflicted with the requirement for **1:1, leaf‑level fidelity**.

The current design instead:

- Treats each editable field (for example, `messages[i].content[j].text`, `messages[i].toolCalls[k].function.arguments`, `messages[i].name`, `requestOptions.temperature`) as a **single leaf** in the Raw JSON tree.
- Records edits as explicit `EditOp` entries keyed by a human‑readable `targetPath`.
- Rebuilds only the affected `LiveRequestSection` from the updated Raw payload, without any aggregate text redistribution.

Any remaining references to `SectionTextMap` in the codebase should be considered legacy compatibility helpers (primarily for auto‑apply overrides) and candidates for future removal once all flows are migrated to the leaf‑level editing APIs.

### Subagent Prompt Monitor

Automated subagent flows (Plan’s TODO tool, `runSubagent`, background task runners) now skip interception, but power users still need visibility into what those agents send. Rather than reusing the full Live Request Editor, we add a lightweight **Subagent Prompt Monitor**:

- **Data source**
  - `LiveRequestEditorService` already builds `EditableChatRequest` objects for every turn. When `request.isSubagent` is true, we publish a new `onDidAddSubagentRequest` event with a trimmed payload (session key, debug name, createdAt, sections, model metadata).
  - Requests are still stored internally so token counts and parity checks work, but they are never fed through interception.

- **View implementation**
  - A dedicated `SubagentPromptMonitorProvider` (likely a `TreeDataProvider` backed by the same React bundle or a compact `webviewView`) lives in the right sidebar next to the Request Logger.
  - Root nodes represent recent subagent runs (labelled `Session · intent · hh:mm:ss`), and expanding a node reveals child items for each prompt section (system/user/context/tool) rendered using the existing markdown renderer for consistency.
  - Entries auto-expire after N runs (configurable, default 10) or when their session is disposed; the provider listens to the existing `onDidRemoveRequest` event to prune stale nodes.

- **UX considerations**
  - Read-only: no edit/delete controls; clicking copies content or opens a detail pane.
  - Keyboard accessible tree with context menu actions (“Copy section”, “Reveal in request log”).
  - Matches VS Code theming; uses the same hover toolbar icons for familiarity, but actions simply copy or expand.

- **Telemetry**
  - Emit `liveRequestEditor.subagentMonitor.viewed` when users expand entries, and `liveRequestEditor.subagentMonitor.trimmed` when older entries are dropped, so we can size the backlog appropriately.

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

## Editing Model and Undo/Redo (Per‑Leaf, 1:1 with Raw Payload)

Requirement 15 still requires **surgical fidelity**, but we now express this directly in terms of **per‑field edits** on the Raw payload instead of aggregate message text. The Live Request Editor is a structured, foldable view over the actual request; every edit corresponds to exactly one concrete field in the request JSON.

### Per‑leaf edit operations

We treat each editable leaf as a single field update:

```ts
type EditTargetKind =
  | 'messageField'        // e.g. messages[3].name
  | 'contentText'         // messages[3].content[1].text
  | 'toolArguments'       // messages[4].toolCalls[0].function.arguments
  | 'requestOption';      // requestOptions.temperature, etc.

interface EditOp {
  id: {
    requestId: string;    // EditableChatRequest.id
    version: number;      // monotonic per-request op version
  };
  targetKind: EditTargetKind;
  targetPath: string;     // human-readable JSON path, e.g. "messages[3].content[1].text"
  oldValue: unknown;
  newValue: unknown;
}

interface EditHistory {
  undoStack: EditOp[];
  redoStack: EditOp[];
}

interface EditableChatRequest {
  // existing fields…
  originalMessages: Raw.ChatMessage[];
  messages: Raw.ChatMessage[];
  sections: LiveRequestSection[];

  // per-request edit history (leaf-level)
  editHistory?: EditHistory;
}
```

Examples:

- Editing a single text content part:
  - `targetKind = 'contentText'`
  - `targetPath = "messages[3].content[1].text"`
  - `oldValue = "<previous text>"`, `newValue = "<edited text>"`.
- Editing tool arguments:
  - `targetKind = 'toolArguments'`
  - `targetPath = "messages[4].toolCalls[0].function.arguments"`.
- Editing a scalar field:
  - `targetKind = 'messageField'`
  - `targetPath = "messages[2].name"` or `"messages[5].toolCallId"`.
- Editing a request option:
  - `targetKind = 'requestOption'`
  - `targetPath = "requestOptions.temperature"`.

Undo/redo are expressed by swapping `oldValue` and `newValue` for the targeted field:

```ts
function invertEditOp(op: EditOp): EditOp {
  return {
    ...op,
    oldValue: op.newValue,
    newValue: op.oldValue
  };
}
```

Applying an op:

1. Resolve `targetPath` against the current `EditableChatRequest` (using `messages`, `metadata.requestOptions`, etc.).
2. Assign `newValue` to that field.
3. Rebuild only the affected `LiveRequestSection`’s `content`/`message` projection so the UI stays in sync.

Undo pops from `undoStack`, applies the inverted op, and pushes the original op to `redoStack`; redo does the reverse.

### How the tree-like UI maps to Raw

- Every **big message card** still corresponds 1:1 to a `Raw.ChatMessage` (`sections[i]` with `sourceMessageIndex`).
- Within that card, the editor renders a **tree of keys and values**:
  - Keys: `role`, `name`, `toolCallId`, `content[0].text`, `content[1].imageUrl.url`, `toolCalls[0].function.arguments`, etc.
  - Values:
    - If the value is a **leaf** (string/number/boolean/null), it is editable (text field/textarea).
    - If the value is **object/array**, it becomes a foldable/expandable child group whose children are further key/value nodes.
- All edits in the UI are leaf-level:
  - Editing `content[0].text` → one `EditOp` targeting `"messages[i].content[0].text"`.
  - Editing `toolCalls[0].function.arguments` → one `EditOp` targeting `"messages[i].toolCalls[0].function.arguments"`.
- There is no aggregate “message text” editor in the primary UX; assistant and system messages show grouped child `text` boxes instead.

#### Display paths vs stable targets (deletions and indices)

The editor distinguishes between:

- **Display `rawPath`**: what the user sees (e.g. `messages[2].content[1].text`). This uses the **current payload index** (0-based) as shown in the Live Request Payload view, so indices remain aligned after deletions.
- **Stable edit target**: what the extension host uses to apply and record edits (e.g. by `section.id` / `sourceMessageIndex` plus a relative leaf path like `content[1].text`). This keeps undo/redo and subsequent edits stable even when the visible payload indices shift due to deletions.

### Relation to previous aggregate-text model

An earlier iteration of this design proposed a `SectionTextMap`/`SectionEditOp` model that treated a whole message’s text as a single aggregate string and redistributed edits across multiple `Text` parts. That model is now considered **legacy** and is **not** used by the Live Request Editor UI:

- The current UX operates purely on **per-leaf fields** that map 1:1 to the Raw payload.
- Any internal use of aggregate-text helpers is limited to non-UX features such as Auto-Apply overrides and may be removed in the future.

Downstream consumers (ChatML fetcher, Request Logger, replay, CLI fork) still see only recomposed `Raw.ChatMessage[]`. The leaf-level edit model guarantees that:

- Only the explicitly edited field changes.
- All non-edited fields, including non-text `ChatCompletionContentPart` entries and message-level metadata, are preserved.

## Chat Timeline Replay (Future Scope)

See `.specs/chat-timeline-replay` for the detailed design/requirements/tasks of the replay concept (display-only chat projection of edited prompts).

## Chat History Persistence (Future Scope)

See `.specs/chat-history-persistence` for the detailed design/requirements/tasks of the SQLite persistence concept (opt-in local history store).

## Graphiti Memory Layer Integration (Future Scope)

See `.specs/graphiti-memory-integration` for the detailed design/requirements/tasks of the optional Graphiti ingestion concept (feature-gated network sync).

## UI Simplification Opportunities (Forward-Looking)

- Lean on replay/fork as the primary “advanced” affordance: keep replay display-only by default with an explicit “Start chatting from this replay” to avoid branching confusion.
- Keep interception/auto-override UI minimal: a single “Pause & review” toggle plus an “Auto-apply edits” entry; avoid mode sprawl.
- Prefer banner actions over nested menus; reserve hover toolbars for section-level edits only.
- When replay is available, consider demoting inline diff/restore affordances in the main view to reduce clutter (surface them as hover/secondary actions).

## Future Enhancements

- Side-by-side diff view: auto-generated vs edited prompt.
- Token breakdown per section with budget indicators.
- Hooks to turn edited sections into reusable prompt templates or prompt files.
- Integration with Prompt Section Visualizer when prompts contain XML-like tags, so sections map 1:1 across tools.
