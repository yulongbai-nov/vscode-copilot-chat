# Design Document: Chat API Migration

## Overview

This design document outlines the migration of the Prompt Section Visualizer from a custom WebView-based UI to VS Code's native Copilot Chat rendering APIs. The migration will leverage `ChatResponseMarkdownPart`, `ChatResponseCommandButtonPart`, `ChatResponseWarningPart`, and other native components to achieve visual consistency with the Copilot Chat interface while reducing code complexity and maintenance burden.

The migration will preserve all existing functionality (section parsing, token counting, editing, state management) while replacing the custom HTML/CSS/JavaScript rendering layer with native VS Code APIs.

## Architecture

### Current Architecture (Before Migration)

```
┌─────────────────────────────────────────────────────────────┐
│                    Extension Host                            │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  PromptSectionVisualizerProvider                   │    │
│  │  (WebviewViewProvider)                             │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│  ┌────────────────▼───────────────────────────────────┐    │
│  │  PromptStateManager                                │    │
│  │  - Section CRUD operations                         │    │
│  │  - State synchronization                           │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│  ┌────────────────▼───────────────────────────────────┐    │
│  │  Services Layer                                    │    │
│  │  - SectionParserService                            │    │
│  │  - TokenUsageCalculator                            │    │
│  │  - ContentRenderer                                 │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                      │
                      │ postMessage
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    WebView                                   │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Custom HTML/CSS/JavaScript                        │    │
│  │  - promptSectionVisualizer.js (1000+ lines)        │    │
│  │  - promptSectionVisualizer.css (custom styling)    │    │
│  │  - Manual DOM manipulation                         │    │
│  │  - Custom event handling                           │    │
│  │  - Custom accessibility implementation             │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### New Architecture (After Migration)

```
┌─────────────────────────────────────────────────────────────┐
│                    Extension Host                            │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  PromptVisualizerChatParticipant                   │    │
│  │  (ChatParticipant)                                 │    │
│  │  - Handles /visualize-prompt command               │    │
│  │  - Streams sections using ChatResponseStream       │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│  ┌────────────────▼───────────────────────────────────┐    │
│  │  NativeChatRenderer                                │    │
│  │  - Converts sections to ChatResponseParts          │    │
│  │  - Handles streaming and progressive rendering     │    │
│  │  - Manages action buttons and interactions         │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│  ┌────────────────▼───────────────────────────────────┐    │
│  │  PromptStateManager (unchanged)                    │    │
│  │  - Section CRUD operations                         │    │
│  │  - State synchronization                           │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│  ┌────────────────▼───────────────────────────────────┐    │
│  │  Services Layer (unchanged)                        │    │
│  │  - SectionParserService                            │    │
│  │  - TokenUsageCalculator                            │    │
│  │  - ContentRenderer                                 │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                      │
                      │ Native Chat API
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              VS Code Native Chat Renderer                    │
│                                                              │
│  - ChatResponseMarkdownPart (section content)               │
│  - ChatResponseCommandButtonPart (actions)                  │
│  - ChatResponseWarningPart (token warnings)                 │
│  - ChatResponseProgressPart (loading states)                │
│  - Built-in theming and accessibility                       │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. PromptVisualizerChatParticipant

A new chat participant that handles visualization requests and renders sections using native chat APIs.

```typescript
export class PromptVisualizerChatParticipant implements vscode.ChatParticipant {
	readonly id = 'github.copilot.promptVisualizer';
	readonly name = 'Prompt Visualizer';
	readonly description = 'Visualize and edit prompt sections';

	async handleRequest(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<vscode.ChatResult> {
		// Parse command: /visualize-prompt or /edit-section
		const command = request.command;

		if (command === 'visualize-prompt') {
			return this._handleVisualizePrompt(request, stream, token);
		} else if (command === 'edit-section') {
			return this._handleEditSection(request, stream, token);
		}

		// Default: visualize current prompt
		return this._handleVisualizePrompt(request, stream, token);
	}
}
```

### 2. NativeChatRenderer

Converts prompt sections into native chat response parts for rendering.

