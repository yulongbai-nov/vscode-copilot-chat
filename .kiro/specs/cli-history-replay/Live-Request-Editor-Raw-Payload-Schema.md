# Live Request Editor Raw Payload Schema & Editing Semantics

  ## 1. Raw payload schema (from @vscode/prompt-tsx)

  Source: node_modules/@vscode/prompt-tsx/dist/base/output/rawTypes.d.ts.

  ### 1.1 Raw.ChatMessage

  export type ChatMessage =
    | AssistantChatMessage
    | SystemChatMessage
    | UserChatMessage
    | ToolChatMessage;

  export enum ChatRole {
    System = 0,
    User = 1,
    Assistant = 2,
    Tool = 3
  }

  export interface BaseChatMessage {
    role: ChatRole;
    content: ChatCompletionContentPart[];
    name?: string;
  }

  export interface SystemChatMessage extends BaseChatMessage {
    role: ChatRole.System;
  }

  export interface UserChatMessage extends BaseChatMessage {
    role: ChatRole.User;
  }

  export interface AssistantChatMessage extends BaseChatMessage {
    role: ChatRole.Assistant;
    name?: string;
    toolCalls?: ChatMessageToolCall[];
  }

  export interface ToolChatMessage extends BaseChatMessage {
    role: ChatRole.Tool;
    toolCallId: string;
  }

  So every Raw.ChatMessage:

  - Has a role (System/User/Assistant/Tool).
  - Has content: ChatCompletionContentPart[].
  - May have:
      - name (any role).
      - toolCalls (assistant messages).
      - toolCallId (tool responses).

  ### 1.2 Raw.ChatCompletionContentPart

  export type ChatCompletionContentPart =
    | ChatCompletionContentPartImage
    | ChatCompletionContentPartText
    | ChatCompletionContentPartOpaque
    | ChatCompletionContentPartCacheBreakpoint;

  export enum ChatCompletionContentPartKind {
    Image = 0,
    Text = 1,
    Opaque = 2,
    CacheBreakpoint = 3
  }

  export interface ChatCompletionContentPartText {
    text: string;
    type: ChatCompletionContentPartKind.Text;
  }

  export interface ChatCompletionContentPartImage {
    imageUrl: ImageURLReference;
    type: ChatCompletionContentPartKind.Image;
  }

  export interface ChatCompletionContentPartOpaque {
    value: unknown;
    tokenUsage?: number;
    scope?: number;
    type: ChatCompletionContentPartKind.Opaque;
  }

  export interface ChatCompletionContentPartCacheBreakpoint {
    type: ChatCompletionContentPartKind.CacheBreakpoint;
    cacheType?: string;
  }

  So the canonical Raw schema uses:

  - type: ChatCompletionContentPartKind.Text + text: string for text.
  - type: ChatCompletionContentPartKind.Image + imageUrl: { url: string; detail?: 'low' | 'high' } for images.
  - type: Opaque for arbitrary JSON (value: unknown).
  - type: CacheBreakpoint for internal markers.

  (OpenAI‑style image_url parts are mapped into this schema earlier, before LRE sees them.)

  ———

  ## 2. How Live Request Editor manipulates the payload

  ### 2.1 Storage model

  - EditableChatRequest.originalMessages: Raw.ChatMessage[]
      - Deep clone of the original RenderPromptResult.messages.
  - EditableChatRequest.messages: Raw.ChatMessage[]
      - The current payload that will be sent / replayed.
  - EditableChatRequest.sections: LiveRequestSection[]
      - Per‑message UI rows, each with:
          - kind, label, content, originalContent, sourceMessageIndex, optional message?: Raw.ChatMessage.

  Creation:
  src/extension/prompt/node/liveRequestBuilder.ts:13 → buildEditableChatRequest(...) and
  createSectionsFromMessages(...).

  ### 2.2 Editing operations

  - Update section content
    LiveRequestEditorService.updateSectionContent(...)
    src/extension/prompt/node/liveRequestEditorService.ts:124
      - Sets:
          - section.content = newContent
          - section.editedContent = newContent
          - section.deleted = false
  - Delete / restore section
    deleteSection(...) / restoreSection(...)
    liveRequestEditorService.ts:260 / :274
  - Reset request
    resetRequest(...)
    liveRequestEditorService.ts:288
      - Restores messages and sections from originalMessages.

  ### 2.3 Rebuilding Raw.ChatMessage[] from sections

  Core logic:
  recomputeMessages(request: EditableChatRequest)
  src/extension/prompt/node/liveRequestEditorService.ts:1121

  For each section:

  1. Skip if section.deleted (message is dropped).
  2. Get base message:
      - If section.message exists:
          - message = deepClone(section.message) (preserves leaf-level edits to nested fields).
      - Else if request.originalMessages[section.sourceMessageIndex] exists:
          - message = deepClone(originalMessage) (keeps role, content parts, toolCalls, etc.).
      - Else:
          - message = createMessageShell(section.kind) (role‑appropriate shell).
  3. If section.editedContent !== undefined:
      - New behavior (after fix):
          - Extract existing non‑text parts:

            const existingParts = Array.isArray(message.content) ? message.content : [];
            const nonTextParts = existingParts.filter(part => {
              const candidate = part as { type?: unknown; text?: unknown };
              if (candidate.type === Raw.ChatCompletionContentPartKind.Text) {
                return false;
              }
              if (typeof candidate.text === 'string') {
                return false;
              }
              return true;
            });
          - Rebuild content:

            message.content = [
              {
                type: Raw.ChatCompletionContentPartKind.Text,
                text: section.editedContent
              },
              ...nonTextParts
            ];
          - This:
              - Keeps any existing non‑text parts (Image, Opaque, CacheBreakpoint).
              - Normalizes the textual part into a single Text segment containing the edited string.
  4. Assign back:
      - section.message = message
      - Append to updatedMessages.

  At the end:

  - request.messages = updatedMessages
  - request.isDirty reflects any changes vs originalMessages.

  Then getMessagesForSend(...) and buildReplayForRequest(...) use request.messages as the source of truth.

  ———

  ## 3. Does the editing respect the Raw schema?

  This section distinguishes between the **implemented MVP behaviour** and the **target surgical behaviour** described in Requirement 15 and the Live Request Editor design doc.

  ### 3.1 Legacy MVP behaviour (section‑level aggregate text)

  Earlier versions of the Live Request Editor used `LiveRequestEditorService.recomputeMessages` to apply **section-level** edits, where each section exposed a single aggregate text editor and any change collapsed multiple `Text` parts into one.

  Under that implementation:

  - For all messages:
      - `role` is always one of `ChatRole.System | User | Assistant | Tool`.
      - `content` is always an array of `ChatCompletionContentPart`.
  - For unedited sections:
      - The message is a deep clone of the original `Raw.ChatMessage` produced by the prompt renderer (already well‑typed).
  - For edited sections:
      - We:
          - Clone the original message.
          - Extract all existing non‑text parts (Image, Opaque, CacheBreakpoint).
          - Replace `message.content` with:

            ```ts
            [
              {
                type: Raw.ChatCompletionContentPartKind.Text,
                text: section.editedContent
              },
              ...nonTextParts
            ];
            ```

      - This means:
          - All non‑text parts are preserved and remain valid `ChatCompletionContentPart` entries.
          - Textual content is normalised into a **single** `Text` part per edited message.

  Therefore, the recomposed `Raw.ChatMessage[]` structurally respects the Raw schema:

  - No invalid `type` values are introduced.
  - `text` is only set on `Text` parts.
  - `imageUrl` / `value` / `cacheType` fields on non‑text parts are left untouched.

  Semantic differences vs the original payload:

  - The exact segmentation of text across multiple `Text` parts is lost once a section is edited (all text collapses into one part), but:
      - The **ordering and identity** of non‑text parts is preserved.
      - Message‑level fields (`role`, `toolCalls`, `name`, `toolCallId`) are taken from `originalMessages` and are not mutated (except when a section is deleted).

  This MVP behaviour already satisfies the “schema correctness” portion of Requirement 15 and guarantees non‑text preservation. However, it does **not** preserve the original segmentation of text across multiple `Text` parts and makes it harder to reason about which exact field was edited.

  The **current design and UI flows** now operate directly on **per‑leaf fields** (for example, `messages[i].content[j].text`, `messages[i].toolCalls[k].function.arguments`, `messages[i].name`, `requestOptions.temperature`) rather than redistributing aggregate text. Section‑level aggregate editing is retained only as a legacy, compatibility path (primarily for older auto‑override flows) and is a candidate for removal once all callers use the leaf‑level APIs; see Requirement 15 and the Live Request Editor design doc for details.

  ### 3.2 Hierarchical projection and Raw path bindings

  Although downstream consumers only see `Raw.ChatMessage[]`, the Live Request Editor maintains a **hierarchical projection** on top of this payload so users can understand how edits map back to the underlying JSON:

  - Top-level nodes:
      - One “message section” per `Raw.ChatMessage`, keyed by its array index (`sourceMessageIndex`).
  - Child nodes:
      - Scalar **field nodes** for message-level fields such as `role`, `name`, `toolCallId`.
      - Group nodes for structured fields such as `content` and `toolCalls`.
      - Synthetic “contentPart” nodes for each `message.content[contentIndex]`.
      - Synthetic “toolCall” nodes for each `message.toolCalls[toolCallIndex]` (assistant messages).
  - Each node carries:
      - `sourceMessageIndex` (message index),
      - optional `contentIndex` / `toolCallIndex`, and
      - a human-readable `rawPath` string such as:
          - `messages[3].content[1]`
          - `messages[4].toolCalls[0]`.

  This projection does **not** introduce a new storage format; it is an in-memory viewmodel layered directly on top of the Raw arrays. All edits applied through the Live Request Editor ultimately mutate only:

  - Individual leaf fields (for example, `messages[messageIndex].content[contentIndex].text`, `messages[messageIndex].toolCalls[toolCallIndex].function.arguments`, `messages[messageIndex].name`, `requestOptions.temperature`), and  
  - Never change the shape or ordering of `content` / `toolCalls` arrays except when an entire message is deleted (section deletion).

  The hierarchical view therefore:

  - Reuses Raw keys and indices “as-is” (no synthetic IDs beyond section/node IDs).
  - Makes it possible for UI affordances (like an Edit button on a message card) to point back to the correct Raw location without a second mapping layer beyond indices.
  - Remains an internal concern of the Live Request Editor; replay/CLI code paths continue to work only with recomposed `Raw.ChatMessage[]` payloads.  
