# Requirements Document

## Introduction

This document defines the externally visible behaviour and constraints for the **Live Chat Request Editor** feature in the GitHub Copilot Chat VS Code extension.

The feature exposes the fully composed ChatML request that Copilot is about to send to the LLM, rendered using the same visualization as the chat panel, and allows advanced users to edit or delete individual prompt sections before the request is dispatched. The editor operates on the same request data model used by `requestLogger`, but it is integrated into the **chat panel**, not the Request Logger tree.

**Goals**

- Let users inspect the complete, structured prompt for the next chat turn in a familiar chat-like UI.
- Allow per-section collapse, editing, and deletion with hover-driven action menus.
- Ensure edits reliably affect the **actual request sent to the LLM**.
- Reuse chat panel and prompt-rendering infrastructure wherever possible.

**Non-goals**

- Editing historical Request Logger entries in the debug tree.
- Changing log storage or retention semantics of `IRequestLogger`.

## Glossary

- **Chat Request** – The ChatML request (messages + options) constructed from the conversation, prompts, and context, and sent via `ChatMLFetcher`.
- **Request Logger** – The infrastructure behind `IRequestLogger` that records Chat Requests, tool calls, and prompt traces for observability.
- **Prompt Renderer** – The `PromptRenderer` / `renderPromptElement` pipeline that builds `RenderPromptResult` (`messages`, `tokenCount`, `HTMLTracer`, references) from higher-level prompt elements.
- **Live Chat Request Editor** – The new editor surface in the chat panel that shows and edits the pending Chat Request.
- **Prompt Section** – A logical segment of the prompt (e.g., system instructions, user message, context snippet, tool hint, prediction) mapped from `RenderPromptResult` and/or `Raw.ChatMessage[]`.
- **Section Action Menu** – The hover-only toolbar shown on each Prompt Section containing `Edit`, `Delete`, and related actions.
- **Chat Timeline Replay** – A replayed chat session/timeline created from an edited prompt to visualize the final request history (including deletions/edits) as chat bubbles.
- **Graphiti** – An optional external graph memory service that ingests conversations/turns/sections as nodes/edges for RAG/auditing.

## Requirements

### Requirement 1 – Open Live Request Editor in Chat Panel

**User Story:**  
As a Copilot Chat user debugging prompts, I want to open a live view of the full request from the chat panel so that I can see and adjust exactly what will be sent to the model.

#### Acceptance Criteria

1.1 THE `Live_Chat_Request_Editor` SHALL be gated by a configuration flag (e.g., `github.copilot.chat.advanced.livePromptEditorEnabled`).  
1.2 WHEN the feature flag is enabled, THEN the chat panel UI SHALL expose an affordance (e.g., “View Prompt” button or tab) to open the Live Chat Request Editor for the pending request.  
1.3 WHEN the affordance is invoked, THEN the `Live_Chat_Request_Editor` SHALL open within the chat panel (e.g., as a drawer or secondary panel) without leaving the current chat session.  
1.4 WHEN no pending request can be constructed (e.g., empty input or unsupported location), THEN the `Live_Chat_Request_Editor` SHALL show a clear message instead of failing silently.  
1.5 WHEN the feature flag is disabled, THEN no additional UI or commands specific to the Live Chat Request Editor SHALL be visible or active.  

### Requirement 2 – Prompt Visualization and Sections

**User Story:**  
As a developer inspecting a pending request, I want the full prompt broken into understandable sections in a familiar layout so that I can reason about what the model will see.

#### Acceptance Criteria

