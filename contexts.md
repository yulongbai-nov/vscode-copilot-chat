# Project Context - Token Usage Visualization Enhancement
**Last Updated:** October 2, 2025
**Current Task:** Implement dedicated UI and token-aware prompts for token usage monitoring
**Branch:** feature/token-usage-visualization
**Phase:** Plan (Setting up for Phase 1 implementation)

## Active Todo List (Session Recovery)
1. ⏳ Fix tokenUsageStatusBar.ts location - Move from common/ to vscode-node/
2. ⏳ Register status bar item in extension activation
3. ⏳ Implement token management commands
4. ⏳ Enhance ChatResponseTokenUsagePart with actions
5. ⏳ Create token-aware prompt builder
6. ⏳ Implement agent orchestration with token awareness
7. ⏳ Add package.json contributions
8. ⏳ Test and validate implementation

## Ranked Entities

### Tier 1 (Critical - Active Work)
- `src/extension/conversation/common/tokenUsageStatusBar.ts` — **NEEDS MOVE** to vscode-node/ folder (currently in wrong location preventing VS Code API imports)
- `docs/token-visualization-enhancement-context.md` — Master implementation plan and design document
- `.journals/2025-10-02-token-visualization-enhancement.md` — Active implementation journal
- `manage_todo_list` — 8 todos tracking implementation phases

### Tier 2 (Implementation Targets)
- `src/extension/conversation/vscode-node/tokenUsageStatusBar.ts` — Target location for status bar (to be moved)
- `src/extension/conversation/vscode-node/tokenManagementCommands.ts` — Command handlers (to be created)
- `src/extension/conversation/vscode-node/tokenAwareAgentOrchestrator.ts` — Agent orchestration (to be created)
- `src/extension/prompts/common/tokenAwarePromptBuilder.ts` — Token-aware prompt injection (to be created)
- `src/extension/conversation/common/chatResponseTokenUsagePart.ts` — Add toMarkdownWithActions() method
- `package.json` — Add command contributions, config settings

### Tier 3 (Existing Infrastructure)
- `src/extension/prompts/common/tokenUsageMetadata.ts` — IPromptTokenUsageInfo interface
- `src/extension/conversation/common/chatResponseTokenUsagePart.ts` — Existing token display (summary/detailed modes)
- `src/platform/configuration/common/configurationService.ts` — Configuration keys
- Extension activation code (location TBD) — Where status bar will be registered

## Technical Context

### Architecture Challenge
**Problem:** Files in `common/` folders follow platform-agnostic pattern and cannot use direct VS Code API imports
**Solution:** Move `tokenUsageStatusBar.ts` to `vscode-node/` folder for full VS Code API access
**Pattern:** common/ = platform-agnostic, vscode-node/ = VS Code-specific Node.js implementation

### Token Usage Thresholds
- 🟢 0-60%: Optimal - Continue normally
- 🟡 60-80%: Caution - Monitor usage
- ⚠️ 80-95%: Warning - Recommend actions (compact/delegate)
- ⛔ 95%+: Critical - Require immediate action (clear history)

### User Requirements
1. **Dedicated UI Component:** Status bar item (not just markdown) with persistent visibility
2. **Token-Aware Prompts:** Inject token usage into prompts so model can self-manage context

## Current Status

### Completed
- ✅ TokenUsageStatusBarItem class created with proper structure
- ✅ Rich tooltip with markdown formatting
- ✅ Threshold-based visual indicators
- ✅ Command integration prepared (`github.copilot.chat.showDetailedTokenUsage`)

### In Progress (Phase 1)
- ⏳ Move file to correct location
- ⏳ Register in extension activation
- ⏳ Wire up lifecycle management
- ⏳ Test status bar updates

### Pending
- Phase 2-8 implementation (see journal for details)

## Next Steps
1. Move tokenUsageStatusBar.ts to vscode-node/ folder
2. Find and examine extension activation code
3. Register status bar item with proper lifecycle
4. Implement command handlers for token management
5. Test basic status bar functionality

## Validation Checklist
- [ ] Compilation passes in watch tasks
- [ ] Status bar appears when token usage updates
- [ ] Visual indicators match thresholds
- [ ] Tooltip displays correctly
- [ ] Commands are registered and executable
- [ ] No console errors or warnings

---

## Previous Context (Archived)
Previous work on shared dev volumes enhancement completed September 25, 2025.
See git history for details: commits a78d0c1 through 4d9b9e3.
