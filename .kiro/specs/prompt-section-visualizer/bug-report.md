# Bug Report: Prompt Section Visualizer Issues

**Date:** 2025-11-05
**Reporter:** User
**Status:** Open
**Priority:** High

---

## Overview

Two bugs were discovered during manual testing of the Prompt Section Visualizer using the "Load Test Prompt into Visualizer" command.

---

## Bug #1: Add Section Dialog Auto-Popup

### Description
The "Add Section" dialog appears automatically when the visualizer loads, instead of only appearing when the user clicks the "Add Section" button.

### Expected Behavior
- The dialog should be hidden by default
- The dialog should only appear when:
  1. User clicks the "Add Section" button
  2. User presses `Ctrl+N` (or `Cmd+N` on Mac)

### Actual Behavior
- The dialog pops up immediately when the visualizer renders
- This happens every time content is loaded via "Load Test Prompt into Visualizer"

### Reproduction Steps
1. Enable test command in settings:
   ```json
   {
     "github.copilot.chat.promptSectionVisualizer.enabled": true,
     "github.copilot.chat.promptSectionVisualizer.enableTestCommand": true
   }
   ```
2. Press `F5` to launch Extension Development Host
3. Run command: `Ctrl+Shift+P` → "Load Test Prompt into Visualizer"
4. Paste any test prompt (e.g., from Test 1 in manual-test-prompts.md)
5. **Bug:** Dialog appears immediately without user interaction

### Affected Files
- `media/promptSectionVisualizer.js` - Dialog rendering and show/hide logic
- `media/promptSectionVisualizer.css` - Dialog styling (may have CSS override)

### Investigation Notes
- Dialog HTML is rendered with `style="display: none;"` (line ~495 in promptSectionVisualizer.js)
- `showAddSectionDialog()` is only called on button click or Ctrl+N (lines 119, 294)
- Possible causes:
  1. CSS `.dialog-overlay` class may have a `display: flex` rule overriding inline style
  2. JavaScript may be calling `showAddSectionDialog()` during render cycle
  3. Event listener may be triggering unintentionally

### Suggested Fix
1. Check `media/promptSectionVisualizer.css` for `.dialog-overlay` display rules
2. Ensure no CSS rule sets `display: flex` or `display: block` on `.dialog-overlay`
3. Verify `showAddSectionDialog()` is not called during `render()` or `renderContent()`
4. Add defensive check in `render()` to ensure dialog stays hidden after re-render

---

## Bug #2: Code Block Syntax Highlighting Not Working

### Description
Code blocks in sections are not rendered with syntax highlighting. Instead, they appear as plain text with a black box border around them.

### Expected Behavior
- Code blocks should render with syntax highlighting based on language
- TypeScript code should show colored syntax (keywords, strings, functions, etc.)
- Code block should have a language header (e.g., "TYPESCRIPT")
- Should match the design shown in the CSS with proper styling

### Actual Behavior
- Code appears as plain monochrome text
- Black box border appears around the code block
- No syntax highlighting colors
- Language label may or may not appear

### Reproduction Steps
1. Use "Load Test Prompt into Visualizer" command
2. Load Test 3 from `manual-test-prompts.md`:
   ````
   <context>Here's the current implementation:

   ```typescript
   function calculateTotal(items: Item[]): number {
     return items.reduce((sum, item) => sum + item.price, 0);
   }
   ```

   This function needs optimization.</context><instructions>Suggest performance improvements for large arrays.</instructions>
   ````
3. **Bug:** Code block shows plain text without syntax highlighting

### Visual Evidence
User provided screenshot showing:
- Code block with black border
- Plain text rendering (no color)
- Text: `typescript function calculateTotal(items: Item[]): number { return items.reduce((sum, item)`

### Affected Files
- `src/extension/promptSectionVisualizer/node/contentRenderer.ts` - Code block detection and HTML generation
- `media/promptSectionVisualizer.js` - Code block rendering in webview
- `media/promptSectionVisualizer.css` - Code block styling

