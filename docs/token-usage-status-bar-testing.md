# Token Usage Status Bar - Testing Guide

## Overview
This guide explains how to test the token usage status bar visual indicators using the debug extension host.

## Test Commands

Five test commands have been added to visualize different token usage thresholds:

### 1. **Optimal Usage (40%)** - 🟢
```
Command: github.copilot.chat.test.tokenUsage.optimal
```
- **Visual:** Green circle (🟢)
- **Background:** Default
- **Tooltip:** "🟢 Optimal: Good token efficiency"
- Tests the 0-60% threshold

### 2. **Caution Usage (65%)** - 🟡
```
Command: github.copilot.chat.test.tokenUsage.caution
```
- **Visual:** Yellow circle (🟡)
- **Background:** Default
- **Tooltip:** "🟡 Caution: Moderate usage"
- Tests the 60-80% threshold

### 3. **Warning Usage (85%)** - ⚠️
```
Command: github.copilot.chat.test.tokenUsage.warning
```
- **Visual:** Warning sign (⚠️)
- **Background:** Warning color (orange/yellow)
- **Tooltip:** "⚠️ Warning: Approaching token limit" with action links
- Tests the 80-95% threshold

### 4. **Critical Usage (97%)** - ⛔
```
Command: github.copilot.chat.test.tokenUsage.critical
```
- **Visual:** Stop sign (⛔)
- **Background:** Error color (red)
- **Tooltip:** "⛔ Critical: Immediate action required" with action links
- Tests the 95%+ threshold

### 5. **Clear Status Bar**
```
Command: github.copilot.chat.test.tokenUsage.clear
```
- Hides the status bar item
- Clears current token usage data

## Testing Steps

### 1. Launch Extension in Debug Mode

1. Open VS Code with this workspace
2. Press `F5` or use the debug panel
3. Select "Launch Copilot Extension - Watch Mode"
4. Wait for the Extension Development Host to open

### 2. Open Command Palette

Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)

### 3. Test Each Threshold

Type and execute each command to see the status bar update:

```
> GitHub Copilot: Test Token Usage - Optimal
> GitHub Copilot: Test Token Usage - Caution
> GitHub Copilot: Test Token Usage - Warning
> GitHub Copilot: Test Token Usage - Critical
> GitHub Copilot: Test Token Usage - Clear
```

### 4. Verify Visual Indicators

For each command, check the status bar (bottom-right corner):

#### Status Bar Text Format
```
[EMOJI] [TOKENS_USED]/[MAX_TOKENS] ([PERCENTAGE]%)
```

Example: `🟢 51,200/128,000 (40.0%)`

#### Tooltip Content

Hover over the status bar item to see the rich tooltip with:
- Model name
- Token usage bar visualization
- Status and recommendations
- Top 3 token consumers
- Clickable action links (for Warning/Critical)

### 5. Test Command Links

For Warning and Critical states:
- Hover over the tooltip
- Click on the action links:
  - "Compact Context"
  - "Use Subagent"
  - "Clear History"
  - "View Details"

These commands currently show placeholder messages indicating they're not yet implemented.

## Expected Behavior

### Visual Progression

| Threshold | Icon | Background | Status Text |
|-----------|------|------------|-------------|
| 0-60%     | 🟢   | Default    | Optimal     |
| 60-80%    | 🟡   | Default    | Caution     |
| 80-95%    | ⚠️   | Warning    | Warning     |
| 95-100%   | ⛔   | Error      | Critical    |

### Status Bar Position

- **Alignment:** Right side of status bar
- **Priority:** 100 (appears near other important items like language mode)
- **Name:** "Copilot Token Usage"
- **Command:** Clicking opens "Show Detailed Token Usage" (placeholder)

### Tooltip Format

```markdown
### 🎯 Token Usage Monitor

**Model:** gpt-4

**Usage:** 51,200 / 128,000 tokens (40.0%)

`████████░░░░░░░░░░░░`

🟢 **Optimal:** Good token efficiency

**Top Token Consumers:**
- workspace-context: 17,920 (35%)
- conversation-history: 12,800 (25%)
- system-instructions: 7,680 (15%)

---

💡 *Click for detailed breakdown*
```

## Mock Data

The test commands generate realistic mock token usage data:

- **Max Tokens:** 128,000 (typical GPT-4 context window)
- **Total Tokens:** Calculated based on target percentage
- **Model:** gpt-4
- **Sections:**
  - System Instructions (15%)
  - User Query (10%)
  - Workspace Context (35%)
  - Conversation History (25%)
  - Code Context (15%)

## Troubleshooting

### Status Bar Not Appearing

1. Ensure the extension is running in debug mode
2. Check the Output panel for "[TokenUsageStatusBar]" logs
3. Verify commands are registered: Check for "[TokenUsageTestCommands]" in logs
4. Try running the "Clear" command first, then a test command

### Command Not Found

1. Ensure compilation completed successfully (check watch tasks)
2. Reload the Extension Development Host window (Ctrl+R)
3. Check the extension host console for errors

### Tooltip Not Showing

1. Hover directly over the status bar item
2. Wait ~500ms for tooltip to appear
3. Check if markdown rendering is enabled in VS Code settings

## Next Steps

After visual testing confirms the status bar works correctly:

1. **Integration Testing:** Connect status bar to real token usage data
2. **Real Commands:** Implement actual token management command handlers
3. **Configuration:** Add settings to enable/disable status bar
4. **Persistence:** Save/restore token usage across sessions
5. **Events:** Wire up automatic updates from conversation events

## Files Involved

- `/src/extension/conversation/vscode-node/tokenUsageStatusBar.ts` - Status bar implementation
- `/src/extension/conversation/vscode-node/tokenUsageTestCommands.ts` - Test commands
- `/src/extension/extension/vscode-node/contributions.ts` - Registration
- `/src/extension/prompts/common/tokenUsageMetadata.ts` - Token usage data types
