# Requirements Document: Prompt Request Auditor

## Introduction

The Prompt Request Auditor upgrades the Prompt Section Visualizer so that it audits **real Copilot Chat requests** sent to the LLM, instead of only replaying whatever the user types into `/visualize-prompt`.

It must:

- Listen to the ChatML request pipeline (`IChatMLFetcher`).
- Extract the actual user-facing prompt content from `Raw.ChatMessage[]`.
- Feed that into the existing visualizer state manager.
- Keep `/visualize-prompt` as a debug-friendly entry point that uses the same underlying state.

## Glossary

- **ChatML** – The internal message format (`Raw.ChatMessage[]`) used between Copilot Chat and the LLM endpoint.
- **Prompt Section Visualizer** – The existing feature that parses XML-tagged content (e.g., `<context>...</context>`) into sections with token counts and warnings.
- **VisualizerState** – The internal state managed by `PromptStateManager` describing sections, totals, and token breakdowns.
- **ChatML Fetcher** – `IChatMLFetcher` implementation (`ChatMLFetcherImpl`) responsible for sending ChatML requests and emitting telemetry events.

## Requirements

### Requirement 1 – Subscribe to ChatML Requests

**User Story:**  
As an engineer debugging Copilot Chat prompts, I want the visualizer to stay in sync with actual ChatML requests so that I can trust it as an accurate audit of what was sent to the LLM.

**Acceptance Criteria**

1. THE Prompt Request Auditor SHALL subscribe to `IChatMLFetcher.onDidMakeChatMLRequest` in the node extension host.
2. WHEN a ChatML request is made, THEN the auditor SHALL receive an event that includes `messages: Raw.ChatMessage[]` and `model`.
3. WHEN the Prompt Section Visualizer is disabled (`chat.promptSectionVisualizer.enabled == false`), THEN the auditor SHALL NOT react to ChatML events.

### Requirement 2 – Extract User Prompt Text

**User Story:**  
As a developer reviewing a prompt, I want the auditor to focus on the **user-authored prompt text** so that I can see exactly what the user asked the LLM, in section form.

**Acceptance Criteria**

1. THE auditor SHALL filter `event.messages` to **user-role** entries (`Raw.ChatRole.User`).
2. THE auditor SHALL select the **last** user message in the array as the basis for visualization.
3. THE auditor SHALL use `getTextPart` (from `platform/chat/common/globalStringUtils`) to extract plain text from the selected message’s `content`.
4. WHEN the extracted text is empty or whitespace, THEN the auditor SHALL skip updating the visualizer state (no-op).

### Requirement 3 – Drive `PromptStateManager` from ChatML

**User Story:**  
As a developer, I want the existing visualizer UI (inline and panel) to show sections and token counts that match the actual request, without re-implementing parsing or rendering.

**Acceptance Criteria**

1. THE auditor SHALL invoke `IPromptStateManager.updatePrompt(promptText)` with the extracted user text.
2. THE auditor SHALL rely on existing parsing, tokenization, and rendering logic; it SHALL NOT introduce separate parsing paths for ChatML.
3. WHEN `updatePrompt` throws or fails, THEN the auditor SHALL log via `ErrorHandler.handleStateSyncError` and SHALL NOT crash the chat pipeline.
4. WHEN `updatePrompt` completes successfully, THEN both:
   1. Inline `/visualize-prompt` responses, and
   2. The standalone Prompt Visualizer panel  
   SHALL show sections and token counts derived from the same `VisualizerState`.

### Requirement 4 – Preserve `/visualize-prompt` as Debug Only

**User Story:**  
As a power user or engineer, I want to continue using `/visualize-prompt` for quick one-off checks, even though the visualizer is now following live ChatML traffic.

**Acceptance Criteria**

1. THE `/visualize-prompt` command SHALL continue to work as today, using the current chat input to call `updatePrompt`.
2. WHEN `/visualize-prompt` runs **after** a recent ChatML request, THEN the resulting sections and token counts SHALL be consistent with what was last derived from ChatML for the same user prompt, barring local edits.
3. DOCUMENTATION in `.kiro/specs/prompt-request-auditor` or `docs/prompt-visualizer-manual-test.md` SHALL clearly describe that `/visualize-prompt` is primarily a **debug view**, while the panel can follow live requests.

### Requirement 5 – Testing & Safety

**User Story:**  
As a maintainer, I want this integration to be safe and testable so that future changes to the request pipeline don’t silently break the visualizer.

**Acceptance Criteria**

1. UNIT tests for `PromptStateManager` SHALL be updated to construct a manager with a stub `IChatMLFetcher` whose `onDidMakeChatMLRequest` is an `Event`.
2. EXISTING prompt visualizer tests (`promptStateManager`, `promptSectionRenderer`, `nativeChatRenderer`, `promptSectionVisualizerProvider`) SHALL continue to pass without modification to their semantics.
3. THE auditor SHALL NOT modify the ChatML payload, retry logic, or endpoint selection; it is strictly a **read-only** observer.

