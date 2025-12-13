# VS Code Copilot Chat (fork): Prompt Inspector + Replay Tooling

This repo is a fork of `GitHub.copilot-chat` focused on **prompt inspection, surgical editing, and native replay/fork workflows** for debugging and audits. It keeps upstream Copilot Chat behavior while adding tools to view the **exact request payload** (`messages[]` + options) and to fork edited prompts into new sessions (without mutating the original history).

## Highlights (what this fork adds)

- **Live Request Editor (LRE)**: inspect the composed prompt before send; in review modes you can edit/delete/restore sections and see what will actually be sent.
- **Live Request Metadata view**: a dockable tree that stays in sync with the active conversation (session id, request id, model, location, token budget, dirty/interception state).
- **Live Request Payload view**: a dedicated, draggable, read-only payload view for debugging/copying the live raw request structure.
- **Replay/fork workflows**
  - **Chat timeline replay**: render edited prompts (including deletions) as a replayable chat view.
  - **Copilot CLI replay**: create a *new* Copilot CLI session and seed it with a reconstructed history so you can continue chatting natively in the fork.
- **Copilot CLI session QoL**: session rename (with persistence), “new terminal session”, and a replay sample command for quick validation.
- **Offline/intranet packaging support**: hardened VSIX build pipeline + internal branding/view icons.

## Enable the Prompt Inspector / LRE

The core entry flag is:

```json
{
  "github.copilot.advanced.livePromptEditorEnabled": true
}
```

Optional (common) settings:

```json
{
  "github.copilot.advanced.livePromptEditorInterception": true,
  "github.copilot.chat.liveRequestEditor.timelineReplay.enabled": true,
  "github.copilot.chat.promptInspector.extraSections": ["requestOptions", "rawRequest"]
}
```

Note: older settings under `github.copilot.chat.advanced.*` are migrated automatically; prefer `github.copilot.advanced.*`.

## Docs and Specs (index)

- **Live Request Editor**
  - User guide: `docs/live-request-editor-user-guide.md`
  - Architecture notes: `docs/liveRequestEditor.md`
  - State machine: `docs/live-request-editor-state-machine.md`
  - Content kinds: `docs/live-request-editor-content-kinds.md`
  - Interception consistency: `docs/live-request-editor-interception-consistency.md`
  - Spec source of truth: `.kiro/specs/request-logger-prompt-editor/design.md`
- **CLI replay / session rename**
  - Handoff: `docs/cli-history-replay-handoff.md`
  - Specs: `.kiro/specs/cli-history-replay/design.md`
- **Chat view APIs reference (core vs proposed)**
  - `docs/copilot-chat-view-apis.md`
- **Tooling walkthroughs**
  - Read file tool: `docs/read-file-tool-walkthrough.md`
  - Run subagent tool: `docs/run-subagent-tool-walkthrough.md`
  - Tools overview: `docs/tools.md`
- **Specs index**
  - `.kiro/specs/README.md`

## Development (build/run/verify)

Prereqs:
- Node `22.x` (see `.nvmrc`)
- `npm` (repo is `package-lock.json`-based; `pnpm` is not officially supported)

Common commands:
- Install: `npm ci`
- Build: `npm run compile`
- Watch: `npm run watch`
- Verify (quad): `npm run lint && npm run typecheck && npm run compile && npm run test:unit`
- Auto-fix changed files: `npm run fix:changed` (or `npm run fix:staged`)

Run in VS Code:
1. Open the repo in VS Code
2. Press `F5` (Run Extension) to launch an Extension Development Host
3. Enable the settings above and open the Prompt Inspector via the “View Prompt” affordance or `Copilot: Show Prompt Inspector`

Spec-first workflow:
- See `agent-prompt.md` and `.kiro/specs/` for the current design/requirements/tasks.

## Installing and getting updates (VSIX / intranet)

- Install a `.vsix` via `Extensions: Install from VSIX…`
- Scripted installs: `code --install-extension ./copilot-chat-*.vsix --force`
- For private galleries, configure `extensions.gallery` in `settings.json` (see VS Code docs).

## Views and icons

- Chat Debug: `assets/icon-chat-debug.svg`
- Context Inspector: `assets/icon-context-inspector.svg`
- Live Request Metadata: `assets/icon-live-request-metadata.svg`
- Live Request Editor: `assets/icon-live-request-editor.svg`
- Live Request Payload: `assets/live-request-editor.svg`
- Subagent Prompt Monitor: `assets/icon-subagent-monitor.svg`
- Extension icon: `assets/icon-strong-octocat.svg`

## Notes

- This fork still uses upstream Copilot services; keep VS Code on a recent stable build for compatibility.
