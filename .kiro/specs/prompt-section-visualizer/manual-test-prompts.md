# Manual Testing Prompts for Prompt Section Visualizer

This document contains sample prompts for manual UI testing. Copy and paste these into the visualizer to test different scenarios.

---

## Test 1: Basic Two-Section Prompt

**Purpose:** Test basic parsing and display

```
<context>This is a simple context section with some basic text.</context><instructions>Please analyze the code and suggest improvements.</instructions>
```

**Expected:**
- Two sections appear: "context" and "instructions"
- Token counts display for each section
- Content is readable and properly formatted

---

## Test 2: Multi-Section Prompt

**Purpose:** Test multiple sections with different content types

```
<context>You are a helpful coding assistant.</context><background>The user is working on a TypeScript project using VS Code.</background><task>Review the following code for potential bugs.</task><constraints>Focus on type safety and performance issues.</constraints>
```

**Expected:**
- Four sections appear with correct tag names
- All sections are collapsible/expandable
- Sections can be reordered via drag-and-drop

---

## Test 3: Code Block Rendering

**Purpose:** Test rich content rendering with code blocks

```
<context>Here's the current implementation:

```typescript
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
```

This function needs optimization.</context><instructions>Suggest performance improvements for large arrays.</instructions>
```

**Expected:**
- Code block renders with syntax highlighting in view mode
- Edit mode shows raw markdown with triple backticks
- Language label "typescript" appears on code block

---

## Test 4: Lists and Formatting

**Purpose:** Test list rendering and text formatting

```
<requirements>The solution must:
- Support TypeScript
- Handle edge cases gracefully
- Include error handling
- Be well-documented</requirements><constraints>**Important:** Do not use any external dependencies.

*Note:* Performance is critical for this feature.</constraints>
```

**Expected:**
- Lists render as bullet points in view mode
- Bold and italic text render correctly in view mode
- Edit mode shows raw markdown syntax

---

## Test 5: Nested Tags (Advanced)

**Purpose:** Test nested XML structure handling

```
<context><background>The project uses React and TypeScript.</background><current-state>We have 50+ components that need refactoring.</current-state></context><instructions>Create a refactoring plan.</instructions>
```

**Expected:**
- Nested structure is parsed correctly
- Visual hierarchy shows nesting
- All sections are editable

---

## Test 6: Malformed XML

**Purpose:** Test error handling with invalid XML

```
<context>This tag is not closed<instructions>This is a valid section</instructions><another>This one is also unclosed
```

**Expected:**
- Error indicators appear for malformed sections
- Valid sections still render correctly
- Error messages are clear and helpful

---

## Test 7: Large Content

**Purpose:** Test performance with large prompts

```
<context>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.</context><instructions>Analyze this lengthy context and provide detailed recommendations. Consider all aspects including performance, maintainability, scalability, and user experience. Make sure to address edge cases and potential issues that might arise in production environments.</instructions><constraints>The solution must be production-ready, well-tested, and follow best practices. It should handle errors gracefully and provide meaningful feedback to users.</constraints>
```

**Expected:**
- All sections load without lag
- Token counts are accurate (should show high usage warnings)
- Scrolling is smooth
- UI remains responsive

---

## Test 8: Mixed Content

**Purpose:** Test combination of code, lists, and text

```
<context>Current implementation has several issues:

1. Memory leaks in event handlers
2. Inefficient rendering
3. Missing error boundaries

Here's the problematic code:

```javascript
useEffect(() => {
  window.addEventListener('resize', handleResize);
  // Missing cleanup!
}, []);
```
</context><solution>We need to:
- Add proper cleanup in useEffect
- Implement React.memo for expensive components
- Add error boundaries at route level

**Priority:** High
**Estimated effort:** 2-3 days</solution>
```

**Expected:**
- Numbered list renders correctly
- Code block with JavaScript syntax highlighting
- Bullet list renders properly
- Bold text for "Priority" and "Estimated effort"

---

## Test 9: Empty and Whitespace

**Purpose:** Test edge cases with empty content

