# Standalone Prompt Visualizer Completion Plan

## Context
- The inline `/visualize-prompt` flow already renders sections via `NativeChatRenderer` and `PromptVisualizerChatParticipant`.
- The standalone panel (`PromptSectionVisualizerProvider`) now displays the shared `VisualizerState`, but it still has a bespoke renderer and lacks parity with inline chat.
- Commands (`github.copilot.promptSectionVisualizer.*`) mutate `IPromptStateManager`, so both surfaces receive the same state updates; we need to ensure the UX is consistent.

## Goals
1. Share one rendering pipeline between inline chat and the standalone panel.
2. Ensure add/edit/delete/reorder/collapse actions stay in sync across both surfaces.
3. Deliver a polished panel experience (token warnings, progressive rendering, load-more, UX feedback).
4. Document the flow and harden tests for maintainability.

## Scope & Constraints
- Includes Copilot Chat inline renderer (`NativeChatRenderer`) and the Prompt Visualizer webview (`PromptSectionVisualizerProvider` + `media/promptSectionVisualizer.*`).
- Reuses existing state services (`IPromptStateManager`, `ITokenUsageCalculator`, `IContentRenderer`) rather than introducing new data sources.
- Excludes broader chat architecture changes (e.g., new slash commands) unless required for parity; record any stretch work as follow-ups.
- All UX copy / telemetry names must stay backward compatible unless the owning PM approves a change.

## Phase Breakdown

### Phase 0 – Spec Hygiene (this document)
- Move standalone renderer artifacts into `.kiro/specs/prompt-section-visualizer/standalone-renderer/`.
- Capture updated goals, risks, and acceptance gates before coding.

### Phase 1 – Rendering Abstraction (Plan item #1)
- Ship `IPromptSectionRenderer` contracts and semantic part definitions in `common/rendering`.
- Convert `NativeChatRenderer` into an adapter that consumes renderer parts.
- Author unit tests that snapshot renderer parts for a variety of `VisualizerState` inputs (empty, warnings, long content).
- **Exit criteria**: inline `/visualize-prompt` flow still renders via chat, tests green.

### Phase 2 – Webview Adapter & Incremental Updates (Plan items #1–#2)
- Replace bespoke HTML assembly in `PromptSectionVisualizerProvider` with a renderer adapter that drives DOM updates via the new parts API.
- Extend `IPromptStateManager` with granular events (CRUD, order, collapse, pagination) and ensure both chat + panel subscribe.
- Update the webview script to patch only the affected nodes (preserve scroll / focus).
- **Exit criteria**: editing from chat or panel results in matching updates without re-render flashes; unit tests cover event fan-out.

### Phase 3 – Feature Parity (Plan item #3)
- Port token badge levels, breakdown copy, and progressive rendering (batch size + load-more affordance).
- Integrate `IContentRenderer` for inline previews (code blocks, markdown) and provide a deterministic empty-state.
- **Exit criteria**: feature parity checklist signed off via manual test doc, including pagination + warnings.

### Phase 4 – Commands, UX, Telemetry (Plan item #4)
- Ensure `github.copilot.promptSectionVisualizer.show` is discoverable in the Command Palette and Copilot chat menus.
- Focus the panel when toggled, surface gentle notifications for missing prompt/flag disabled, and emit telemetry (`show`, `toggle`, `switchSurface`).
- **Exit criteria**: telemetry schema reviewed, command contributions verified in VS Code, UX copy finalized.

### Phase 5 – Documentation & Testing (Plan item #5)
- Refresh the manual test doc with inline ↔ panel parity scenarios and `/visualize-prompt` instructions.
- Add renderer/provider unit tests plus e2e coverage (promptVisualizerHybridMode path).
- Record remaining limitations or follow-ups in this folder for the next iteration.
- **Exit criteria**: docs merged, automated tests green, acceptance checklist satisfied.

## Work Plan

