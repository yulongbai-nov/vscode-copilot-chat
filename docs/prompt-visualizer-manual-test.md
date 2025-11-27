# Prompt Visualizer Manual Test Guide

This guide walks through the hands-on verification steps for the Prompt Section Visualizer in both standalone and inline chat modes. Use it before publishing a replayed feature batch or when validating regressions reported by users.

## Prerequisites

1. **Hydrate the simulation cache** so `/visualize-prompt` has data to render:
   ```bash
   npx --yes tsx script/hydrateSimulationCache.ts
   ```
2. **Enable the visualizer** (if it is still behind a flag):
   - Set `github.copilot.chat.promptSectionVisualizer.enabled` to `true` in `settings.json`.
   - Optional: change `github.copilot.chat.promptSectionVisualizer.renderMode` to `inline`, `standalone`, or `auto` to exercise specific modes.
3. **Use a prompt with multiple sections** for consistent coverage. Example:
   ```xml
   <context>
   Shared context about the repo
   </context>
   <instructions>
   Explain how to port the prompt visualizer
   </instructions>
   <examples>
   Example 1…
   </examples>
   ```

## Quick usage (inline chat)

1. Open Copilot Chat (`View › GitHub Copilot › Chat`).
2. Paste or type the structured prompt (the XML block above or any prompt that uses `<tag>...</tag>` sections). The visualizer only works when at least one tagged section is present.
3. Run `/visualize-prompt` in the same message. You can either keep the XML in the box when you send the command or type `/visualize-prompt` and immediately paste the XML on the next line.
4. The inline visualizer streams the sections with token counts, warnings, and action buttons. Use `/edit-section <tag>` for follow-up edits or re-run `/visualize-prompt` after changing the prompt text.

## Standalone mode checklist

1. From the Command Palette, run `Prompt Visualizer: Show` (or open the dedicated view).
2. Paste the sample prompt above.
3. Verify:
   - All sections render with token counts and warning badges.
   - Edit/Delete/Collapse buttons appear for each section and execute without errors.
   - Collapsing a section updates the UI and persists when reopening the view (if `persistCollapseState` is enabled).
   - Adding a new section through the UI updates the state manager and the reconstructed prompt.
   - Large prompts (20+ sections) keep the webview responsive (<2 seconds to render) and show progress indicators.
4. Switch the VS Code theme (light/dark/high contrast) and confirm the visualizer re-themes automatically.

## Inline chat mode checklist

1. Open Copilot Chat and run `/visualize-prompt` with the sample prompt.
2. Validate:
   - Sections render inline using native chat markdown/command button parts (no custom HTML).
   - Token warnings use `ChatResponseWarningPart` and action buttons are clickable.
   - Progressive rendering batches appear for 10+ sections, with load-more/progress messaging.
3. Run `/edit-section instructions`:
   - The participant surfaces the section content plus an `Edit in Editor` button.
   - After editing externally and updating the state, run `/visualize-prompt` again to confirm updates.
4. Trigger `/visualize-prompt` with malformed tags and ensure the chat participant returns a helpful error instead of throwing.
5. Delete a section via chat follow-up buttons and confirm the state updates in both inline and standalone modes.

## Mode switching & persistence

1. Toggle `github.copilot.chat.promptSectionVisualizer.renderMode` between `inline`, `standalone`, and `auto`.
2. Restart VS Code after each change to confirm the setting persists and the controller reports the correct current mode.
3. Verify the `/visualize-prompt` command respects the configured mode:
   - `inline`: renders exclusively in chat.
   - `standalone`: focuses the panel but still provides follow-up actions in chat.
   - `auto`: chooses the best mode based on context.

## Regression checks

- Run `npm run test:unit -- src/extension/promptSectionVisualizer/test/vscode-node/chatParticipant.spec.ts src/extension/promptSectionVisualizer/test/vscode-node/nativeChatRenderer.spec.ts`.
- Watch the VS Code developer tools console for warnings/errors while performing the manual steps.
- Ensure `.lfsconfig` and `.gitignore` prevent any `test/simulation/cache/**/*.sqlite` files from being staged after the run (`git status` should stay clean).

Document any deviations and link this guide in replay PR descriptions so reviewers can reproduce the validation steps quickly. For deeper scenario coverage see `test/e2e/promptVisualizerHybridMode.md`.
