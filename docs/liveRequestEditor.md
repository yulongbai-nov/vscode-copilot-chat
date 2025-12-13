# Live Chat Request Editor – Architecture Notes

This document explains how the Live Chat Request Editor fits into the existing Copilot Chat pipeline, what the “real” request JSON looks like, how edits flow into it, and how this works when there are multiple chat sessions or panels.

It is aimed at humans working on the feature and complements the more formal specs under `.specs/request-logger-prompt-editor/`.

---

## 1. Where the request JSON comes from

The request that is ultimately sent to the LLM is built in several steps:

1. **Prompt rendering (TSX → Raw messages)**
   - `PromptRenderer` (`src/extension/prompts/node/base/promptRenderer.ts`) produces:
     - `RenderPromptResult.messages: Raw.ChatMessage[]`
     - `tokenCount`, `references`, `HTMLTracer`, etc.
   - These `Raw.ChatMessage[]` already include:
     - System instructions
     - Conversation history (as rendered by `ConversationHistory` / `SummarizedConversationHistory`)
     - Context snippets and prompt references
     - Tool hints / extra messages

2. **ChatML fetcher (Raw messages → endpoint body options)**
   - `ChatMLFetcherImpl.fetchMany` (`src/extension/prompt/node/chatMLFetcher.ts`):
     - Accepts `opts.messages: Raw.ChatMessage[]` and `requestOptions: OptionalChatRequestParams`.
     - Prepares `postOptions` (max tokens, tools, prediction, etc.).
     - Calls:

       ```ts
       const requestBody = chatEndpoint.createRequestBody({
         ...opts,
         requestId: ourRequestId,
         postOptions
       });
       ```

     - Logs the request via:

       ```ts
       this._requestLogger.logChatRequest(debugName, chatEndpoint, {
         messages: opts.messages,
         model: chatEndpoint.model,
         ourRequestId,
         location: opts.location,
         body: requestBody,
         ignoreStatefulMarker: opts.ignoreStatefulMarker
       });
       ```

3. **Endpoint (Raw messages → `IEndpointBody` JSON)**
   - `ChatEndpoint.createRequestBody` (`src/platform/endpoint/node/chatEndpoint.ts`) calls `createCapiRequestBody` (or the Messages/Responses equivalents).
   - `createCapiRequestBody` (`src/platform/networking/common/networking.ts`):

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

   - `IEndpointBody` (what is actually sent) includes:
     - `model`
     - `messages: CAPIChatMessage[]` (converted from `Raw.ChatMessage[]`)
     - plus optional fields from `postOptions` such as:
       - `max_tokens` / `max_output_tokens` / `max_completion_tokens`
       - `temperature`, `top_p`, `n`
       - `tools`, `tool_choice`
       - `prediction`, `reasoning`, `intent`, `state`, `snippy`, etc.
     - For models that reject sampling controls (e.g., `o1`/`o1-mini`, the entire `gpt-5.1*` family including codex/codex-max/mini), the request builder strips `temperature`, `top_p`, and `n` to avoid `invalid_request_body` errors. The metadata view will omit those keys for such models.

4. **Network layer**
   - `networkRequest` / `postRequest` attach headers and send `IEndpointBody` as `request.json`.

**Key point:** the true source of what is sent is **`Raw.ChatMessage[]` + request options**. The JSON `IEndpointBody` is a pure projection of those structures.

---

## 2. How edits can propagate into the real request

Because `IEndpointBody` is derived entirely from `Raw.ChatMessage[]` and `postOptions`, the Live Chat Request Editor only needs to edit these upstream structures:

- Maintain an `EditableChatRequest` object that holds:
  - `messages: Raw.ChatMessage[]` (the authoritative edited messages).
  - Section metadata for the UI (labels, kinds, collapsed state) as a projection.
  - A copy of the original messages to support reset.
- When the user edits or deletes a section:
  - Update the section’s content / flags in the UI model.
  - Rebuild the corresponding slices of `Raw.ChatMessage[]` in `EditableChatRequest.messages`.