```typescript
export class NativeChatRenderer {
	constructor(
		@ISectionParserService private readonly _parserService: ISectionParserService,
		@ITokenUsageCalculator private readonly _tokenCalculator: ITokenUsageCalculator,
		@IContentRenderer private readonly _contentRenderer: IContentRenderer
	) {}

	/**
	 * Render sections to a chat response stream
	 */
	async renderSections(
		sections: PromptSection[],
		stream: vscode.ChatResponseStream,
		options: RenderOptions
	): Promise<void> {
		// Render header with total tokens
		await this._renderHeader(sections, stream);

		// Render each section
		for (const section of sections) {
			await this._renderSection(section, stream, options);
		}

		// Render footer with actions
		await this._renderFooter(stream);
	}

	/**
	 * Render a single section using native chat components
	 */
	private async _renderSection(
		section: PromptSection,
		stream: vscode.ChatResponseStream,
		options: RenderOptions
	): Promise<void> {
		// Section header with markdown
		const headerMarkdown = this._createSectionHeader(section);
		stream.markdown(headerMarkdown);

		// Token warning if needed
		if (section.warningLevel === 'warning' || section.warningLevel === 'critical') {
			const warningMessage = this._createTokenWarning(section);
			stream.warning(warningMessage);
		}

		// Section content
		if (!section.isCollapsed) {
			if (section.hasRenderableElements && section.renderedContent) {
				// Render rich content
				await this._renderRichContent(section, stream);
			} else {
				// Render plain content
				stream.markdown(section.content);
			}

			// Action buttons
			this._renderActionButtons(section, stream);
		}
	}

	/**
	 * Create section header markdown
	 */
	private _createSectionHeader(section: PromptSection): string {
		const collapseIcon = section.isCollapsed ? '▶' : '▼';
		const tokenBadge = `\`${section.tokenCount} tokens\``;

		return `### ${collapseIcon} \`<${section.tagName}>\` ${tokenBadge}`;
	}

	/**
	 * Render action buttons using ChatResponseCommandButtonPart
	 */
	private _renderActionButtons(
		section: PromptSection,
		stream: vscode.ChatResponseStream
	): void {
		// Edit button
		stream.button({
			title: 'Edit',
			command: 'github.copilot.promptVisualizer.editSection',
			arguments: [section.id]
		});

		// Delete button
		stream.button({
			title: 'Delete',
			command: 'github.copilot.promptVisualizer.deleteSection',
			arguments: [section.id]
		});

		// Collapse/Expand button
		stream.button({
			title: section.isCollapsed ? 'Expand' : 'Collapse',
			command: 'github.copilot.promptVisualizer.toggleCollapse',
			arguments: [section.id]
		});
	}
}
```

### 3. Section Editor Integration

Use VS Code's native editor capabilities for editing sections.

```typescript
export class SectionEditorService {
	/**
	 * Open a section for editing in a temporary document
	 */
	async editSection(section: PromptSection): Promise<string | undefined> {
		// Create a temporary document with the section content
		const doc = await vscode.workspace.openTextDocument({
			content: section.content,
			language: 'markdown' // or detect from content
		});

		// Show the document in an editor
		const editor = await vscode.window.showTextDocument(doc, {
			preview: true,
			viewColumn: vscode.ViewColumn.Beside
		});

		// Wait for user to save or close
		return new Promise((resolve) => {
			const disposable = vscode.workspace.onDidCloseTextDocument((closedDoc) => {
				if (closedDoc === doc) {
					disposable.dispose();
					resolve(doc.getText());
				}
			});
		});
	}

	/**
	 * Edit section inline using quick input
	 */
	async editSectionInline(section: PromptSection): Promise<string | undefined> {
		const result = await vscode.window.showInputBox({
			title: `Edit Section: ${section.tagName}`,
			value: section.content,
			prompt: 'Edit the section content',
			placeHolder: 'Enter section content...',
			ignoreFocusOut: true,
			validateInput: (value) => {
				// Optional validation
				return undefined;
			}
		});

		return result;
	}
}
```

### 4. Hybrid Mode Support

Support both standalone webview panel and inline chat rendering.

```typescript
export class PromptVisualizerController {
	private _mode: 'standalone' | 'inline' = 'inline';

	/**
	 * Render in standalone webview panel (legacy mode)
	 */
	async renderStandalone(): Promise<void> {
		// Use existing WebviewViewProvider with minimal custom UI
		// Leverage native components where possible
		const panel = vscode.window.createWebviewPanel(
			'promptVisualizer',
			'Prompt Visualizer',
			vscode.ViewColumn.Beside,
			{ enableScripts: true }
		);

		// Use native webview UI toolkit
		panel.webview.html = this._getWebviewContent(panel.webview);
	}

	/**
	 * Render inline in chat (new mode)
	 */
	async renderInline(stream: vscode.ChatResponseStream): Promise<void> {
		// Use NativeChatRenderer to render sections
		const sections = this._stateManager.getCurrentState().sections;
		await this._nativeRenderer.renderSections(sections, stream, {
			showActions: true,
			enableCollapse: true
		});
	}

