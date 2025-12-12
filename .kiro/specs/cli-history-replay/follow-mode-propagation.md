# Live Request Editor Follow Mode Change Propagation

This note captures how session/selection changes propagate between the Live Request Editor (LRE) webview, the extension host, and the raw payload view when **Auto-follow latest** is on vs off.

## Recommendation (Human Cognition)

For debugging and prompt forensics, “surprising context switches” are the biggest source of confusion: the user’s attention and mental model stay on *what they selected*, but the UI silently moves to *a different session*.

Recommendation:

- **Auto-follow OFF** should not auto-switch the active session, even if new requests arrive for other sessions.
- **Auto-follow ON** is for monitoring: the active session may switch to the newest intercepted request.
- **Make switching explicit**: the Auto-follow toggle is the only “mode switch”.

## Propagation Model (Source Of Truth)

Even though the dropdown and toggle *feel* like “two-way binding”, the implementation is the idiomatic React/extension-host pattern:

- **Extension host is the source of truth** for `activeSessionKey` and `followLatest`.
- Webviews send **events** (`selectSession`, `setFollowMode`) to request changes.
- Extension host broadcasts **state** (`stateUpdate`) back to webviews.

## Flow Overview (Mermaid)

```mermaid
sequenceDiagram
  autonumber
  participant User as User
  participant LRE_UI as Live Request Editor (webview)
  participant LRE as LiveRequestEditorProvider (ext host)
  participant Service as LiveRequestEditorService (ext host)
  participant Payload as LiveRequestPayloadProvider (ext host)
  participant Payload_UI as Raw Payload View (webview)

  alt Auto-follow OFF
    User->>LRE_UI: Select conversation in dropdown
    LRE_UI->>LRE: postMessage(selectSession)
    LRE->>LRE: set activeSessionKey + currentRequest
    LRE->>Payload: executeCommand(setActiveSession)
    LRE-->>LRE_UI: postMessage(stateUpdate)
    Payload-->>Payload_UI: postMessage(state)

    Service-->>LRE: onDidChange(new request)
    LRE-->>LRE_UI: postMessage(stateUpdate sessions list)
    Note over LRE_UI: Active session stays unchanged
  else Auto-follow ON (newest intercepted wins)
    Service-->>LRE: onDidChange(new request)
    LRE->>LRE: activate latest request
    LRE->>Payload: executeCommand(setActiveSession)
    LRE-->>LRE_UI: postMessage(stateUpdate)
    Payload-->>Payload_UI: postMessage(state)
  end
```

## Decisions (Current)

- **Single mode**: “Stick” is just Auto-follow OFF (`followLatest=false`); no separate state.
- **Workspace-scoped persistence** is the default (captured requests are not global).
- **Flash cue (implemented)**: the LRE border flashes when the active session changes due to Auto-follow being ON.

## Questions For Review

- None (MVP): no separate “Jump to latest” button; use the Auto-follow switch and dropdown selection.