### Investigation Notes
- Content renderer detects code blocks and creates HTML structure
- CSS has extensive code block styling (lines 600-800 in promptSectionVisualizer.css)
- CSS includes language-specific color hints (lines 700-750)
- Webview may not have access to VS Code's syntax highlighting engine
- Possible causes:
  1. HTML structure from content renderer doesn't match CSS selectors
  2. Syntax highlighting requires additional library (e.g., Prism.js, Highlight.js)
  3. VS Code webview CSP (Content Security Policy) blocking inline styles
  4. Missing CSS classes on rendered code elements

### Current Implementation
From `contentRenderer.ts`, code blocks are detected and converted to HTML with:
- `.code-block-container` wrapper
- `.code-block-header` with language label
- `<pre><code>` tags for content
- Language class on code element (e.g., `language-typescript`)

### Suggested Fix Options

**Option 1: Add Syntax Highlighting Library**
1. Include a lightweight syntax highlighter (Prism.js or Highlight.js)
2. Add library to webview HTML in `promptSectionVisualizerProvider.ts`
3. Update CSP to allow the library
4. Apply highlighting in `renderContent()` after HTML is inserted

**Option 2: Use VS Code's Built-in Highlighting**
1. Use VS Code's `vscode.languages.getLanguages()` and tokenization APIs
2. Pre-render syntax-highlighted HTML in content renderer
3. Pass highlighted HTML to webview

**Option 3: Simple Color Coding (Quick Fix)**
1. Add basic CSS rules for common tokens (keywords, strings, numbers)
2. Use regex to wrap tokens in `<span>` tags with classes
3. Apply in content renderer before sending to webview

**Recommended:** Option 1 (Prism.js) - Most reliable and maintainable

---

## Testing Instructions

After fixes are applied, verify:

### Bug #1 Testing
1. Load visualizer with test prompt
2. Confirm dialog is hidden
3. Click "Add Section" button → dialog should appear
4. Close dialog → dialog should hide
5. Press `Ctrl+N` → dialog should appear
6. Press `Escape` → dialog should hide

### Bug #2 Testing
1. Load Test 3 from manual-test-prompts.md
2. Verify code block has:
   - Syntax highlighting with colors
   - Language header showing "TYPESCRIPT"
   - Proper border and background styling
   - Readable and visually distinct from plain text
3. Test with other languages (JavaScript, Python, JSON) from other test prompts

---

## Related Files

### Primary Files to Modify
- `media/promptSectionVisualizer.js` - Webview JavaScript
- `media/promptSectionVisualizer.css` - Webview styles
- `src/extension/promptSectionVisualizer/node/contentRenderer.ts` - Content rendering logic
- `src/extension/promptSectionVisualizer/vscode-node/promptSectionVisualizerProvider.ts` - Webview provider (for CSP and script loading)

### Reference Files
- `.kiro/specs/prompt-section-visualizer/manual-test-prompts.md` - Test cases
- `.kiro/specs/prompt-section-visualizer/design.md` - Design specifications
- `.kiro/specs/prompt-section-visualizer/requirements.md` - Requirements

---

## Additional Context

### Test Command Setup
```json
{
  "github.copilot.chat.promptSectionVisualizer.enabled": true,
  "github.copilot.chat.promptSectionVisualizer.enableTestCommand": true
}
```

### How to Test
1. Press `F5` to launch Extension Development Host
2. `Ctrl+Shift+P` → "Load Test Prompt into Visualizer"
3. Copy test prompts from `manual-test-prompts.md`
4. Paste and verify behavior

---

## Notes for Implementing Agent

- Both bugs are in the webview rendering layer
- No changes needed to backend services (parser, state manager, token calculator)
- Focus on `media/` directory files
- Test thoroughly with all test cases in manual-test-prompts.md
- Ensure accessibility is maintained (ARIA labels, keyboard navigation)
- Follow existing code style and patterns
- Run `npm run lint` and `npm run typecheck` before committing

---

## Success Criteria

- [ ] Add Section dialog only appears on user action (button click or Ctrl+N)
- [ ] Dialog stays hidden after visualizer re-renders
- [ ] Code blocks display with syntax highlighting
- [ ] All languages in test prompts render correctly
- [ ] No regression in other visualizer features
- [ ] All existing tests pass
- [ ] Manual testing with all 11 test cases successful