	/**
	 * Get webview content using VS Code Webview UI Toolkit
	 */
	private _getWebviewContent(webview: vscode.Webview): string {
		// Use @vscode/webview-ui-toolkit for native-looking components
		// This provides VS Code-styled buttons, inputs, etc.
		return `<!DOCTYPE html>
			<html>
			<head>
				<link href="${this._getToolkitUri(webview)}" rel="stylesheet">
			</head>
			<body>
				<vscode-panels>
					<!-- Use native webview components -->
				</vscode-panels>
				<script type="module" src="${this._getToolkitScriptUri(webview)}"></script>
			</body>
			</html>`;
	}
}
```

## Data Models

### RenderOptions

```typescript
interface RenderOptions {
	/** Show action buttons for each section */
	showActions: boolean;

	/** Enable collapse/expand functionality */
	enableCollapse: boolean;

	/** Show token breakdown details */
	showTokenBreakdown: boolean;

	/** Render mode */
	mode: 'standalone' | 'inline';

	/** Maximum sections to render before pagination */
	maxSections?: number;
}
```

### ChatCommand

```typescript
interface ChatCommand {
	/** Command name (e.g., 'visualize-prompt', 'edit-section') */
	name: string;

	/** Command description */
	description: string;

	/** Command handler */
	handler: (request: vscode.ChatRequest, stream: vscode.ChatResponseStream) => Promise<vscode.ChatResult>;
}
```

## Error Handling

### 1. Parsing Errors

When sections cannot be parsed, render an error message using `ChatResponseWarningPart`:

```typescript
if (!parseResult.hasValidStructure) {
	stream.warning('Unable to parse prompt sections. Please check your XML-like tags.');

	// Show errors
	for (const error of parseResult.errors) {
		stream.markdown(`- **${error.type}**: ${error.message} at position ${error.position}`);
	}
}
```

### 2. Token Calculation Errors

If token calculation fails, fall back to character-based estimation:

```typescript
try {
	tokenCount = await this._tokenCalculator.calculateSectionTokens(section, endpoint);
} catch (error) {
	this._logService.warn('Token calculation failed, using character estimate', error);
	tokenCount = Math.ceil(section.content.length / 4); // Rough estimate
	stream.warning('Token count is estimated (calculation service unavailable)');
}
```

### 3. Command Execution Errors

Handle errors in command execution gracefully:

```typescript
try {
	await vscode.commands.executeCommand('github.copilot.promptVisualizer.editSection', sectionId);
} catch (error) {
	vscode.window.showErrorMessage(`Failed to edit section: ${error.message}`);
	this._logService.error('Edit section command failed', error);
}
```

## Testing Strategy

### 1. Unit Tests

Test the new components in isolation:

```typescript
describe('NativeChatRenderer', () => {
	it('should render section header with correct markdown', () => {
		const section = createMockSection({ tagName: 'context', tokenCount: 100 });
		const header = renderer._createSectionHeader(section);
		expect(header).toContain('### ▼ `<context>` `100 tokens`');
	});

	it('should render warning for high token sections', async () => {
		const section = createMockSection({ tokenCount: 600, warningLevel: 'warning' });
		const stream = new MockChatResponseStream();
		await renderer._renderSection(section, stream, {});
		expect(stream.warnings).toHaveLength(1);
	});

	it('should render action buttons', () => {
		const section = createMockSection({ id: 'test-1' });
		const stream = new MockChatResponseStream();
		renderer._renderActionButtons(section, stream);
		expect(stream.buttons).toHaveLength(3); // Edit, Delete, Collapse
	});
});
```

### 2. Integration Tests

Test the chat participant integration:

```typescript
describe('PromptVisualizerChatParticipant', () => {
	it('should handle /visualize-prompt command', async () => {
		const request = createMockChatRequest({ command: 'visualize-prompt' });
		const stream = new MockChatResponseStream();
		const result = await participant.handleRequest(request, {}, stream, CancellationToken.None);
		expect(result.metadata).toBeDefined();
		expect(stream.parts.length).toBeGreaterThan(0);
	});

	it('should render sections progressively', async () => {
		const sections = createMockSections(10);
		const stream = new MockChatResponseStream();
		await renderer.renderSections(sections, stream, {});
		expect(stream.parts.length).toBe(sections.length * 3); // Header + Content + Actions per section
	});
});
```

### 3. End-to-End Tests

Test the complete user workflow:

```typescript
describe('Prompt Visualizer E2E', () => {
	it('should visualize prompt from chat command', async () => {
		// Type /visualize-prompt in chat
		await vscode.commands.executeCommand('workbench.action.chat.open');
		// ... simulate user interaction
	});

	it('should edit section and update prompt', async () => {
		// Click edit button
		// Modify content
		// Save
		// Verify prompt updated
	});
});
```

## Migration Path

### Phase 1: Create New Components (Parallel Development)

1. Implement `NativeChatRenderer` alongside existing `PromptSectionVisualizerProvider`
2. Implement `PromptVisualizerChatParticipant`
3. Implement `SectionEditorService`
4. Add feature flag to switch between old and new rendering

### Phase 2: Testing and Validation

1. Test new components with existing services
2. Validate visual consistency with Copilot Chat
3. Ensure all features work (editing, token counting, etc.)
4. Gather user feedback

### Phase 3: Deprecation and Cleanup

1. Enable new rendering by default
2. Mark old WebView implementation as deprecated
3. Remove custom HTML/CSS/JavaScript files
4. Update documentation

### Phase 4: Optimization

1. Optimize streaming performance
2. Add progressive rendering for large prompts
3. Implement caching for rendered sections
4. Fine-tune user experience

## Performance Considerations

### 1. Streaming Rendering

Render sections progressively to avoid blocking:

```typescript
async renderSections(sections: PromptSection[], stream: vscode.ChatResponseStream): Promise<void> {
	for (const section of sections) {
		await this._renderSection(section, stream, {});
		// Allow UI to update between sections
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}
```

### 2. Token Calculation Caching

Leverage existing caching in `TokenUsageCalculator`:

```typescript
// Already implemented with LRU cache
const tokenCount = await this._tokenCalculator.calculateSectionTokens(section, endpoint);
```

### 3. Lazy Loading

For large prompts, implement pagination:

```typescript
if (sections.length > MAX_SECTIONS_PER_PAGE) {
	// Render first page
	await this._renderSections(sections.slice(0, MAX_SECTIONS_PER_PAGE), stream);

	// Add "Load More" button
	stream.button({
		title: `Load ${sections.length - MAX_SECTIONS_PER_PAGE} more sections`,
		command: 'github.copilot.promptVisualizer.loadMore'
	});
}
```

## Accessibility

VS Code's native chat components provide built-in accessibility:

- Screen reader support for all chat response parts
- Keyboard navigation for buttons and actions
- ARIA labels automatically applied
- High contrast theme support

No custom accessibility implementation needed.

## Security Considerations

### 1. Content Sanitization

Ensure user content is properly escaped when rendering:

```typescript
// VS Code's ChatResponseMarkdownPart handles sanitization automatically
stream.markdown(section.content); // Safe
```

### 2. Command Validation

Validate command arguments before execution:

```typescript
async executeCommand(command: string, args: any[]): Promise<void> {
	// Validate section ID
	if (!this._isValidSectionId(args[0])) {
		throw new Error('Invalid section ID');
	}

	// Execute command
	await vscode.commands.executeCommand(command, ...args);
}
```

## Configuration

Add configuration options for the new rendering mode:

```json
{
	"github.copilot.promptVisualizer.renderMode": {
		"type": "string",
		"enum": ["inline", "standalone", "auto"],
		"default": "auto",
		"description": "How to render the prompt visualizer"
	},
	"github.copilot.promptVisualizer.useNativeRendering": {
		"type": "boolean",
		"default": true,
		"description": "Use VS Code's native chat rendering APIs"
	}
}
```

## Benefits of Migration

### 1. Code Reduction

- Remove ~1000 lines of custom JavaScript
- Remove ~500 lines of custom CSS
- Remove custom WebView message passing logic
- **Estimated reduction: 60-70% of UI code**

### 2. Visual Consistency

- Automatic theme support (light, dark, high contrast)
- Consistent with Copilot Chat interface
- Native VS Code styling and animations

### 3. Maintenance

- Leverage VS Code's built-in components
- Automatic updates with VS Code releases
- Reduced testing surface area

### 4. Accessibility

- Built-in screen reader support
- Keyboard navigation
- ARIA labels
- No custom implementation needed

### 5. Performance

- Native rendering engine
- Optimized for large content
- Progressive rendering support

## Risks and Mitigation

### Risk 1: Limited Customization

**Risk**: Native components may not support all custom features (e.g., drag-and-drop reordering).

**Mitigation**:
- Use command-based reordering with up/down buttons
- Implement drag-and-drop in standalone mode only if needed
- Prioritize features that work well with native APIs

### Risk 2: API Stability

**Risk**: VS Code chat APIs may change or be deprecated.

**Mitigation**:
- Use stable APIs where possible
- Monitor VS Code release notes
- Maintain abstraction layer for easy updates

### Risk 3: Feature Parity

**Risk**: Some existing features may be difficult to implement with native APIs.

**Mitigation**:
- Identify critical features early
- Design alternative implementations
- Use hybrid approach if needed (native + minimal custom UI)

## Future Enhancements

1. **Collaborative Editing**: Multiple users editing sections simultaneously
2. **Section Templates**: Pre-defined section templates for common use cases
3. **AI-Powered Suggestions**: Suggest section improvements based on content
4. **Export/Import**: Export sections to files, import from templates
5. **Version History**: Track changes to sections over time
