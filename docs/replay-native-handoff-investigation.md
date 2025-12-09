# Replay → Native Copilot Chat Handoff – Investigation (Dec 2025)

## Context / Goal
- We want “Start chatting from this replay” to move the user into a normal Copilot chat session (default participant, model picker, attachments) seeded with the replay payload/history.
- The replay tab should stay projection-only (debug/meta). Live turns should come from the standard Copilot experience (no replay participant interleave, no “preview” label on the active chat).

## Current State
- Replay uses a custom chat session provider (`copilot-live-replay` scheme). Payload view renders with the default agent ID, but the session is still labeled as a replay provider and shows the “preview” badge.
- Activation (`startReplayChat`) focuses the replay session; sending uses `ChatParticipantRequestHandler` with the default agent ID but still under the replay session type.

## What APIs/Commands We Looked For
- **VS Code chatSessions proposed API** (`src/extension/vscode.proposed.chatSessionsProvider.d.ts`):
  - `ChatSessionItemProvider.provideNewChatSessionItem` (deprecated) exists only for providers we register.
  - `vscode.chat.registerChatSessionContentProvider(scheme, provider, participant…)` lets us create sessions for schemes we own.
  - No surface to create/focus the built-in Copilot session or inject arbitrary history into it.
- **Commands in repo**:
  - Only panel focus: `workbench.panel.chat.view.copilot.focus`.
  - No command found to spawn/fork the default Copilot chat with supplied history/payload.
- **Providers we own**:
  - Replay (`copilot-live-replay`), Copilot CLI (`copilotcli`), Copilot Cloud (`copilot-cloud-agent`). All are custom session types we register; none is the default Copilot chat.

## Attempts / Constraints
- Tried to find a way to seed history into the native Copilot chat: not exposed in current API surface.
- We can open/focus only sessions for schemes we register; the default Copilot provider is contributed outside this repo.
- We can render payload with the default agent ID inside the replay session, but the session label/type remains custom (and shows “preview”).

## Feasible Interim (within current APIs)
- Keep the replay tab projection-only.
- On “Start chatting from this replay,” open/focus a fork session we own (e.g., `copilot-live-replay-fork`) seeded with the replay payload and using the default agent ID; enable model picker/attachments there.
- Caveat: still a custom session type (likely “preview” badge); not the true native Copilot chat.

## Open Questions / Concerns
- Is there an internal Copilot session API/command (outside this repo) to create/fork the default chat with injected history? If yes, we can wire it; if not, we’re limited to custom providers.
- UX: Do we accept a custom “fork” session with Copilot responses but a non-native label/preview badge, or block until native handoff is possible?
- Persistence: If we create a fork provider, should it persist sessions or stay ephemeral like replay?
- Telemetry: How to attribute forked sessions vs. replay projection?

## Next Steps (if no native API)
1) Implement a “replay-fork” session provider that seeds payload and uses default agent ID, projection-only replay view remains.
2) Clearly label the fork as “Forked from <session> turn <id>” and surface a breadcrumb/toast.
3) Keep monitoring for a native Copilot session creation API to remove the custom session/preview badge.***
