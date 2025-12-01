# Requirements Document

## Introduction

We are building a **Workbench Prompt Inspector** that brings the Live Request Editor directly into the VS Code workbench. Power users should be able to inspect, edit, and intercept prompt sections using the same renderer and layout options as Copilot Chat (panel, side panel, popped-out window). The inspector must support recursive sub-agent monitoring: when secondary agents produce their own requests, the inspector reveals them as nested panes so the user can intercept or modify each stage. Alongside parity with today’s webview, the new surface should unlock advanced context-engineering workflows (memory injection, custom summaries) and eventually expose hooks for external agents/tools.

**Goals**

- Deliver a workbench-native inspector that reuses Copilot Chat’s renderer, theming, accessibility, and docking behaviors.
- Maintain full editing/interception feature set (dirty state, reset, delete/restore, send blocking) and extend it to sub-agent requests.
- Allow configurable monitoring depth/filters and prepare the surface for future prompt augmentation providers (memory blocks, MCP integration).

**Non-goals**

- Shipping a refactored prompt pipeline; we continue using `ILiveRequestEditorService`.
- Implementing full MCP tooling inside the inspector in this iteration (we only add hooks).

## Glossary

- **Workbench Prompt Inspector** – New workbench-native view that displays editable prompt sections.
- **Sub-agent** – Any secondary agent/tool that initiates a nested request during the main conversation (e.g., summarizer, planner).
- **Interception** – Flow where prompt sends pause until user resumes/cancels.
- **Request Node** – A specific editable request (root or sub-agent) tracked by `ILiveRequestEditorService`.
- **Depth Limit** – User-configurable maximum nesting level to monitor.
- **Prompt Augmentation Provider** – Future plug-in (possibly MCP) that can insert additional context/memory into the editable request.

## Requirements

### Requirement 1 – Workbench-native Surface

**User Story**: As a Copilot power user, I want the Prompt Inspector to behave like other VS Code views so I can dock, drag, or pop it out just like Copilot Chat.

#### Acceptance Criteria

1.1 THE Prompt Inspector SHALL register as a VS Code view/panel that can appear in the panel, side bar, or detached window.
1.2 WHEN the user drags the Prompt Inspector tab, THEN VS Code SHALL allow docking anywhere the chat panel can dock.
1.3 WHEN multiple VS Code windows are open, THEN each window SHALL host its own inspector instance scoped to conversations in that window.
1.4 THE Prompt Inspector view SHALL use VS Code’s theme tokens and accessibility patterns (focus rings, ARIA labels) identical to Copilot Chat.

### Requirement 2 – Renderer Parity

**User Story**: As someone inspecting prompts, I want sections to look and behave like chat messages so I immediately understand the content and actions.

#### Acceptance Criteria

2.1 THE inspector SHALL reuse Copilot Chat’s message renderer for section headers/body/markdown instead of Markdown-It.
2.2 THE inspector SHALL display section hover toolbars (Edit/Delete/Restore) styled identically to the chat code-block toolbar.
2.3 THE inspector SHALL support inline editing using the same components/chat theme as chat bubbles.
2.4 WHEN token counts are available, THEN the inspector SHALL show token meters using the existing chat token meter component.
2.5 WHEN sections are dirty/deleted, THEN the inspector SHALL show badges/styles consistent with the existing webview behaviors.

### Requirement 3 – Sub-agent Monitoring

**User Story**: As a developer tracing multi-agent workflows, I want to see nested requests and drill into each one before it sends.

#### Acceptance Criteria

3.1 THE inspector SHALL render a tree/list of request nodes (root + sub-agents) with parent/child relationships.
3.2 WHEN the user selects a sub-agent node, THEN its prompt sections SHALL animate into view (e.g., slide-in pane) while preserving access to the parent node.
3.3 THE inspector SHALL support recursive navigation (depth ≥ 3) without reloading the entire view.
3.4 THE user SHALL be able to configure monitoring depth and agent filters via settings; filtered nodes SHALL be hidden but counted.
3.5 WHEN a sub-agent request triggers interception, THEN the inspector SHALL show the same interception banner/buttons scoped to that node.

### Requirement 4 – Editing & Interception Parity

**User Story**: As a Prompt Inspector user, I need the same editing and interception controls that currently exist in the webview so I can safely modify prompts.

#### Acceptance Criteria

4.1 THE inspector SHALL surface dirty state badges and Reset actions identical to the current experience.
4.2 WHEN validation fails (e.g., empty prompt), THEN the inspector SHALL block send, show the banner, and disable Resume actions until resolved.
4.3 All edit/delete/restore/reset actions SHALL call the existing service APIs and update the view immediately.
4.4 Interception mode (resume/cancel) SHALL be fully supported in the workbench view, including auto-focus when a request pauses.

### Requirement 5 – Configurability & Future Hooks

**User Story**: As an advanced user, I want to customize how much data the inspector shows and prepare for future context injections.

#### Acceptance Criteria

5.1 THE inspector SHALL expose settings for sub-agent depth limit, agent filters, and telemetry opt-in for detailed logging.
5.2 THE inspector SHALL provide commands/extension points for “prompt augmentation providers” (e.g., insert memory block). For this iteration, the hooks MAY be no-ops but MUST be wired into the view/controller.
5.3 WHEN augmentation providers inject content, THEN the inspector SHALL mark sections as augmented and update dirty state accordingly.

### Requirement 6 – Compatibility & Rollout

**User Story**: As a Copilot maintainer, I need a safe migration path from the webview to the workbench surface.

#### Acceptance Criteria

6.1 THE feature SHALL be gated behind a new configuration flag so insiders can opt in without removing the webview.
6.2 WHEN the flag is disabled, THEN the existing webview implementation SHALL remain unaffected.
6.3 Telemetry SHALL differentiate between webview and workbench usage to monitor adoption and regressions.