```
<context></context><instructions>   </instructions><task>This has actual content</task>
```

**Expected:**
- Empty sections display appropriately
- Whitespace-only sections are handled
- Non-empty section displays normally

---

## Test 10: Special Characters

**Purpose:** Test handling of special characters and symbols

```
<context>Testing special chars: & < > " ' / \ @ # $ % ^ * ( ) { } [ ]</context><code>const regex = /[a-zA-Z0-9_]+/g;</code><math>Calculate: x² + y² = z²</math>
```

**Expected:**
- Special characters display correctly
- HTML entities are properly escaped
- No rendering issues or XSS vulnerabilities

---

## Test 11: Real-World Example

**Purpose:** Test with realistic coding assistant prompt

```
<role>You are an expert TypeScript developer specializing in VS Code extensions.</role><context>I'm building a webview-based feature that visualizes prompt sections. The extension uses:
- TypeScript 5.x
- VS Code Extension API
- React for the webview UI
- Existing tokenizer service for token counting</context><current-code>```typescript
export class PromptSectionVisualizerProvider implements WebviewViewProvider {
  resolveWebviewView(webviewView: WebviewView): void {
    // Implementation here
  }
}
```</current-code><task>Help me implement the message passing between the extension host and the webview. I need bidirectional communication for:
1. Sending parsed sections to the webview
2. Receiving edit events from the webview
3. Handling state synchronization</task><constraints>- Must use VS Code's standard postMessage API
- Should handle errors gracefully
- Need to maintain type safety</constraints>
```

**Expected:**
- All sections render with appropriate content
- Code block has TypeScript syntax highlighting
- Lists and formatting work correctly
- Token counts are reasonable (likely 200-400 tokens total)

---

## Testing Checklist

Use this checklist while testing:

### Display & Parsing
- [ ] Sections parse and display correctly
- [ ] Tag names appear in headers
- [ ] Token counts show for each section
- [ ] Total token count displays

### Editing
- [ ] Click "Edit" button activates editor
- [ ] Content is editable in textarea
- [ ] "Save" button updates content
- [ ] "Cancel" button reverts changes
- [ ] Token count updates after save

### Section Management
- [ ] Collapse/expand buttons work
- [ ] Drag-and-drop reordering works
- [ ] "Add Section" creates new section
- [ ] "Delete Section" shows confirmation
- [ ] Delete removes section correctly

### Rich Content
- [ ] Code blocks render with highlighting
- [ ] Lists render as bullet/numbered points
- [ ] Bold and italic text render
- [ ] Edit mode shows raw markdown
- [ ] Mode switching preserves content

### Error Handling
- [ ] Malformed XML shows errors
- [ ] Valid sections still work
- [ ] Error messages are clear
- [ ] No crashes or freezes

### Performance
- [ ] Large prompts load quickly
- [ ] UI remains responsive
- [ ] Scrolling is smooth
- [ ] No memory leaks

### Theming
- [ ] Light theme looks good
- [ ] Dark theme looks good
- [ ] High contrast theme works
- [ ] Colors are readable

### Accessibility
- [ ] Keyboard navigation works
- [ ] Tab order is logical
- [ ] Focus indicators visible
- [ ] Screen reader compatible (if available)

---

## Quick Test Commands

1. **Launch Extension Development Host:**
   - Press `F5` in VS Code

2. **Open Visualizer:**
   - `Ctrl+Shift+P` → "Prompt Section Visualizer: Show Visualizer"

3. **Test Workflow:**
   - Copy a test prompt from above
   - Paste into visualizer input (if available) or use command
   - Verify expected behavior
   - Try editing, reordering, adding, deleting sections
   - Check token counts and rendering

4. **Switch Themes:**
   - `Ctrl+K Ctrl+T` → Select different theme
   - Verify visualizer adapts correctly

---

## Notes

- Token counts will vary based on the tokenizer model in use
- Some rich content rendering may depend on VS Code's markdown renderer
- Performance tests should be done with the Extension Development Host running
- Report any crashes, errors, or unexpected behavior

Happy testing! 🚀