2.1 WHEN the Live Chat Request Editor opens, THEN it SHALL construct a Prompt Section model from the same messages and metadata that will be sent to the LLM.  
2.2 THE Live Chat Request Editor SHALL render Prompt Sections using the same or closely aligned components and styles as the chat panel (chat bubbles, markdown rendering, code blocks, inline styles).  
2.3 EACH Prompt Section SHALL include a visible header with a label (e.g., “System”, “User”, “Context: file.ts”) and its relative order within the prompt.  
2.4 THE Live Chat Request Editor SHALL support collapsing and expanding each section individually, with collapsed state clearly indicated and the body content hidden when collapsed.  
2.5 WHEN a section contains markdown with code blocks or inline code, THEN the Live Chat Request Editor SHALL render it using the same or equivalent markdown and code block renderer as the chat panel.  
2.6 THE Live Chat Request Editor SHOULD surface key request metadata (e.g., model, max tokens, location) adjacent to the sections, derived from the Chat Request.  
2.7 WHEN a Prompt Section represents a tool invocation or tool result, THEN the Live Chat Request Editor SHALL display the invoked tool’s name and the exact arguments that were sent so power users can audit the call.  
2.8 WHEN optional “extra detail” panels (request options, telemetry, raw request) are enabled via settings, THEN those panels SHALL share the same collapse/expand controls and accessibility affordances as the core prompt sections.  

### Requirement 3 – Section Hover Action Menu (Edit / Delete)

**User Story:**  
As a developer tuning prompts, I want intuitive hover-based controls on each prompt section so that I can surgically edit or remove pieces of the request.

#### Acceptance Criteria

3.1 WHEN the mouse cursor hovers over a Prompt Section header or body, THEN the Live Chat Request Editor SHALL display a Section Action Menu aligned similarly to the **chat code block hover toolbar** in the chat panel (position, look and feel).  
3.2 THE Section Action Menu SHALL include at least `Edit` and `Delete` actions for sections that are editable and deletable.  
3.3 WHEN the user invokes `Edit` on a message section, THEN the Live Chat Request Editor SHALL reveal an inline **advanced** edit surface for that section that exposes the Raw hierarchy (`role`, `name`, `toolCallId`, `content[]`, `toolCalls[]`) and allows edits only at **leaf fields** (see Requirements 15–16).  
3.4 WHEN the user edits a leaf field in the advanced edit surface, THEN the Live Chat Request Editor SHALL apply a single, surgical mutation to the backing `EditableChatRequest` and record sufficient information (old/new leaf values) to support undo/redo and reset.  
3.5 WHEN the user invokes `Delete` on a section, THEN the Live Chat Request Editor SHALL mark the section as deleted, visually distinguish it (or remove it) and exclude its contribution when recomputing the Chat Request.  
3.6 THE Live Chat Request Editor SHALL provide a way to restore a deleted section before the request is sent (e.g., “Restore” or “Undo Delete” action).  
3.7 THE Live Chat Request Editor MAY treat certain sections (e.g., core system prompts) as read-only in the initial version and SHALL visually indicate when a section cannot be edited or deleted.  
3.8 WHEN the Live Request Editor is in “Send normally”, THEN the editor SHALL render sections in preview-only mode (no `Edit` affordances).  
3.9 THE editor SHALL NOT provide an aggregate “replace the entire message text” editor as the primary UX; edits SHALL occur only via leaf fields that map 1:1 to the Raw payload.  

### Requirement 4 – Live Request Application and Sending

**User Story:**  
As a developer experimenting with prompt variants, I want my edits to actually affect the next model call so that I can see the impact of my changes.

#### Acceptance Criteria

4.1 THE Live Chat Request Editor SHALL maintain an internal editable request model that is used as the source of truth for the messages passed to the ChatML fetcher when sending.  
4.2 WHEN the user sends a message with no edits applied, THEN the Live Chat Request Editor SHALL ensure the constructed request is equivalent to the existing behaviour (no regressions).  
4.3 WHEN the user sends a message after editing or deleting sections, THEN the Live Chat Request Editor SHALL construct and pass an updated set of messages to the ChatML fetcher that reflects those edits.  
4.4 THE Live Chat Request Editor SHALL expose a “Reset to default prompt” action that restores the request model to its auto-generated state before any user edits.  
4.5 IF edits lead to an invalid or empty request (e.g., all sections deleted), THEN the Live Chat Request Editor SHALL block sending and present a clear, actionable error message.  
4.6 THE Live Chat Request Editor SHALL not modify conversation history or previously sent messages; it only affects the **next** outgoing request.  

