# Replay Chat Debugging Journey

## What broke and how we fixed it
- Chat view showed only the welcome placeholder; logs reported “provideChatSessionContent missing state…”. Root cause: replay URIs were double-encoded, so the content provider could not find state. Fixes: stop encoding the path on open, double-decode when hydrating, and cache state under all URI variants (encoded/decoded `toString`, `toString(true)`, and `path`).
- Sample replay command still blank because the view could request a resource before state existed. Fix: rebuild the sample snapshot on demand when the composite matches `sample-session`.
- State lookups were brittle; added logging plus `_getState` fallback from composite keys and hydration, and traced all stored keys to diagnose misses.
- Chat rendering stayed empty even after state was found. Cause: turns were emitted under the default Copilot participant and without a request/response pair. Fixes: render all replay history under the replay participant id (`copilot-live-replay`) and add synthetic `ChatRequestTurn2` entries (“Replay summary”, “Replay sections”) before responses so the UI renders content.
- Users hit interception setting write errors, causing “focus did not instantiate” warnings. Workaround: set `"github.copilot.advanced.livePromptEditorInterception": false` manually; provider now logs and continues in memory.

## Lessons learned
- URI handling: let VS Code handle encoding; if you must encode, always decode twice when consuming paths from `vscode.Uri` because the editor encodes once.
- State lookup: cache under every plausible key (`toString`, `toString(true)`, raw and decoded `path`) to survive API variants; log the keys you store and the resource being requested.
- ChatSessionContentProvider expects proper turns: include both request and response turns with the correct participant id; otherwise the UI may show only the welcome/empty state.
- Participant identity matters: using the default Copilot participant id can hide custom content; use a dedicated id consistently in history and session registration.
- Add a built-in sample replay to debug end-to-end without needing live data.
- Persisted settings can fail to write; handle errors, log them, and keep a safe in-memory fallback.

## How to use the replay chat view (custom participant)
- Ensure your `package.json` declares a `chatSessions` entry with a unique `type` (e.g., `copilot-live-replay`), `welcomeTitle`, `welcomeMessage`, and `when` clause; set `canDelegate`/capabilities as needed.
- Register the chat participant and content provider together:
  - `const participant = vscode.chat.createChatParticipant(<type>, handler);`
  - `vscode.chat.registerChatSessionContentProvider(<scheme>, provider, participant);`
  - `vscode.chat.registerChatSessionItemProvider(<scheme>, provider);`
- Use a stable URI scheme and composite key (e.g., `scheme:/<sessionId>::<location>::<requestId>`). Cache state under encoded/decoded variants and hydrate from your service if the view requests before state is cached.
- Populate history with the right participant id: add a lightweight `ChatRequestTurn2` before your `ChatResponseTurn2` blocks so the UI renders. Use your participant id for all turns.
- Gate input by omitting `requestHandler` until the user opts in (e.g., “Start chatting from this replay” command). When enabling, mark the replay active via your service and re-cache state.
- Log at info level for: state caching keys, incoming resources in `provideChatSessionContent`, state hits/misses, hydration results, and handler activation. This makes it obvious which URI variant the UI requested.
- If the view opens but stays blank: check the Copilot Chat output channel for `[LiveReplay]` logs; verify your participant id in history and that a request/response turn pair is present; ensure the scheme in the URI matches the registered provider.