- Just before sending:
  - Ensure `ChatMLFetcherImpl.fetchMany` receives `opts.messages` from `EditableChatRequest.messages` (and any edited `requestOptions` as needed).

Once this is in place:

- `createRequestBody` and `rawMessageToCAPI` automatically produce JSON that reflects the edited prompt.
- `IRequestLogger.logChatRequest` logs the edited messages and body without extra work.
- There is no need to manually modify `IEndpointBody` or intercept the JSON on the way out.

---

## 3. Conversation history and request growth

Conversation history does **not** grow without bound in the raw messages:

- History is rendered into prompt elements such as:
  - `ConversationHistory` / `ConversationHistoryWithTools` (`src/extension/prompts/node/panel/conversationHistory.tsx`).
  - `SummarizedConversationHistory` (`src/extension/prompts/node/agent/summarizedConversationHistory.tsx`).
- Notable constraints:
  - `ConversationHistory` wraps history in `TokenLimit max={32768}`, capping history tokens to ~32k.
  - Long-running chats are summarized: older turns can be replaced by a summary message instead of verbatim history.

So as chats evolve:

- The `RenderPromptResult.messages` that the Live Editor sees will contain **recent turns plus summarized/trimmed history**, not an unbounded sequence.
- This makes per-section editing manageable and keeps the resulting JSON within reasonable token budgets.

---

## 4. Multiple chat panels and sessions

VS Code can host multiple Copilot chat widgets:

- Main chat in the panel.
- Chat in the side panel.
- Editor-embedded chat.
- Additional VS Code windows (each with its own extension host).

The existing architecture already distinguishes sessions:

- Every chat turn is associated with a `Conversation` (`src/extension/prompt/common/conversation.ts`) that has a stable `sessionId`.
- The intent handler and fetcher pass along a `ChatLocation` and `Conversation` when building prompts and making requests.

For the Live Chat Request Editor, the recommended design is:

- Key editable state by **(sessionId, ChatLocation)**:
  - One `EditableChatRequest` per active conversation/location pair.
- Prompt Inspector binding:
  - When the inspector is opened from a given chat widget, it defaults to that widget’s conversation.
  - Internally, that means using the same `Conversation` / `sessionId` that the widget uses for the pending turn.
- Optional conversation selector:
  - Within a **single VS Code window**, the inspector may offer a drop-down listing other open conversations (e.g., by short title or last user message).
  - Switching the selection rebuilds the sections from that conversation’s latest `RenderPromptResult`.
  - The selector is window-local; each VS Code window has its own conversations and inspector instance.

Concurrent requests:

- Multiple requests can be in-flight, especially with tool loops or retries.
- The Live Editor only mutates the **next outgoing request** for the selected conversation:
  - Already-sent requests remain immutable and are visible only via the Request Logger.
  - Edits apply to the prompt for the next send, not past turns.

---

## 5. Editing UI options and recommended approach

There are three main options for how the user edits sections of the prompt.

### Option A – Use VS Code editors (text documents)

Mechanics:

- Create a virtual text document (e.g., `copilot-prompt-edit:` URI) with the prompt or a section’s content.
- Let the user edit it in a normal VS Code editor.
- On save or close, read the document content back and update `EditableChatRequest.messages`.

Pros:

- Rich editing experience for free (multi-cursor, search/replace, keybindings).
- Familiar to users.

Cons:

- “Save” implies writing to disk; with a virtual scheme this is not obvious to users and can be confusing (it feels like a file, but isn’t).
- You now have two separate UI surfaces:
  - The chat panel for visualization.
  - A full editor tab for editing, which is heavier.
- Harder to keep tightly visually integrated with the chat panel’s hover controls and layout.

### Option B – Lightweight webview widget

Mechanics:

- Render the prompt inspector in a webview with its own React app + embedded code editor (Monaco or textarea).
- Use `postMessage` to sync edits back into `EditableChatRequest`.

Pros:

- Full control over UI (can exactly mimic chat styling).
- Easy to host multiple small editors per section.

Cons:

- Duplicates a lot of UI and styling that already exists in the chat panel.
- More plumbing (message passing, CSP, security hardening).
- Risk of divergence from the native chat look-and-feel over time.

### Option C – Inline editor inside the chat panel (recommended)

Mechanics:

- Extend the existing chat panel rendering (TSX + prompt-tsx) with a **Prompt Inspector drawer**.
- Each section renders as a chat-like block, with:
  - A header (label, type, token count).
  - A body that can switch between “view” and “edit” mode.
  - A hover toolbar styled like the existing **chat code block hover toolbar** (copy/insert style).
- When the user clicks `Edit`:
  - The section expands (if collapsed).
  - The body becomes a small **embedded inline editor**:
    - Implemented inside the Prompt Inspector (not by moving the core chat input control, which remains at the bottom of the chat view).
    - Visually aligned with the chat input (multi-line, markdown-friendly), but logically separate so there is no confusion about saving to disk.
  - Typing updates `EditableChatRequest.sections` and, on apply, recomputes `EditableChatRequest.messages`.

Pros:

- Stays entirely within the chat surface:
  - No extra top-level editor tabs.
  - Users see what they’re editing in the same visual context where the prompt is rendered.
- Easy to visually match the existing **code block hover toolbar** style.
- Editing remains ephemeral and obviously “part of the prompt,” not a file.
- Lower cognitive overhead: you don’t need to explain where edits are stored.

Cons:

- Less powerful than a full VS Code editor for very large or complex edits.
- Needs some extra UX thought for reusing / mimicking the existing chat input control.

### Recommendation

For the core Live Chat Request Editor feature:

- **Use Option C: an inline editor integrated into the chat panel.**
  - Keep edits local to the Prompt Inspector drawer.
  - Use a minimal multi-line editor (textarea or small Monaco instance) per section.
  - Style the hover toolbar to match the chat code block hover toolbar (icons, spacing, animation).
- Optionally, for advanced scenarios:
  - Add a secondary “Open section in editor…” action that opens a virtual document for that section when users really need a full editor.
  - Treat that as an advanced escape hatch, not the primary workflow.

This keeps the implementation aligned with the chat UX, minimizes surprise around saving, and makes it clear that editing is about **modifying the next request**, not about editing a file on disk.  

---

## 6. Inspecting and configuring sampling options

The Request Inspector already captures the **exact request options** (`temperature`, `top_p`, `n`, tool schema, etc.) that Copilot will send to the LLM. With the new metadata view wiring you can surface these values without digging through `request.json`.

1. Enable the extra outline panes once at the **application scope**:

   ```json
   {
     "github.copilot.chat.promptInspector.extraSections": [
       "requestOptions",
       "rawRequest"
     ],
     "github.copilot.chat.promptInspector.sessionMetadata.fields": [
       "sessionId",
       "requestId",
       "model"
     ]
   }
   ```

   Both settings are application-scoped now, so the choice sticks for every workspace (trusted or not) without per-folder overrides.

2. While a request is pending, open the **Live Request Metadata** tree (View → Chat → Live Request Metadata) and expand the `Request Options` outline. The tree reuses VS Code’s outline viewer, so you can collapse nested JSON and copy any value. You should see the normalized sampling parameters (`temperature`, `top_p`, `n`), max token limits, and tool configuration exactly as they will appear in `request.json`.

3. If you also enable the `rawRequest` outline, you can browse the full payload that is logged to `ccreq:*.request.json` without leaving the chat panel. This is a quick way to spot-check parity against the Request Logger output.

4. To tweak the defaults for agent flows, use the existing Copilot settings such as:

   ```json
   {
     "github.copilot.chat.agent.temperature": 0.15
   }
   ```

   Any overrides you apply through settings (or future Live Request Editor features) will immediately show up in the `Request Options` outline, making it easy to verify that advanced sampling parameters are being honored.
