# Design Document: Workbench Prompt Inspector

## Overview

We are upgrading the Live Request Editor/Prompt Inspector from a standalone webview to a first-class **workbench-native surface**. The new experience must sit alongside the existing Copilot Chat UI (panel, side panel, detached window), reuse as much of the chat renderer as possible, and expose richer tooling for power users who craft or intercept prompts. Key goals:

- Share the same look, feel, and accessibility semantics as Copilot Chat by running inside the VS Code workbench instead of a sandboxed React webview.
- Support multi-window/multi-surface layouts (panel, editor area, pop-out window) exactly like the chat panel, including drag-and-drop docking.
- Provide deeper inspection of **sub-agent** requests (nested intercepts), presenting them recursively and allowing targeted edits before they are sent downstream.
- Preserve and extend the current editing semantics (dirty state, reset, per-section editing/deletion) while opening the door to future context engineering features (memory blocks, custom summaries, MCP hosting).

Non-goals for this increment:

- Shipping a brand-new renderer independent of Copilot Chat. We deliberately aim to reuse the chat renderer and styles wherever practical.
- Implementing autonomous MCP tooling. We will ensure the architecture allows future agent integrations, but we only need hooks/abstractions for now.

## Current Architecture

| Layer | Responsibility | Limitations |
| --- | --- | --- |
| `LiveRequestEditorService` (extension host) | Tracks editable requests, dirty state, reset, interception, token counts. | Already workbench-safe. No change needed. |
| `LiveRequestEditorProvider` + `main.tsx` webview | React bundle rendering sections via Markdown-It, receiving updates via `postMessage`. | Cannot reuse chat renderer; limited theming/accessibility parity; no native docking. |
| Prompt pipeline (`defaultIntentRequestHandler`, `ChatMLFetcher`) | Builds editable requests, applies edits, enforces validation. | Already integrated; stays the same. |

## Proposed Architecture

### High-level structure

```
┌──────────────────────────────────────────────────────────┐
│ VS Code Workbench                                        │
│  ┌──────────────────────────────┐  ┌───────────────────┐ │
│  │ Copilot Chat Panel           │  │ Prompt Inspector │ │
│  │ (existing chat renderer)     │  │ (new workbench   │ │
│  │                              │  │  contribution)   │ │
│  └──────────────────────────────┘  └───────────────────┘ │
│           │                                ▲            │
│           ▼                                │            │
│  Chat renderer components & styles  ───────┘ shared     │
│           │                                           │
│           ▼                                           │
│  LiveRequestInspectorView (TS/TSX in workbench)        │
│           │                                           │
│           ▼                                           │
│  LiveRequestInspectorController (extension host)      │
│           │                                           │
│           ▼                                           │
│  ILiveRequestEditorService / interception plumbing     │
└──────────────────────────────────────────────────────────┘
```

### Workbench contribution

- Register a new **view container** (e.g., `copilot.promptInspector`) that behaves like the existing chat container. It can appear in the panel, sidebar, or as a detached window via VS Code’s built-in “drag tab” support.
- Inside the container, render a **custom webview-less view** using the same infrastructure as the chat panel (the “chat surface”). That gives us virtualization, markdown rendering, hover toolbars, keyboard navigation, etc.
- The view controller (`LiveRequestInspectorView`) subscribes to `ILiveRequestEditorService.onDidChange` events, just like the webview does today, but it renders directly via TS/JS on the workbench side rather than going through `postMessage`.

### Sub-agent recursion

- Extend the service to emit a tree of “request nodes” when sub-agents spawn nested requests. Each node captures: session key, agent id, parent request id, interception state.
- The UI renders this as a collapsible tree (similar to a chat thread list). Selecting a sub-node reuses the same section renderer but scrolled into a nested panel that can slide in from the side (using VS Code’s split view control or a custom details pane).
- Interception banners and action buttons propagate down the tree. Blocking/Resume/Cancel operate on whichever node is active.
- Configuration options (depth limit, filters) live in the inspector settings and feed into the service so we do not subscribe to unnecessary events.

### Layout and styling

- Base the inspector layout on the chat panel’s components. The section renderer becomes a specialized variant of the chat message renderer, with collapsible metadata and the existing hover toolbar reused.
- Sticky metadata header (model, token budget, dirty state, reset) uses VS Code’s `WorkbenchToolBar` and `Breadcrumbs` components to ensure focus/ARIA parity.
- Slide-in details: reuse VS Code’s split-view API (`SplitView`, `PaneComposite`) to animate sub-agent panes from the right. Nested sub-agents can push additional panes, breadcrumbing back to the parent request.

