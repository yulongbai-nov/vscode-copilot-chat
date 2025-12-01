# Implementation Plan

## Status Snapshot

- 📋 Design + requirements drafted; workbench-native inspector scoped.
- ⚙️ Core services (`ILiveRequestEditorService`, interception plumbing) already exist and remain reusable.
- 🧭 Next up: build the workbench view, reuse chat renderer components, and wire in sub-agent tree + settings.

## Checklist

- [ ] 1. Workbench infrastructure
  - [ ] 1.1 Add feature flag `github.copilot.chat.promptInspectorWorkbenchEnabled`; default false.
  - [ ] 1.2 Register new view container/panel contribution `copilot.promptInspectorWorkbench` with commands (`show`, `toggle`).
  - [ ] 1.3 Implement `LiveRequestInspectorPanel` host that instantiates the view/controller when the flag is on.

- [ ] 2. Shared renderer extraction
  - [ ] 2.1 Identify chat renderer components needed for sections (message bubble, hover toolbar, token meter) and extract them into a shared module (or re-export existing ones) consumable by the inspector.
  - [ ] 2.2 Provide a lightweight adapter so inspector sections can reuse the markdown/chat block renderer without workbench-only dependencies.

- [ ] 3. View/controller implementation
  - [ ] 3.1 Build `LiveRequestInspectorController` that subscribes to `ILiveRequestEditorService`, tracks request tree, enforces depth/filter settings.
  - [ ] 3.2 Implement `LiveRequestInspectorView` using VS Code’s chat surface primitives: render section list, metadata header, action buttons.
  - [ ] 3.3 Port existing actions (edit, delete, restore, reset) to invoke service APIs; ensure dirty state + validation banners mirror webview.
  - [ ] 3.4 Integrate interception banners/buttons and auto-focus logic.

- [ ] 4. Sub-agent experience
  - [ ] 4.1 Extend service events (or add helper) to expose parent/child metadata for request nodes.
  - [ ] 4.2 Render request tree navigation (sidebar or breadcrumbs) with slide-in panes for nested selections.
  - [ ] 4.3 Implement settings for depth/filter and honor them when building the view.
  - [ ] 4.4 Ensure nested interception banners/actions apply to the active node.

- [ ] 5. Settings & extensibility hooks
  - [ ] 5.1 Add configuration keys for depth limit, agent filter, telemetry opt-in.
  - [ ] 5.2 Define command/registry for “prompt augmentation providers”; for now provide a stub hook/injection point.
  - [ ] 5.3 Surface a placeholder UI affordance (e.g., “Add Memory/Context”) that calls the provider hook.

- [ ] 6. Rollout & parity
  - [ ] 6.1 Add telemetry distinguishing webview vs. workbench inspector usage.
  - [ ] 6.2 Create experimental command to switch between surfaces at runtime for testing.
  - [ ] 6.3 Update docs + manual test plan covering workbench layout, sub-agent recursion, editing, interception.

## Implementation Notes

- Reuse VS Code’s `SplitView`/`PaneComposite` to animate slide-in panes for sub-agents; ensure tab/focus order stays logical.
- Consider using the existing Chat panel data model (same `IChatModel`) for rendering convenience; map inspector sections to pseudo-chat messages.
- Keep the old webview code path for fallback until telemetry shows confidence.

## Dependencies

- Copilot chat renderer components (and any internal APIs they require).
- VS Code workbench APIs for custom views/panels.
- Existing `ILiveRequestEditorService` events and interception commands.

## Testing Priority

- High: editing + interception parity (dirty state, validation banner, resume/cancel) inside the workbench view.
- High: sub-agent navigation correctness, including depth filtering and slide-in UI.
- Medium: multi-window behavior and docking/detach scenarios.
- Medium: settings toggles + telemetry coverage.