### Requirement 5 – Integration with Request Logger and Prompt Renderer

**User Story:**  
As a maintainer of the Copilot Chat extension, I want the Live Chat Request Editor to leverage existing request and tracing infrastructure so that the implementation stays consistent and maintainable.

#### Acceptance Criteria

5.1 THE Live Chat Request Editor SHALL derive its initial request content from the same messages and options that are passed to `ChatMLFetcher` and logged by `IRequestLogger`.  
5.2 THE Live Chat Request Editor SHALL use the output of `PromptRenderer` / `renderPromptElement` (including token counts and references) as the basis for constructing Prompt Sections where possible.  
5.3 THE Live Chat Request Editor MAY use `HTMLTracer` data from `addPromptTrace` to refine section boundaries, but SHALL gracefully handle cases where tracing is disabled or unavailable.  
5.4 THE Live Chat Request Editor SHALL ensure that the final request seen by `IRequestLogger.logChatRequest` matches what was displayed in the editor (after edits), or otherwise record discrepancies for debugging.  
5.5 THE Live Chat Request Editor SHALL NOT introduce new long-term storage formats for request data beyond existing logging; however, it MAY cache intercepted requests in **workspace-scoped** storage for resilience/inspection across reloads, using schema versioning and safe fallback/clear behavior.  

### Requirement 6 – Accessibility, Performance, and Reliability

**User Story:**  
As an accessibility user and as a maintainer, I want the Live Chat Request Editor to be responsive, accessible, and robust so that it does not degrade the chat experience.

#### Acceptance Criteria

6.1 THE Live Chat Request Editor SHALL support keyboard navigation for focusing sections, toggling collapse, opening the Section Action Menu, and invoking `Edit`, `Delete`, `Restore`, and `Reset` actions.  
6.2 THE Live Chat Request Editor SHALL provide appropriate ARIA roles and labels for sections, action menus, and buttons, aligned with existing chat panel accessibility patterns.  
6.3 THE Live Chat Request Editor SHALL avoid eagerly rendering extremely large sections; it SHOULD lazily render content or truncate with a clear “Show more” affordance.  
6.4 THE Live Chat Request Editor SHALL handle failures in section construction or rendering by falling back to a simple, plain-text view of the prompt and surfacing non-blocking diagnostics.  
6.5 THE Live Chat Request Editor SHALL ensure that all rendered content is sanitized and respects the same CSP constraints as existing chat UI, preventing execution of untrusted content from prompts.  
6.6 THE Live Chat Request Editor SHALL log unexpected internal errors (e.g., mapping failures, invalid state) to the existing Copilot Chat output channel or telemetry pipeline without crashing the extension host.  

### Requirement 7 – Session Targeting and Multi-Session Selection

**User Story:**  
As a user with multiple Copilot chat threads (panel, side panel, editor, other windows), I want the Live Chat Request Editor to default to the active chat but still let me switch to another thread when needed.

#### Acceptance Criteria

7.1 THE Live Chat Request Editor SHALL associate each editable request with a specific conversation session identifier and `ChatLocation`.  
7.2 WHEN the Prompt Inspector is opened from a given chat widget, THEN it SHALL, by default, target the conversation associated with that widget (the one receiving the user’s input).  
7.3 WHEN multiple conversations exist in the current VS Code window, THEN the Live Chat Request Editor SHOULD provide a drop-down or equivalent control to switch its target conversation among those sessions.  
7.4 THE Live Chat Request Editor SHALL scope its conversation list to the current VS Code window only and SHALL NOT attempt to span multiple windows or remote hosts.  
7.5 WHEN the user switches the target conversation via the selector, THEN the Live Chat Request Editor SHALL refresh its view to show the pending request (or a message if none) for the newly selected conversation.  
7.6 THE conversation selector SHALL remain enabled in all modes and label each session with its location, debug/intent name, and a short session-id suffix (e.g., last 6 characters) to disambiguate concurrent sessions.  

