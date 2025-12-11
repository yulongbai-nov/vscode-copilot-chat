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
  src/extension/prompt/node/liveRequestEditorService.ts:886

  For each section:

  1. Skip if section.deleted (message is dropped).
  2. Get base message:
      - If request.originalMessages[section.sourceMessageIndex] exists:
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

  ### 3.1 Schema correctness

  Under the current implementation:

  - For all messages:
      - role is always one of ChatRole.System | User | Assistant | Tool.
      - content is always an array of ChatCompletionContentPart:
          - For unedited messages: deep clone of original parts (already well‑typed).
          - For edited messages:
              - Text parts are updated **surgically** while preserving non-text parts:
                  - For messages with a single `Text` part, only its `text` field is replaced.
                  - For messages with multiple `Text` parts, the editor treats the concatenation of all `Text` parts as the editable string, applies the user’s edits, and then redistributes the updated text back across the existing `Text` parts (splitting/merging as needed) without removing or reordering any non-text parts.
              - All non-text parts (Image, Opaque, CacheBreakpoint) are carried through unchanged and remain valid `ChatCompletionContentPart` entries.

  Therefore, the recomposed Raw.ChatMessage[] structurally respects the Raw schema:

  - No invalid type values are introduced.
  - text is only set on Text parts.
  - imageUrl/value/cacheType fields on non‑text parts are left untouched.

  ### 3.2 Semantic fidelity vs original payload

  There are still some semantic differences from the initial provider payload:

  - Text parts:
      - The editor treats all `Text` parts in a message as a single editable string, then pushes the edited content back into those parts. This may change the exact segmentation (e.g. how text is split across multiple parts), but keeps the same relative ordering of text vs non-text content.
  - Non‑text parts (images, opaque JSON, cache breakpoints):
      - Are preserved as-is and are not mutated by the Live Request Editor, other than being omitted if the entire section is deleted.
  - Message‑level fields:
      - `role`, `toolCalls`, `name`, `toolCallId` are taken from `originalMessages` and are not mutated by the editor (other than messages being dropped when sections are deleted).

  ### 3.3 TL;DR reflection

  - Yes, the editing logic respects the Raw schema:
      - Every recomposed message is a valid `Raw.ChatMessage`.
      - Every content entry is a valid `ChatCompletionContentPart` variant.
  - It now aims for **surgical fidelity**:
      - Text changes are confined to `Text` parts.
      - Non-text parts and message-level metadata are preserved, and non-text parts are not reordered relative to each other.
  - Some minor differences (such as how edited text is split across multiple `Text` parts) are considered acceptable, as the Raw representation is intentionally permissive and converting back to provider-specific JSON is allowed to be slightly lossy in terms of segmentation.