### 1. Rendering Abstraction
- Create `IPromptSectionRenderer` in `common/rendering` that emits semantic parts (header, warning, section, command button, divider, load-more, progress).
- Refactor `NativeChatRenderer` to act as an adapter that converts parts into `ChatResponseStream` calls.
- Replace the HTML assembly in `PromptSectionVisualizerProvider` with a webview adapter that listens for renderer parts and updates the DOM.
- Add unit tests for the renderer to ensure consistent output from a given `VisualizerState`.

**Dependencies**: `IPromptStateManager`, `IContentRenderer`, `ITokenUsageCalculator`.

### 2. Incremental Panel Updates
- Extend `IPromptStateManager` to expose granular events (section added/removed/updated, order change, collapse toggled).
- Update the webview script to patch only affected DOM nodes (preserve scroll/focus).
- Ensure commands invoked from both chat and panel flow through the shared command IDs so the state manager emits the expected events.

**Deliverables**: Updated state events, DOM diff logic, tests covering add/edit/delete/toggle from both entry points.

### 3. Feature Parity: Tokens & Pagination
- Port token warning badging, breakdown text, and progressive rendering (batch size/load-more) from inline renderer to the panel adapter.
- Integrate `IContentRenderer` output so sections with renderable elements can show previews (code blocks, etc.) in the panel just like in chat.
- Provide a clear empty-state message when no sections are present.

**Deliverables**: shared warning logic, load-more button, optional content previews.

### 4. Command & UX Polish
- Ensure `github.copilot.promptSectionVisualizer.show` appears in the Command Palette and Copilot chat view menu (view/title contribution).
- Focus the view when the command runs and log telemetry (show/toggle/switch) for adoption tracking.
- Surface non-blocking notifications when feature flag is disabled or when the user needs to paste a prompt first.

**Deliverables**: `package.json` contribution updates, telemetry events, UX copy updates.

### 5. Documentation & Testing
- Update `docs/prompt-visualizer-manual-test.md` with the new panel instructions, slash commands, and shared-state explanation.
- Add renderer and provider unit tests plus e2e coverage (promptVisualizerHybridMode scenario) to guarantee inline/panel parity.
- Document remaining limitations (e.g., custom view container fallback) for future follow-ups.

**Deliverables**: refreshed docs, test plan, defect tracking list if needed.

## Acceptance Checklist
- [x] Renderer abstraction merged and covered by unit tests.
- [x] Standalone panel and inline chat display identical sections (visual + token data).
- [x] Add/Edit/Delete/Move/Collapse actions work interchangeably from chat and panel.
- [x] `Prompt Visualizer: Show` command focuses the panel reliably and logs telemetry.
- [x] Updated manual test doc and automated tests green.

## Risks & Open Questions
- Chat renderer parity requires touching proposed APIs; confirm availability in the VS Code version we target.
- Streaming `VisualizerState` updates into the panel may surface diffing bugs; budget time for DOM testing.
- Token calculations currently rely on cached data—need to ensure both surfaces do not double-trigger expensive work.
- Telemetry naming could clash with existing events; coordinate with the telemetry owner before emitting new IDs.

## Status
- 2024-03-18: Phase 1 (Rendering Abstraction) implemented in code – shared `IPromptSectionRenderer` service now drives both inline chat and upcoming panel adapters, with dedicated unit tests in place (`promptSectionRenderer.spec.ts`). Next up: Phase 2 webview adapter leveraging the new parts stream.
- 2024-03-19: Phase 2 webview adapter landed – the standalone provider now streams renderer parts into the panel webview, listens for granular `PromptStatePatch` updates, and patches DOM nodes incrementally via `media/promptSectionVisualizerClient.js`. Tests cover the new renderer pipeline plus provider messaging (`promptSectionVisualizerProvider.spec.ts`).
- 2024-11-27: Phases 3–5 completed – token breakdown (including overhead), progressive rendering parts, and rich content previews now behave consistently between inline chat and the standalone panel; commands surface friendly notices for disabled/empty states; telemetry events cover show/toggle/mode-switch flows; docs and prompt visualizer tests updated.
