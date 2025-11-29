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

### Requirement 3 – Section Hover Action Menu (Edit / Delete)

**User Story:**  
As a developer tuning prompts, I want intuitive hover-based controls on each prompt section so that I can surgically edit or remove pieces of the request.

#### Acceptance Criteria

3.1 WHEN the mouse cursor hovers over a Prompt Section header or body, THEN the Live Chat Request Editor SHALL display a Section Action Menu aligned similarly to the **chat code block hover toolbar** in the chat panel (position, look and feel).  
3.2 THE Section Action Menu SHALL include at least `Edit` and `Delete` actions for sections that are editable and deletable.  
3.3 WHEN the user invokes `Edit` on a section, THEN the Live Chat Request Editor SHALL reveal an inline edit surface for that section (e.g., text area or embedded editor) containing the current underlying content.  
3.4 WHEN the user modifies the content in the inline edit surface, THEN the Live Chat Request Editor SHALL update its internal state for that section while preserving a copy of the original content for potential reset.  
3.5 WHEN the user invokes `Delete` on a section, THEN the Live Chat Request Editor SHALL mark the section as deleted, visually distinguish it (or remove it) and exclude its contribution when recomputing the Chat Request.  
3.6 THE Live Chat Request Editor SHALL provide a way to restore a deleted section before the request is sent (e.g., “Restore” or “Undo Delete” action).  
3.7 THE Live Chat Request Editor MAY treat certain sections (e.g., core system prompts) as read-only in the initial version and SHALL visually indicate when a section cannot be edited or deleted.  

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
5.5 THE Live Chat Request Editor SHALL not introduce additional persistent storage for request data beyond existing logging; any edited state is ephemeral to the pending turn.  

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