### Requirement 8 – Prompt Interception Mode

**User Story:**  
As a power user who wants to audit every prompt, I want to pause each send, review/edit the request, and explicitly resume sending so that I never leak an unintended prompt to the model.

**Status:** ✅ Implemented in PR #17. Toggling `github.copilot.chat.advanced.livePromptEditorInterception` (via command palette or the dedicated status bar item) pauses every send, surfaces the sticky “Resume Send / Cancel” banner inside the Live Request Editor, focuses the view automatically, and only resumes `ChatMLFetcher.fetchMany` once the user confirms. Cancel/disable flows resolve the pending turn with a friendly cancellation message and emit telemetry.

#### Acceptance Criteria

8.1 THE extension SHALL expose a persisted setting/command to toggle **Prompt Interception Mode** on/off, surfaced in the command palette and status bar.  
8.2 WHEN interception mode is OFF, THEN chat requests SHALL behave exactly as they do today (no pause, no additional UI).  
8.3 WHEN interception mode is ON and the user presses Send, THEN the request SHALL be captured after prompt construction but BEFORE `ChatMLFetcher.fetchMany` runs, and the chat panel SHALL remain in a pending state instead of erroring or reporting “offline.”  
8.4 WHEN a request is intercepted, THEN the Live Request Editor view SHALL automatically focus (or open), display a prominent banner (e.g., “Request intercepted – review and Resume Send”), and visually highlight itself.  
8.5 WHILE intercepted, the editor SHALL present a large primary button labelled “Resume Send” plus a secondary affordance to cancel/discard the pending turn.  
8.6 WHEN the user presses “Resume Send,” THEN the latest edits SHALL be applied and the pending request SHALL be forwarded to the ChatML fetcher as if it had been sent normally.  
8.7 WHEN the user cancels the interception, closes the view, or sends another prompt, THEN the pending turn SHALL be resolved (discarded) and the user SHALL receive clear feedback.  
8.8 THE status bar item SHALL reflect the current mode (“Prompt Interception: On/Off”) and, when a request is paused, indicate that action is required (e.g., warning icon, tooltip).  
8.9 INTERCEPTION mode SHALL be conversation-aware; only the active conversation’s request is paused, and other conversations in the same window continue to work normally unless they also intercept.  
8.10 ALL interception flows SHALL log telemetry (mode toggles, resume vs. cancel) for future analysis.  
8.11 WHEN the active chat session ends, the user switches to a different conversation, or the selected model/context changes while a request is intercepted, THEN the Live Chat Request Editor SHALL automatically cancel the pending turn, dismiss the interception UI, and surface a reason such as “Context changed – request discarded.”  
8.12 WHEN a request originates from an automated sub-agent/tool flow (e.g., `runSubagent`, background TODO tool execution), THEN the Live Chat Request Editor SHALL bypass interception so automation continues without manual approval.  

### Requirement 9 – Subagent Prompt Monitor

**User Story:**  
As a developer running automated TODO/Plan subagents, I want a compact widget that shows the prompts those subagents send so I can audit or troubleshoot their work without blocking the main chat flow.

#### Acceptance Criteria

9.1 THE extension SHALL expose a read-only “Subagent Prompt Monitor” view (e.g., a tree pinned to the right side of the chat panel) whenever the live editor feature flag is enabled.  
9.2 WHEN a subagent (`request.isSubagent === true`) issues a request, THEN the monitor SHALL add an entry containing its session label, tool invocation, and timestamp without pausing or intercepting the send.  
9.3 EACH monitor entry SHALL expand into a tree that mirrors the prompt sections (system/user/context/tool) so users can inspect what was sent; markdown/code should use the same renderer as the main editor.  
9.4 THE monitor SHALL keep only a bounded history (at least the most recent 10 subagent runs) and provide affordances to collapse/expand or clear entries.  
9.5 THE monitor SHALL be keyboard accessible (focusable tree items, expand/collapse via keyboard) and respect VS Code theming.  
9.6 THE monitor SHALL stay synchronized with session lifecycle events (removed when the chat session is disposed) so stale subagent prompts are not shown.  

