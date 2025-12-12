# Live Request Editor – User Guide

This guide explains how to use the Live Request Editor, the metadata view, and the Auto Override controls. It is aimed at Copilot Chat users (engineers, auditors, support) rather than implementers.

## Setup
- Enable `github.copilot.chat.advanced.livePromptEditorEnabled`.
- Open the **Live Request Editor** view (`github.copilot.liveRequestEditor.toggle` or the Copilot side panel).
- Dock the **Live Request Metadata** tree (`github.copilot.liveRequestMetadata`) under the chat input for quick status.
- Optional: open the **Live Request Payload** view (`github.copilot.liveRequestPayload`) to pin/drag a raw `messages[]` JSON pane alongside the editor.
- Optional settings:
  - `github.copilot.chat.promptInspector.sessionMetadata.fields` (default `["sessionId","requestId"]`, app-scoped).
  - `github.copilot.chat.promptInspector.extraSections` (`requestOptions`, `rawRequest` outlines).
  - Auto-apply edits: `...autoOverride.enabled`, `...autoOverride.previewLimit`, `...autoOverride.scopePreference`.

## What you see
- **Live Request Editor (webview)**: section cards with Edit/Delete/Restore, token meter, interception/Auto banners.
- **Conversation picker**: enabled once at least one request is captured; labels include the surface (`Panel`, `Editor`, `Terminal`, etc.), the conversation/debug name, and the last 6 chars of the session id to disambiguate concurrent sessions.
- **Metadata strip**: shows model/location/budget plus Request ID and Session ID side-by-side so you can confirm you are editing the latest turn.
- **Live Request Metadata (tree)**: read-only metadata + token budget + optional outlines.

Example tree layout:
```
Metadata
  Session: 5f8c...e2    (copy on click)
  Request: req-123...   (tooltip shows full id)
  Model: gpt-4o
  Location: Chat Panel
  Interception: Pending
  Dirty: Clean
Token Budget: 35% · 3,500/10,000 tokens
Request Options
  temperature: 0.2
  messages: Array(2)
    [0] role: system
Raw Request Payload
  model: gpt-4o
  location: panel
  messages: Array(3)
  metadata
    requestId: req-123
```
- Idle state: “Live Request Editor idle — send a chat request to populate metadata.”
- When `sessionMetadata.fields` is empty, the metadata section hides but the token node/placeholder remains.
- Outline nodes truncate after a safety budget and surface “... entries truncated ...” markers.
- Models that reject sampling controls (e.g., `o1`, `o1-mini`, any `gpt-5.1*` including codex / codex-max / mini) have `temperature` / `top_p` / `n` stripped before send, so the Request Options node omits them.

## Modes
- **Send normally**: Sends immediately; editor is view-only.
- **Pause & review every turn**: Pauses every turn until you Resume/Cancel in the banner.
- **Auto-apply saved edits**: Captures prefix sections once, then applies your saved edits automatically on later turns.
  - No saved edits yet → next turn pauses (shows first `previewLimit` sections) until you Resume/Cancel.
  - Saved edits already exist → no pause; every turn auto-applies them and sends.

## Auto-apply controls (banner)
- **Capture new edits** (primary): Arms a capture; the next turn pauses, you edit/save, and new edits replace the old set.
- **Pause next turn** (one-shot): Pauses the next turn without changing mode; overrides stay applied.
- **Remove saved edits**: Clears stored edits (session/workspace/global) and re-arms capture if Auto-apply is active.
- **Where to save edits**: Pick Session / Workspace / Global scope (persisted).
- **Sections to capture**: Set how many prefix sections show while capturing (min 1, max 10).

## How edits flow
- Edits/deletes in the editor mutate the pending `EditableChatRequest`.
- On Resume, the edited messages are sent to the model and logged; the chat transcript remains unchanged (it still shows what you originally typed).
- Use the metadata outlines or “Show diff” chips to see exactly what was sent.

## Tips & troubleshooting
- If the metadata tree looks blank, ensure the feature flag is on and the view is expanded; the tree only updates while visible.
- Copy commands exist on every metadata/outline leaf; status text appears briefly in the status bar.
- If Auto Override feels inert, confirm `...autoOverride.enabled` is true; otherwise Auto behaves like Off.
- Subagent/tool requests bypass interception by design; they still appear in the Subagent Prompt Monitor (if enabled).
