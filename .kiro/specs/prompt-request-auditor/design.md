# Design Document: Prompt Request Auditor

## Overview

This feature evolves the existing **Prompt Section Visualizer** so that it no longer relies solely on the chat input text or `/visualize-prompt` command, but instead attaches directly to the **real ChatML payload** that Copilot sends to the LLM.

We do this by:

- Subscribing to `IChatMLFetcher.onDidMakeChatMLRequest`, which fires for every ChatML request.
- Extracting the latest user-facing prompt text from the `Raw.ChatMessage[]` payload.
- Feeding that text into `IPromptStateManager.updatePrompt`, which already parses XML-like sections, computes tokens, and drives both:
  - Inline `/visualize-prompt` chat rendering (via `PromptVisualizerChatParticipant` + `NativeChatRenderer`).
  - The standalone webview panel (`PromptSectionVisualizerProvider` + `promptSectionVisualizerClient.js`).

The net result is: **every real Copilot Chat request becomes auditable** in the visualizer, while `/visualize-prompt` remains a debug entry point.

## Current Architecture (Before This Change)

- `IChatMLFetcher` (`src/platform/chat/common/chatMLFetcher.ts` and `src/extension/prompt/node/chatMLFetcher.ts`):
  - Builds the final `Raw.ChatMessage[]` payload.
  - Sends it via an `IChatEndpoint`.
  - Emits `onDidMakeChatMLRequest({ messages, model, source, tokenCount })` after successful submission.
- Prompt visualizer:
  - `PromptStateManager` (`node/promptStateManager.ts`) manages `VisualizerState`:
    - Parses XML-like tags via `ISectionParserService`.
    - Computes tokens via `ITokenUsageCalculator`.
    - Tracks per-section warnings, collapse state, and patches.
  - `PromptSectionRenderer` (`node/promptSectionRenderer.ts`) turns `PromptSection[]` into semantic parts.
  - `NativeChatRenderer` renders parts into `vscode.ChatResponseStream` for inline `/visualize-prompt`.
  - `PromptSectionVisualizerProvider` + `promptSectionVisualizerClient.js` render the same parts into a webview for the standalone panel.
  - `/visualize-prompt`:
    - Reads `request.prompt` from chat.
    - Calls `PromptStateManager.updatePrompt(promptText)`.
    - Uses the resulting state to render a debug view.

In this flow, the visualizer sees **what the user typed**, but not necessarily the exact ChatML payload actually sent (e.g., after intent handling, rewriting, system prompts, or additional context).

## Proposed Architecture

We extend `PromptStateManager` so that it **listens to ChatML requests** and uses them as the primary source of truth for the visualizer:

- Inject `IChatMLFetcher` into `PromptStateManager` and subscribe to `onDidMakeChatMLRequest`.
- For each event:
  - Filter `event.messages` down to the **user role** messages (`Raw.ChatRole.User`).
  - Take the **last user message**, and extract its text via `getTextPart` from `platform/chat/common/globalStringUtils`.
  - Call `updatePrompt(promptText)` with that extracted text.
- Respect the existing `PromptSectionVisualizerEnabled` config:
  - If the visualizer is disabled, ignore these events entirely.

This wires **the actual request** directly into `VisualizerState`, without changing:

- How `PromptStateManager` parses, tokenizes, or warns.
- How the inline chat or panel renderers work.
- How `/visualize-prompt` behaves (it simply remains a manual debug trigger that shares the same state manager).

### Data Flow

```text
Copilot Chat ➜ IChatMLFetcher.fetchMany(...)
             ➜ onDidMakeChatMLRequest { messages, model, tokenCount }
             ➜ PromptStateManager._updateFromChatRequest(messages)
             ➜ PromptStateManager.updatePrompt(promptText)
             ➜ VisualizerState + PromptStatePatch
             ➜ NativeChatRenderer (inline) / Webview client (panel)
```

### Surface Modes

- **Inline chat (/visualize-prompt)**:
  - Still calls `PromptStateManager.updatePrompt` based on the chat input when manually invoked.
  - Now benefits from having the same `VisualizerState` that has been following the real ChatML payloads between calls.
- **Standalone Prompt Visualizer panel**:
  - Shows the latest sections/tokens derived from the actual ChatML request.
  - Updates incrementally as ChatML requests are made (subject to existing patch handling).

## Components & Responsibilities

- `IChatMLFetcher` (existing):
  - Emits `onDidMakeChatMLRequest` after each successful ChatML request, with the full `Raw.ChatMessage[]`.
- `PromptStateManager` (extended):
  - Subscribes to `IChatMLFetcher.onDidMakeChatMLRequest`.
  - `_updateFromChatRequest(event)`:
    - Guards on `isEnabled()`.
    - Extracts the last `Raw.ChatRole.User` message.
    - Uses `getTextPart(message.content)` to get plain text.
    - Calls `updatePrompt(promptText)` and lets existing parsing/token logic run.
- `NativeChatRenderer` / `PromptSectionVisualizerProvider` (unchanged):
  - Continue to render based on `VisualizerState`.

## Edge Cases & Limitations

- Only **user-role text** is considered for visualization:
  - System prompts, tool calls, and assistant messages are intentionally not included in the section parsing.
  - This keeps the visualizer focused on the XML-tagged prompt authored or visible to the user.
- If the last user message doesn’t contain XML-like tags:
  - `updatePrompt` will produce either zero sections or a “no sections found” message; this is acceptable and matches the current behavior.
- For multi-turn chats:
  - Each ChatML request typically includes history; we only look at the latest user message per request.
  - This means the visualizer shows **the active prompt being sent**, not the entire conversation log.

## Telemetry & Debugging

- Existing `VisualizerTelemetryService` continues to track parse, render, and tokenization metrics.
- ChatML-level telemetry (`ChatMLFetcherTelemetry`) already tracks engine usage; this feature is read-only on that layer.
- `/visualize-prompt` remains a convenient way to:
  - Re-render the current `VisualizerState` in chat.
  - Compare what the debug command sees vs. what the real request pipeline used (ideally identical for the user-facing prompt).

## Future Enhancements

- Expand `_updateFromChatRequest` to:
  - Optionally include **system** or **tool** messages in a separate “metadata” section for deeper auditing.
  - Support multiple concurrent conversations by tracking a conversation/session ID.
- Add a toggle in the panel (“Follow Live Requests”) to pause/resume automatic updates from ChatML.