### Requirement 10 – Session Alignment Metadata View

**User Story:**  
As a power user validating intercepted prompts, I want a dedicated metadata view that mirrors the current session/request information (and, when I opt in, the raw request payload) so that I can immediately verify the Live Request Editor is targeting the correct conversation without relying on transient chat status entries.

#### Acceptance Criteria

10.1 WHEN `github.copilot.chat.advanced.livePromptEditorEnabled` is `true`, THEN the `github.copilot.liveRequestMetadata` tree view SHALL be registered in the Copilot Chat container and default to showing metadata for the most recent pending request.  
10.2 THE metadata view SHALL subscribe to `ILiveRequestEditorService.onDidChangeMetadata`, refreshing its tree items within 500 ms of metadata or configuration changes.  
10.3 Root metadata nodes SHALL mirror the fields specified by `github.copilot.chat.promptInspector.sessionMetadata.fields`, truncating long identifiers, exposing tooltips, and wiring the `github.copilot.liveRequestMetadata.copyValue` command so every entry can be copied to the clipboard.  
10.4 A “Token Budget” node SHALL display the current usage percentage plus `used/max` token counts when `tokenCount` and `maxPromptTokens` are present; otherwise it SHALL render “Token Budget: awaiting data…”.  
10.5 WHEN no metadata exists (no pending request, feature disabled, or interception idle), THEN the tree view SHALL render a placeholder node (“Live Request Editor idle — send a chat request to populate metadata.”).  
10.6 WHEN `sessionMetadata.fields` is empty, THEN the metadata section SHALL hide while still exposing the token budget node/placeholder so the tree does not collapse unexpectedly.  
10.7 THE tree SHALL expose a toolbar command (`github.copilot.liveRequestMetadata.configureFields`) that opens a Quick Pick for selecting metadata fields and persists the result via `github.copilot.chat.promptInspector.sessionMetadata.fields`.  
10.8 EVERY metadata or outline leaf SHALL bind the copy command so users receive consistent clipboard behavior (and transient status feedback) when copying session IDs, request IDs, or JSON snippets.  
10.9 WHEN `github.copilot.chat.promptInspector.extraSections` contains `requestOptions`, the metadata view SHALL add a “Request Options” outline node that renders the JSON payload hierarchically (object properties, array indices) with copy affordances on every node and truncation after a safety budget.  
10.10 WHEN the extra sections contain `rawRequest`, the metadata view SHALL add a “Raw Request Payload” outline node that nests model, location, messages, and metadata exactly as they will be logged, again using the outline renderer + copy affordances.  
10.11 Outline nodes SHALL respect the main feature flag, inherit VS Code theming/high-contrast styles, and avoid freezing the UI by truncating after a bounded number of entries with an explicit “…entries truncated…” indicator.

### Requirement 11 – Auto-apply Prefix Edits (simplified Auto Override)

**User Story:**  
As an advanced Copilot user, I want to intercept the first turn of a chat session, tweak the system/prefix messages, and have those changes automatically applied to every later request without pausing the conversation, so that I can enforce custom instructions with minimal friction.

#### Acceptance Criteria