### Extensibility hooks

- Since we are now native, we can expose commands (e.g., `promptInspector.insertMemoryBlock`) that future MCP agents/tools can invoke. For now, define a lightweight interface on the view controller to register “prompt augmentation providers”; they surface under a new “Add context/memory” button.
- Ensure the inspector view can be instantiated per window (one per VS Code window like the chat panel). The service already keys requests per `(sessionId, location)`.

### Telemetry & diagnostics

- Reuse existing `liveRequestEditor.*` telemetry, but tag events with `surface: workbench-native` so we can monitor rollout.
- Add counters for sub-agent depth usage, interception outcomes per depth, and custom augmentation usage (future memory blocks).

## Components

| Component | Description |
| --- | --- |
| `LiveRequestInspectorView` (new) | Workbench UI view that renders sections using chat renderer components, handles selection, dirty state badges, slide-in sub-agent panes, and user commands. |
| `LiveRequestInspectorController` (new) | Glue between the view and `ILiveRequestEditorService`. Maintains the request tree, applies filters/depth, surfaces commands. |
| `ILiveRequestEditorService` (existing) | Enhanced to track request hierarchy metadata and configurable observer depth. |
| `LiveRequestInspectorPanel` (new contribution) | VS Code view container definition + commands for opening, toggling, detach/attach. |

## Data & Control Flow

1. Copilot Chat’s intent handler builds an editable request via `ILiveRequestEditorService.prepareRequest` (unchanged).
2. The service records additional metadata when a sub-agent spawns a new request (parent id, agent name, depth).
3. `LiveRequestInspectorController` subscribes to service events, materialises a tree, and pushes updates to the view.
4. The view renders the root request sections, plus a sidebar/tree for sub-agents. Selecting a node loads its sections in the main canvas, optionally sliding previous context aside.
5. Edits/deletes/reset actions invoke the same service methods as before. Because we share the chat renderer, inline editing uses the same components as chat bubbles (e.g., `ChatEditableBlock`).
6. Interception events surface via the existing banner but now piggyback on workbench notifications rather than webview postMessage.

## Integration Points

- **Copilot Chat renderer**: reuse message/markdown components, hover toolbar styles, token meter.
- **VS Code view/panel system**: register `Prompt Inspector` so it docks like chat.
- **Interception commands**: reuse `github.copilot.liveRequestEditor.toggleInterception` etc.
- **Settings**: add `github.copilot.chat.promptInspector.depthLimit`, `…filterAgents`, etc. so users can scope sub-agent monitoring.

## Migration / Rollout Strategy

1. Introduce the workbench-native view under a new setting/flag (`…promptInspectorWorkbenchEnabled`). Keep the webview available as fallback.
2. Mirror functionality (editing, reset, interception) inside the workbench view; run both surfaces side-by-side for insiders.
3. Once parity is confirmed, flip the default to workbench view and eventually retire the webview bundle.

## Performance / Reliability / Security / UX

- **Performance**: Chat renderer already handles large prompts; ensure we virtualize section lists just like chat transcripts. Lazy-load nested sub-agent views to avoid rendering everything upfront.
- **Reliability**: Centralizing in the workbench reduces message-passing errors. Add error banners if the service cannot supply a request tree.
- **Security**: No custom HTML injection from React; we rely on VS Code’s trusted renderer, reducing CSP maintenance.
- **UX**: Focus management reuses VS Code’s tabbing model. Slide-in panes should be keyboard-accessible (use `SplitView` focus APIs). Interception banners need ARIA live regions as before.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Chat renderer is not fully reusable | Audit component dependencies; wrap missing pieces (e.g., ChatSection) in a shared package `@copilot/chat-renderer`. |
| Regresions in existing webview | Keep both surfaces behind flags until parity is validated; add telemetry comparisons.
| Sub-agent tree complexity overwhelms UI | Add configurable depth/filter + collapsed nodes by default; render counts rather than full lists for deep trees.
| Future MCP/tooling integration unknown | Define provider API but keep implementation minimal; ensure the view controller exposes stable commands/hooks.

## Future Enhancements

- Visual diffing between original and edited prompt sections using the native diff renderer.
- “Prompt augmentation providers” that can insert memory/context snippets, optionally powered by MCP servers.
- Export/import editable requests directly from the inspector.
- Allow other agents/tools to open the inspector via API to programmatically inspect or modify prompts.
