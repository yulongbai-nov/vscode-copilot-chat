# Live Request Editor – Interception Consistency Notes

## Symptoms

- When Prompt Interception pauses a request, VS Code keeps the chat participant in a paused state.  
- If the user starts another turn (either in the same conversation or a different chat widget) before pressing **Resume** or **Cancel**, the host refuses to enqueue the new turn (“previous request still paused”).  
- Meanwhile the Live Request Editor webview may now target a different session, so the original Resume/Cancel controls disappear or point at the wrong `sessionId`. Result: no way to resolve the pause → chat appears frozen.

## Root Cause

We only cancel pending interceptions when:

1. The user explicitly clicks Cancel/Resume.  
2. The chat session is disposed (`onDidDisposeChatSession`).

Any other context change (new request, model change, switching chat widgets) leaves the old `PauseController` unresolved even though the user has moved on. Because VS Code exposes the pause state as read-only (`onDidChangePauseState`), we can’t force the host to un-pause from the UI; the Live Request Editor service has to resolve or cancel the pending interception itself.

## Low-Intrusion Solution

Use the plumbing we already own to guarantee that only one interception can exist:

1. **Pre-flight cancellation hook**  
   - Before every new request, call into `ILiveRequestEditorService` with the upcoming `{sessionId, location, modelId}`.  
   - If the service detects an unresolved interception for any other turn, auto-cancel it with a reason (`contextChanged:newRequest`, etc.).  
   - This resolves the `PauseController`, so VS Code unblocks and the new turn can start.

2. **Cancel on model/session changes**  
   - Treat model switches, conversation swaps (panel ↔ side panel), and prompt rebuilds as context changes using the same helper.  
   - Reuse the existing telemetry/event surfaces so the Live Request Editor webview shows “Request discarded because chat context changed.”

3. **No host UI hacks**  
   - We can’t gray out VS Code’s chat input—there’s no API for that. The mutex already lives in the Live Request Editor service; keeping it in sync is the real fix.

## Edge Cases To Cover

- Starting another turn in the same conversation while paused → cancel the old interception, let the latest turn own the editor.  
- Switching to a different chat session/location while paused → auto-cancel the stale request.  
- Changing the selected model mid-intercept → cancel with `reason: 'contextChanged:model'`.  
- Updating prompt/tool configuration (e.g., turning tools on/off or changing tool schemas) → cancel with `reason: 'contextChanged:toolConfig'` so the inspector rebuilds the sections with the new tool metadata.  
- Creating a brand-new chat session (e.g., launching the inline chat while the panel is paused) → cancel existing intercepts with `reason: 'contextChanged:newSession'` so the new session can start cleanly.  
- Subagent/automation turns (which skip interception) should not trigger cancellations.  
- Session disposal is already handled; keep emitting the current `sessionDisposed` reason.  
- Toggling the interception feature or disabling the Live Request Editor entirely should cancel any pending pause (`reason: 'modeDisabled'` or `reason: 'editorDisabled'`) to keep the chat host unblocked.

### Expected Behavior Matrix

| Trigger | Suggested `reason` | Expected behavior |
| --- | --- | --- |
| User sends another message in the same conversation | `contextChanged:newRequest` | Cancel pending intercept, reuse editor for the new turn |
| User switches to a different chat session/location | `contextChanged:sessionSwitch` | Cancel all pending intercepts so the new surface can send immediately |
| User creates a brand-new chat session (inline chat, new panel) | `contextChanged:newSession` | Cancel pending intercepts before the new session performs its first send |
| Model picker selection changes mid-intercept | `contextChanged:model` | Cancel pending intercept and rebuild prompt metadata for the newly selected model |
| Tool configuration changes (enabling/disabling tools) | `contextChanged:toolConfig` | Cancel pending intercept and trigger a fresh prompt render with the updated tool set |
| Prompt Interception mode toggled off | `modeDisabled` | Cancel pending intercept and remove the status bar warning |
| Live Request Editor feature flag disabled | `editorDisabled` | Cancel pending intercepts and clear cached requests |
| Chat session disposed | `sessionDisposed` | Remove cached request + history entries and cancel the pause |
| Subagent (`isSubagent`) request starts | _no cancellation_ | Interception is skipped, so the main pause remains untouched |

With this hook in place, interception remains the single source of truth, but stale pauses can no longer block future turns even when the user jumps between conversations.