11.1 THE mode selector SHALL present three user-facing options with consistent labels across header, status bar, and Quick Pick: `Send normally` (`off`), `Pause & review every turn` (`interceptAlways`), and `Auto-apply saved edits` (`autoOverride`). A separate one-shot action `Pause next turn` SHALL be exposed without adding a fourth mode.  
11.2 WHEN `Auto-apply saved edits` is selected AND no overrides are saved, THEN the next pending request SHALL pause before send, show only the first `N` prefix sections (default 3, configurable via `github.copilot.chat.liveRequestEditor.autoOverride.previewLimit` and a Quick Pick), and allow the user to edit/save overrides.  
11.3 WHEN overrides are already saved AND Auto-apply is active, THEN requests SHALL send immediately with the saved prefix edits applied unless the user triggers `Pause next turn` or `Capture new edits`.  
11.4 THE banner SHALL expose a primary action `Capture new edits` that arms a capture for the next turn; a secondary menu SHALL provide `Pause next turn`, `Remove saved edits`, `Where to save edits` (Session/Workspace/Global), and `Sections to capture` (preview limit). Redundant buttons SHALL be hidden while a capture is armed.  
11.5 THE banner SHALL summarize state using simplified copy: `Auto-apply edits · <scope> · Applying (saved <timestamp>)` OR `Capturing next turn · showing first N sections`, updating immediately on state changes from any entry point.  
11.6 EACH overridden section SHALL display a “Show diff” affordance in its hover toolbar that opens `vscode.diff` between the original intercepted content and the persisted override, with tooltips indicating last-updated timestamp and scope.  
11.7 Auto-apply persistence SHALL be stored in extension global/workspace storage (depending on scope) using encrypted storage APIs when available; clearing overrides MUST remove the stored payload and re-arm capturing for the next turn while in Auto-apply.  
11.8 TELEMETRY SHALL record mode transitions, captures, saved/cleared overrides, scope changes, preview-limit changes, and diff button usage with anonymized scope (session/workspace/global) but without storing user content.  

### Requirement 12 – Chat Timeline Replay (Moved)

Tracked in `.kiro/specs/chat-timeline-replay`. This document keeps the requirement number reserved but does not duplicate acceptance criteria here.

### Requirement 13 – Chat History Persistence (Moved)

Tracked in `.kiro/specs/chat-history-persistence`. This document keeps the requirement number reserved but does not duplicate acceptance criteria here.

### Requirement 14 – Graphiti Memory Integration (Moved)

Tracked in `.kiro/specs/graphiti-memory-integration`. This document keeps the requirement number reserved but does not duplicate acceptance criteria here.

### Requirement 15 – Surgical Payload Editing Fidelity

**User Story:**  
As a Copilot engineer debugging complex prompts (with images and other non-text parts), I want edits in the Live Request Editor to change only the specific leaf fields I touch in the underlying `Raw.ChatMessage[]` (for example, a single `text` string or `toolCalls[].function.arguments`) while preserving all other content parts and message-level metadata, so that the payload sent to the LLM remains structurally faithful to what was originally rendered.

#### Acceptance Criteria

15.1 WHEN a section is **not** edited or deleted, THEN the corresponding `Raw.ChatMessage` in the recomposed payload SHALL remain a deep clone of the original message emitted by the prompt renderer, including:
- `role` (`System`/`User`/`Assistant`/`Tool`).
- All `ChatCompletionContentPart` entries (Text, Image, Opaque, CacheBreakpoint).
- Any `toolCalls`, `toolCallId`, `name`, and other metadata fields.

15.2 WHEN the user edits a **leaf field** (for example, a single `text` value on a `ChatCompletionContentPartText`, or `toolCalls[i].function.arguments`, or `messages[i].name`), THEN the Live Request Editor SHALL:
- Mutate only that specific field in `Raw.ChatMessage[]`, and  
- Preserve:
  - Message `role`, `toolCalls`, `toolCallId`, `name`, and
  - All `content` entries (Text/Image/Opaque/CacheBreakpoint) other than the targeted `Text` entry, including their ordering relative to each other.

15.3 FOR messages that originally contained **multiple** `Text` content parts interleaved with non-text parts, editing one `Text` part via the UI SHALL:
- Update only that part’s `text` field, and  
- Leave all other `content` entries (including other `Text` parts and all non-text parts) untouched and in their original positions.

