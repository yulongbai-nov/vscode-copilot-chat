# Replay Flows & Interrupt Handling

## Use Case 1: Manual Replay (Read-only)

- User edits prompt in Live Request Editor.
- User clicks “Replay edited prompt.”
- Replay session is created (read-only); no model call.
- User reviews bubbles; may inspect diffs via hover action.
- Optional: user clicks “Start chatting from this replay” to continue in the fork.

```mermaid
sequenceDiagram
    participant User
    participant LRE as Live Request Editor
    participant RB as Replay Builder
    participant RS as Replay Session (chat view)
    participant Model

    User->>LRE: Edit prompt sections
    User->>LRE: Click "Replay edited prompt"
    LRE->>RB: Build projection (trimmed payload)
    RB-->>RS: Create/update replay session (read-only)
    RS-->>User: Display replay bubbles (collapsed system/history, edited chips)
    Note over RS: No model call<br/>Interception/auto-override off<br/>Edit/delete disabled
    User->>RS: (Optional) Click "Start chatting from this replay"
    RS-->>User: Enable input, show breadcrumb/toast<br/>(still no model call yet)
```

## Use Case 2: Intercept → Replay → Resume

- User has “Pause & review” on (interception).
- Send is intercepted; LRE is focused.
- User edits; clicks “Replay edited prompt.”
- Replay session is created (read-only); user reviews.
- User resumes send (no fork), or optionally forks to continue in replay session.

```mermaid
sequenceDiagram
    participant User
    participant LRE as Live Request Editor
    participant RB as Replay Builder
    participant RS as Replay Session (chat view)
    participant Fetcher as ChatML Fetcher
    participant Model

    User->>LRE: Send message (interception ON)
    LRE-->>User: Intercepted banner
    User->>LRE: Edit prompt
    User->>LRE: Click "Replay edited prompt"
    LRE->>RB: Build projection (trimmed payload)
    RB-->>RS: Create/update replay session (read-only)
    RS-->>User: Display replay bubbles
    alt User resumes send
        User->>LRE: Click "Resume send"
        LRE->>Fetcher: Send trimmed edited payload
        Fetcher->>Model: Invoke model
    else User forks to chat from replay
        User->>RS: Click "Start chatting from this replay"
        RS-->>User: Enable input, show breadcrumb/toast
        Note over RS,Fetcher: Original intercepted turn is still resumed/cancelled per user action
    end
```

## Use Case 3: Continue from Replay and Send

- User in replay session clicks “Start chatting from this replay” (input enabled).
- User composes a new message in the replay session and sends.
- Forked session uses the trimmed edited history as context; no changes to original session.

```mermaid
sequenceDiagram
    participant User
    participant RS as Replay Session (chat view, forked)
    participant Fetcher as ChatML Fetcher
    participant Model

    User->>RS: Click "Start chatting from this replay"
    RS-->>User: Enable input, show breadcrumb/toast
    User->>RS: Type new message
    User->>RS: Send message
    RS->>Fetcher: Send request with trimmed edited history + new user message
    Fetcher->>Model: Invoke model
    Model-->>RS: Stream response
    RS-->>User: Display response (replay session only; original session untouched)
```

## Interrupt Handling (Graceful)

- **Empty/invalid projection**: Show “Nothing to replay” with link back to LRE; do not create replay session.
- **Mapping failure**: Show error toast; keep original session untouched.
- **Trimmed prompt**: Show banner “Prompt was trimmed; replay may omit truncated content.”
- **Interception state changes** (user cancels/turn discarded): Auto-dismiss replay session or mark it stale; keep original session intact.
- **Re-replay on same turn**: Replace existing replay (Option A); keep one-level in-memory “Restore previous replay” if persistence is off.
- **Concurrency** (multiple turns): One replay fork per source turn; labeling includes source session/turn. If user triggers replay on a new turn, switch context or show selector.
- **Interception/auto-override in fork**: Off by default; if enabled manually, re-enable edit/delete and allow normal scroll; otherwise keep edit/delete disabled and auto-scroll to latest.

## Defaults Recap
- Caps: render up to 30 sections; show “(N more)” affordance.
- Entry: explicit “Replay edited prompt” action; read-only by default.
- Continue: “Start chatting from this replay” toggles input and focus with breadcrumb/toast.
- One fork per turn; replay payload seeded from trimmed messages; projection is display-only.
