# Prompt Visualizer Hybrid Mode E2E Tests

## Overview

This document describes the end-to-end tests for the Prompt Visualizer hybrid mode functionality. These tests verify that the visualizer works correctly in both standalone webview mode and inline chat mode, and that users can switch between modes seamlessly.

## Requirements Tested

- **7.1**: Standalone webview panel mode support
- **7.2**: Inline chat mode support
- **7.4**: Native component integration
- **7.5**: Mode configuration and switching

## Test Scenarios

### 1. Standalone Mode Rendering

**Objective**: Verify that the visualizer renders correctly in standalone webview panel mode.

**Steps**:
1. Open the Prompt Visualizer in standalone mode
2. Load a prompt with multiple sections (context, instructions, examples)
3. Verify all sections are displayed
4. Verify token counts are shown
5. Verify action buttons (Edit, Delete, Collapse) are present
6. Verify sections can be collapsed/expanded
7. Verify the webview uses native VS Code styling

**Expected Results**:
- All sections render with correct content
- Token counts are accurate
- Action buttons are functional
- UI matches VS Code theme
- Performance is acceptable for large prompts (20+ sections)

### 2. Inline Chat Mode Rendering

**Objective**: Verify that the visualizer renders correctly inline in chat responses.

**Steps**:
1. Open Copilot Chat
2. Use `/visualize-prompt` command with a structured prompt
3. Verify sections render using native chat components
4. Verify markdown formatting is correct
5. Verify action buttons use `ChatResponseCommandButtonPart`
6. Verify token warnings use `ChatResponseWarningPart`
7. Verify progress indicators for large prompts

**Expected Results**:
- Sections render inline in chat
- Native chat components are used (not custom HTML)
- Visual consistency with other chat responses
- Action buttons are clickable and functional
- Progressive rendering works for 15+ sections

### 3. Mode Switching

**Objective**: Verify that users can switch between inline and standalone modes.

**Steps**:
1. Start in standalone mode
2. Switch to inline mode via configuration
3. Verify the visualizer now renders in chat
4. Switch back to standalone mode
5. Verify the visualizer returns to webview panel
6. Test mode persistence across VS Code restarts

**Expected Results**:
- Mode switching is smooth and immediate
- No data loss when switching modes
- Configuration persists correctly
- User is notified of mode changes

### 4. Feature Parity Between Modes

**Objective**: Verify that core features work in both modes.

**Features to Test**:
- Section editing
- Section deletion
- Section addition
- Section reordering
- Token counting
- Collapse/expand
- Syntax highlighting
- Theme support

**Steps**:
1. Test each feature in standalone mode
2. Switch to inline mode
3. Test each feature in inline mode
4. Compare functionality and behavior

**Expected Results**:
- All core features work in both modes
- Behavior is consistent between modes
- No features are mode-specific (except UI presentation)
- Performance is comparable

### 5. Large Prompt Handling

**Objective**: Verify that both modes handle large prompts efficiently.

**Steps**:
1. Create a prompt with 20+ sections
2. Test rendering in standalone mode
3. Verify progressive rendering indicators
4. Test rendering in inline mode
5. Verify batching and progress updates
6. Measure rendering time

**Expected Results**:
- Standalone mode renders all sections
- Inline mode uses progressive rendering (batches of 5)
- Progress indicators are shown for 10+ sections
- Rendering completes in < 2 seconds for 20 sections
- UI remains responsive during rendering

### 6. Empty and Error Cases

**Objective**: Verify graceful handling of edge cases.

**Test Cases**:
- Empty prompt (no sections)
- Malformed XML tags
- Very long section content
- Special characters in content
- Sections with no content

**Expected Results**:
- Appropriate error messages are shown
- No crashes or exceptions
- User can recover from errors
- Helpful guidance is provided

## Manual Testing Checklist

Since automated e2e tests require full extension host integration, manual testing is recommended:

- [ ] Standalone mode renders correctly
- [ ] Inline chat mode renders correctly
- [ ] Mode switching works
- [ ] Edit section in standalone mode
- [ ] Edit section in inline mode
- [ ] Delete section in both modes
- [ ] Add section in both modes
- [ ] Reorder sections in both modes
- [ ] Collapse/expand sections in both modes
- [ ] Token counts are accurate in both modes
- [ ] Large prompts (20+ sections) render correctly
- [ ] Progressive rendering works in inline mode
- [ ] Theme changes apply to both modes
- [ ] Configuration persists across restarts
- [ ] No console errors or warnings
- [ ] Performance is acceptable

## Implementation Notes

The hybrid mode implementation consists of:

1. **PromptVisualizerController** (`controller.ts`): Manages mode detection and switching
2. **NativeChatRenderer** (`nativeChatRenderer.ts`): Renders sections using native chat APIs
3. **PromptVisualizerChatParticipant** (`chatParticipant.ts`): Handles chat commands
4. **SectionEditorService** (`sectionEditorService.ts`): Provides editing capabilities

Unit tests for these components are located in:
- `src/extension/promptSectionVisualizer/test/vscode-node/`

## Future Enhancements

Potential improvements for e2e testing:

1. Automated UI testing using VS Code's test framework
2. Scenario-based testing with predefined prompts
3. Performance benchmarking for large prompts
4. Accessibility testing with screen readers
5. Cross-platform testing (Windows, macOS, Linux)
6. Integration with CI/CD pipeline

## References

- Design Document: `.kiro/specs/chat-api-migration/design.md`
- Requirements: `.kiro/specs/chat-api-migration/requirements.md`
- Unit Tests: `src/extension/promptSectionVisualizer/test/`