15.4 WHEN the Live Request Editor exposes editing for tool arguments (for example, `toolCalls[i].function.arguments`), THEN edits SHALL:
- Be confined to that arguments field, and  
- Preserve the rest of the tool call record (`id`, `type`, `function.name`) and the surrounding chat message content.

15.5 WHEN the Live Request Editor exposes editing for request-level options (for example, `requestOptions.temperature`), THEN edits SHALL:
- Mutate only the specified option, and  
- Preserve the rest of the requestOptions object and the `messages` array.

15.6 WHEN the Live Request Editor builds replay payloads (e.g., via `buildReplayForRequest(...)`) or sends requests to the LLM, the resulting `Raw.ChatMessage[]` payload SHALL:
- Honor the surgical editing semantics above, and  
- Remain compatible with downstream consumers that expect canonical `Raw.ChatMessage` structures (including Chat Timeline Replay, CLI history replay, and any future telemetry/persistence layers).

15.7 TESTS SHALL cover:
- Editing a single-text-part message (text changed, non-text unchanged).  
- Editing one of several `Text` parts with interleaved non-text parts, asserting that only the targeted `Text` part changes and all other parts remain in place.  
- Editing tool arguments and request options, asserting that only the targeted fields change and the rest of the payload is preserved.

### Requirement 16 – Hierarchical Message / Content / ToolCall View

**User Story:**  
As a Copilot engineer inspecting complex prompts (with multiple content parts and tool calls), I want the Live Request Editor to expose the **hierarchical structure** of each request (`messages[]`, `content[]`, `toolCalls[]`) so I can see where each piece of text or JSON lives in the Raw payload and reason about edits with structural context.

#### Acceptance Criteria

16.1 THE Live Request Editor SHALL treat each `Raw.ChatMessage` as a top-level **message node**, with one primary section per message (`nodeType === 'message'`, `sourceMessageIndex` matching the message index).  
16.2 FOR each message, the editor SHALL surface child nodes for:
- Top-level scalar fields (for example, `role`, `name`, `toolCallId`) as individual **field nodes**, and  
- Structured fields/arrays (for example, `content[]`, `toolCalls[]`) as **group nodes** whose children represent individual items (for example, `content[i]`, `toolCalls[i]`),  
in a way that preserves the original ordering of arrays and the original shape of the Raw message.  
16.3 EACH section node (message or child) SHALL carry enough metadata to locate its backing Raw payload, including:
- `sourceMessageIndex`, and  
- When applicable, `contentIndex` or `toolCallIndex`, and  
- A human-readable `rawPath` string (e.g., `messages[2].content[1]`, `messages[4].toolCalls[0]`) that is **0-based** and matches the current payload view for debugging.  
16.4 THE Live Request Editor UI SHALL render:
- Each **message node** as a “big card” representing the full message (header with role/kind, tokens, etc.), and  
- Its field and group children (for example, `role`, `name`, `content`, `toolCalls`) as **nested boxes** inside that card, visually grouped by type (scalar fields vs content vs tool calls vs other metadata).  
16.5 IN the current implementation, the primary **Edit** affordances SHALL be attached to **leaf nodes** (for example, `content[i].text`, `toolCalls[i].function.arguments`, `messages[i].name`, `requestOptions.temperature`), while message nodes act as visual group headers (assistant/system/user “big boxes”) that group their children.  
16.6 THE hierarchical projection SHALL remain a pure viewmodel concern:
- `EditableChatRequest.messages` remains the single source of truth,  
- Downstream consumers (ChatML fetcher, Request Logger, replay, CLI fork) SHALL continue to consume only recomposed `Raw.ChatMessage[]`, not the hierarchical tree directly.  
16.7 TESTS SHALL cover:
- Messages with combinations of scalar fields, multiple `content` entries (text + non-text), and `toolCalls`, asserting that the hierarchy (`nodeType`, `parentId`, indices, `rawPath`) matches the Raw payload.  
- Edits applied at leaf nodes (including message fields and request options) still respect Requirement 15 while the nested child nodes reflect the updated field values and unchanged surrounding structure.  
