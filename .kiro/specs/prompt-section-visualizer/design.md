# Design Document

## Overview

The Prompt Section Visualizer is a VS Code extension feature that enhances the GitHub Copilot Chat experience by providing visual representation and interactive editing of prompt sections wrapped in XML-like tags. The feature integrates seamlessly with the existing chat interface while offering advanced prompt management capabilities including real-time token counting, section-based editing, and rich content rendering with a modern minimalistic design.

## Architecture

### High-Level Architecture

The system follows a modular architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Prompt Section  │  │   Token Usage   │  │ Chat UI      │ │
│  │ Visualizer      │  │   Calculator    │  │ Integration  │ │
│  │ WebView         │  │                 │  │              │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Section Parser  │  │ Tokenizer       │  │ State        │ │
│  │ Service         │  │ Service         │  │ Manager      │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                 Existing Copilot Chat Extension             │
└─────────────────────────────────────────────────────────────┘
```

### Component Architecture

The feature consists of several key components:

1. **Prompt Section Visualizer WebView**: Main UI component for displaying and editing sections
2. **Section Parser Service**: Handles XML tag parsing and validation
3. **Token Usage Calculator**: Integrates with existing tokenizer for real-time counting
4. **Content Renderer**: Handles rich content detection and rendering
5. **State Manager**: Manages prompt state and synchronization
6. **Chat UI Integration**: Hooks into existing chat interface

## Components and Interfaces

### 1. Prompt Section Visualizer WebView

**Purpose**: Primary UI component that renders the visual representation of prompt sections with modern minimalistic design.

**Key Interfaces**:
```typescript
interface IPromptSectionVisualizerProvider extends WebviewViewProvider {
  resolveWebviewView(webviewView: WebviewView, context: WebviewViewResolveContext, token: CancellationToken): void;
  updatePrompt(prompt: string): void;
  getEditedPrompt(): string;
}

interface PromptSection {
  id: string;
  tagName: string;
  content: string;
  renderedContent?: RenderedContent;
  startIndex: number;
  endIndex: number;
  tokenCount: number;
  isEditing: boolean;
  isCollapsed: boolean;
  hasRenderableElements: boolean;
}

interface RenderedContent {
  type: 'markdown' | 'code' | 'list' | 'mixed';
  elements: RenderableElement[];
}

interface RenderableElement {
  type: 'text' | 'code_block' | 'inline_code' | 'list_item' | 'emphasis';
  content: string;
  language?: string;
  metadata?: Record<string, any>;
}

interface VisualizerState {
  sections: PromptSection[];
  totalTokens: number;
  isEnabled: boolean;
  currentLanguageModel: string;
  uiTheme: 'light' | 'dark' | 'high-contrast';
}
```

**Implementation Details**:
- Uses WebviewViewProvider for VS Code integration
- Implements React-based UI with modern minimalistic design principles
- Supports drag-and-drop for section reordering with subtle visual feedback
- Provides inline editing with Monaco Editor integration
- Renders rich content elements in read-only mode, switches to plain text in edit mode
- Uses VS Code's design tokens for consistent theming

### 2. Section Parser Service

**Purpose**: Handles parsing of XML-like tags and content extraction.

**Key Interfaces**:
```typescript
interface ISectionParserService {
  parsePrompt(prompt: string): ParseResult;
  validateXMLStructure(content: string): ValidationResult;
  reconstructPrompt(sections: PromptSection[]): string;
}

interface ParseResult {
  sections: PromptSection[];
  errors: ParseError[];
  hasValidStructure: boolean;
}

interface ParseError {
  type: 'MALFORMED_TAG' | 'UNCLOSED_TAG' | 'INVALID_NESTING';
  message: string;
  position: number;
}
```

**Implementation Details**:
- Uses regex-based parsing for XML-like tag detection
- Supports nested tags with proper hierarchy handling
- Provides error recovery for malformed XML
- Maintains original content integrity

### 3. Token Usage Calculator

**Purpose**: Integrates with existing tokenizer service to provide real-time token counting.

**Key Interfaces**:
```typescript
// Reuse existing tokenizer service
import { ITokenizerProvider, TokenizationEndpoint } from '../../../platform/tokenizer/node/tokenizer';
import { ITokenizer } from '../../../util/common/tokenizer';

interface ITokenUsageCalculator {
  calculateSectionTokens(section: PromptSection, endpoint: TokenizationEndpoint): Promise<number>;
  calculateTotalTokens(sections: PromptSection[], endpoint: TokenizationEndpoint): Promise<number>;
  onLanguageModelChange(callback: (endpoint: TokenizationEndpoint) => void): void;
}

interface TokenUsageInfo {
  sectionTokens: Map<string, number>;
  totalTokens: number;
  lastUpdated: Date;
  tokenizationEndpoint: TokenizationEndpoint;
}
```

**Implementation Details**:
- **Reuses existing `ITokenizerProvider`** service from `src/platform/tokenizer/node/tokenizer.ts`
- **Leverages existing `ITokenizer`** interface with `tokenLength()` method
- **Uses existing tokenization endpoints** (CL100K, O200K, Llama3) from `TokenizerType` enum
- Caches token calculations for performance using existing LRU cache patterns
- Updates calculations on content or model changes
- Provides visual indicators for high token usage

### 4. Content Renderer Service

**Purpose**: Detects and renders rich content elements within prompt sections, leveraging existing conversation and prompt reference patterns.

**Key Interfaces**:
```typescript
// Reuse existing conversation and prompt reference types
import { PromptReference } from '@vscode/prompt-tsx';
import { CodeBlock } from '../../../extension/prompt/common/conversation';

interface IContentRenderer {
  detectRenderableElements(content: string): RenderableElement[];
  renderToHTML(elements: RenderableElement[]): string;
  extractPlainText(elements: RenderableElement[]): string;
  extractCodeBlocks(content: string): CodeBlock[]; // Reuse existing CodeBlock type
}

interface ContentDetectionResult {
  hasRenderableContent: boolean;
  elements: RenderableElement[];
  codeBlocks: CodeBlock[]; // Reuse existing CodeBlock interface
  plainTextFallback: string;
}
```

**Implementation Details**:
- **Reuses existing `CodeBlock` interface** from conversation.ts for code block detection
- **Leverages existing `PromptReference`** patterns from `@vscode/prompt-tsx`
- **Uses existing markdown parsing** patterns from the codebase
- Detects code blocks, lists, emphasis, and other Copilot Chat elements
- Provides HTML rendering for read-only view mode using VS Code's webview capabilities
- Maintains plain text representation for edit mode
- Supports syntax highlighting for code blocks using existing language detection

### 5. State Manager

**Purpose**: Manages prompt state, synchronization, and persistence using existing VS Code patterns.

**Key Interfaces**:
```typescript
// Leverage existing VS Code services and patterns
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { Emitter, Event } from '../../../util/vs/base/common/event';

interface IPromptStateManager extends Disposable {
  readonly onDidChangeState: Event<VisualizerState>;

  getCurrentState(): VisualizerState;
  updateSection(sectionId: string, content: string): void;
  reorderSections(newOrder: string[]): void;
  addSection(tagName: string, content: string, position?: number): void;
  removeSection(sectionId: string): void;
  toggleSectionCollapse(sectionId: string): void;
  switchSectionMode(sectionId: string, mode: 'view' | 'edit'): void;
}
```

**Implementation Details**:
- **Extends existing `Disposable`** pattern from VS Code utilities
- **Uses existing `Emitter/Event`** pattern for state change notifications
- **Leverages existing configuration service** for user preferences persistence
- **Uses existing workspace state** for section collapse/expand persistence
- Maintains immutable state updates following existing patterns
- Provides undo/redo functionality using VS Code's command system
- Synchronizes with chat input field using existing chat integration patterns

### 6. Chat UI Integration

**Purpose**: Integrates the visualizer with the existing Copilot Chat interface using standard VS Code extension APIs.

**Key Interfaces**:
```typescript
// Use standard VS Code WebView APIs
import { WebviewViewProvider, WebviewView, WebviewViewResolveContext, CancellationToken } from 'vscode';

interface IChatUIIntegration {
  registerVisualizerToggle(): void;
  hookIntoPromptInput(): void;
  synchronizeWithChatState(): void;
  showVisualizerPanel(): void;
  hideVisualizerPanel(): void;
}

// Standard VS Code WebView provider
class PromptSectionVisualizerProvider implements WebviewViewProvider {
  resolveWebviewView(
    webviewView: WebviewView,
    context: WebviewViewResolveContext,
    token: CancellationToken
  ): void | Thenable<void>;
}
```

**Implementation Details**:
- **Uses standard VS Code `WebviewViewProvider`** for UI integration
- **Leverages existing command registration** patterns from the extension
- **Uses existing configuration service** for toggle state persistence
- **Integrates with existing chat context** and conversation management
- **Follows existing VS Code contribution points** for UI elements
- Monitors chat input changes using existing event patterns
- Provides seamless integration without disrupting existing functionality
- Respects VS Code theming using existing CSS custom properties and design tokens

### Webview Coordination with Chat Panel

The visualizer webview coordinates with the chat side panel through several mechanisms:

1. **Bidirectional Synchronization**:
   ```typescript
   // Chat input → Visualizer
   chatInput.onDidChange(text => visualizer.updatePrompt(text));

   // Visualizer → Chat input
   visualizer.onDidEditSection(newPrompt => chatInput.setValue(newPrompt));
   ```

2. **Toggle Integration**:
   - Toggle button appears in chat input toolbar
   - Webview panel shows/hides below chat input
   - State persists across VS Code sessions

3. **Real-time Updates**:
   - Parser runs on every chat input change
   - Token counts update as user types
   - Visual feedback for malformed XML

4. **Event Flow**:
   ```
   User types → Chat Input → Parser → Visualizer Update → Token Calculation → UI Refresh
        ↑                                                                        ↓
   Chat Input ← Prompt Reconstruction ← Section Edit ← User clicks Edit ← UI Event
   ```

## Data Models

### Core Data Structures

```typescript
// Main prompt section representation
interface PromptSection {
  id: string;                    // Unique identifier
  tagName: string;              // XML tag name (e.g., "context", "instructions")
  content: string;              // Section content
  renderedContent?: RenderedContent; // Rich content representation
  startIndex: number;           // Start position in original prompt
  endIndex: number;             // End position in original prompt
  tokenCount: number;           // Calculated token count
  isEditing: boolean;           // Current editing state
  isCollapsed: boolean;         // Collapse state for UI
  hasRenderableElements: boolean; // Whether section contains rich content
  metadata?: SectionMetadata;   // Optional metadata
}

// Rich content representation
interface RenderedContent {
  type: 'markdown' | 'code' | 'list' | 'mixed';
  elements: RenderableElement[];
  htmlRepresentation: string;
  plainTextFallback: string;
}

// Individual renderable elements
interface RenderableElement {
  type: 'text' | 'code_block' | 'inline_code' | 'list_item' | 'emphasis' | 'link';
  content: string;
  language?: string;
  startIndex: number;
  endIndex: number;
  metadata?: Record<string, any>;
}

// Section metadata for enhanced functionality
interface SectionMetadata {
  createdAt: Date;
  lastModified: Date;
  customAttributes: Record<string, string>;
  validationRules?: ValidationRule[];
}

// Parser configuration and results
interface ParserConfig {
  allowedTags: string[];
  maxNestingDepth: number;
  strictMode: boolean;
  customTagPatterns?: RegExp[];
}

// Token usage tracking
interface TokenUsageMetrics {
  perSection: Map<string, number>;
  total: number;
  breakdown: {
    content: number;
    tags: number;
    overhead: number;
  };
  efficiency: number; // tokens per character ratio
}
```

## UI Layout and Integration

### Overall Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VS Code Workbench                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Editor Area                    │              Side Panel                   │
│                                 │  ┌─────────────────────────────────────┐  │
│  ┌─────────────────────────────┐ │  │         Chat Panel                  │  │
│  │                             │ │  │  ┌─────────────────────────────────┐│  │
│  │     Main Editor             │ │  │  │  Chat History                   ││  │
│  │                             │ │  │  │  ┌─────────────────────────────┐││  │
│  │                             │ │  │  │  │ Previous messages...        │││  │
│  │                             │ │  │  │  └─────────────────────────────┘││  │
│  │                             │ │  │  └─────────────────────────────────┘│  │
│  │                             │ │  │  ┌─────────────────────────────────┐│  │
│  │                             │ │  │  │  Chat Input Area                ││  │
│  │                             │ │  │  │  ┌─────────────────────────────┐││  │
│  │                             │ │  │  │  │ Type your message...        │││  │
│  │                             │ │  │  │  └─────────────────────────────┘││  │
│  │                             │ │  │  │  [📊] Toggle Visualizer         ││  │
│  │                             │ │  │  └─────────────────────────────────┘│  │
│  └─────────────────────────────┘ │  └─────────────────────────────────────┘  │
│                                 │  ┌─────────────────────────────────────┐  │
│                                 │  │    Prompt Section Visualizer       │  │
│                                 │  │  ┌─────────────────────────────────┐│  │
│                                 │  │  │ ▼ context (45 tokens)          ││  │
│                                 │  │  │   [Rendered content view]      ││  │
│                                 │  │  │   • Code blocks highlighted    ││  │
│                                 │  │  │   • Lists formatted            ││  │
│                                 │  │  │   [✏️ Edit] [🗑️ Delete]        ││  │
│                                 │  │  └─────────────────────────────────┘│  │
│                                 │  │  ┌─────────────────────────────────┐│  │
│                                 │  │  │ ▼ instructions (23 tokens)     ││  │
│                                 │  │  │   Plain text content...        ││  │
│                                 │  │  │   [✏️ Edit] [🗑️ Delete]        ││  │
│                                 │  │  └─────────────────────────────────┘│  │
│                                 │  │  ┌─────────────────────────────────┐│  │
│                                 │  │  │ + Add Section                   ││  │
│                                 │  │  └─────────────────────────────────┘│  │
│                                 │  │  Total: 68 tokens                  │  │
│                                 │  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Detailed Section Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Individual Section Component                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Section Header                                                          ││
│  │  [▼] context                                    45 tokens  [⚠️] [✏️] [🗑️] ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Section Content (View Mode)                                             ││
│  │                                                                         ││
│  │  Here's some context with **bold text** and:                           ││
│  │                                                                         ││
│  │  ```typescript                                                          ││
│  │  const example = "highlighted code";                                    ││
│  │  ```                                                                    ││
│  │                                                                         ││
│  │  - List item 1                                                          ││
│  │  - List item 2                                                          ││
│  │                                                                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                     Section in Edit Mode                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Section Header                                                          ││
│  │  [▼] context                                    45 tokens  [💾] [❌]     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Monaco Editor (Plain Text Mode)                                         ││
│  │                                                                         ││
│  │  Here's some context with **bold text** and:                           ││
│  │                                                                         ││
│  │  ```typescript                                                          ││
│  │  const example = "highlighted code";                                    ││
│  │  ```                                                                    ││
│  │                                                                         ││
│  │  - List item 1                                                          ││
│  │  - List item 2                                                          ││
│  │                                                                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

### Integration Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Integration Workflow                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User types in Chat Input:                                               │
│     "<context>Some context</context><instructions>Do something</instructions>"│
│                                    │                                        │
│                                    ▼                                        │
│  2. Parser detects XML sections ───┴─── 3. Visualizer updates in real-time │
│                                                                             │
│  4. User clicks "Edit" on a section                                        │
│                                    │                                        │
│                                    ▼                                        │
│  5. Monaco editor opens ───────────┴─── 6. Changes sync back to chat input │
│                                                                             │
│  7. Token counts update automatically                                       │
│                                    │                                        │
│                                    ▼                                        │
│  8. Visual indicators show high usage ── 9. User optimizes prompt          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## UI Design Principles

1. **Modern Minimalistic Design**
   - Clean, uncluttered interface with generous white space
   - Subtle borders and shadows using VS Code's design tokens
   - Minimal color palette focusing on content hierarchy
   - Consistent typography and spacing following VS Code conventions

2. **Content Rendering Strategy**
   - Rich content elements (code blocks, lists, emphasis) rendered in view mode
   - Seamless transition to plain text representation in edit mode
   - Clear visual distinction between rendered and raw content
   - Preservation of formatting during mode transitions

3. **Interactive Elements**
   - Collapse/expand buttons with smooth animations
   - Hover states with subtle visual feedback
   - Drag handles that appear on hover for section reordering
   - Clear visual indicators for editable vs. read-only content

### Visual Design Tokens

```css
/* VS Code Design Token Usage */
:root {
  --section-border: var(--vscode-panel-border);
  --section-background: var(--vscode-editor-background);
  --header-background: var(--vscode-editorGroupHeader-tabsBackground);
  --token-count-color: var(--vscode-descriptionForeground);
  --warning-color: var(--vscode-editorWarning-foreground);
  --error-color: var(--vscode-editorError-foreground);
  --button-background: var(--vscode-button-background);
  --button-hover: var(--vscode-button-hoverBackground);
}
```

### Responsive Behavior

- **Narrow panels**: Sections stack vertically with minimal padding
- **Wide panels**: More generous spacing and larger interactive elements
- **Collapsed sections**: Show only header with token count
- **Drag indicators**: Appear on hover for reordering sections

## Error Handling

### Error Categories

1. **Parse Errors**: Malformed XML, unclosed tags, invalid nesting
2. **Token Calculation Errors**: Tokenizer failures, model unavailability
3. **Content Rendering Errors**: Rich content parsing failures
4. **State Synchronization Errors**: Chat input sync failures
5. **UI Rendering Errors**: WebView communication failures

### Error Recovery Strategies

```typescript
interface ErrorRecoveryStrategy {
  // Graceful degradation for parse errors
  handleParseError(error: ParseError): FallbackBehavior;

  // Retry logic for token calculation
  handleTokenizationError(error: TokenizationError): RetryStrategy;

  // Content rendering fallbacks
  handleRenderingError(error: RenderingError): ContentFallback;

  // State recovery mechanisms
  handleStateSyncError(error: StateSyncError): RecoveryAction;
}

enum FallbackBehavior {
  SHOW_AS_PLAIN_TEXT = 'plain_text',
  ATTEMPT_REPAIR = 'repair',
  HIGHLIGHT_ERRORS = 'highlight'
}

enum ContentFallback {
  PLAIN_TEXT_ONLY = 'plain_text',
  PARTIAL_RENDERING = 'partial',
  ERROR_PLACEHOLDER = 'error'
}
```

### Error Reporting

- Non-intrusive error indicators in UI
- Detailed error messages in VS Code output channel
- Telemetry for error tracking and improvement
- User-friendly error recovery suggestions

## Testing Strategy

### Unit Testing

1. **Section Parser Tests**
   - Valid XML parsing scenarios
   - Malformed XML handling
   - Nested tag processing
   - Edge cases and boundary conditions

2. **Token Calculator Tests**
   - Different language model tokenizers
   - Large content handling
   - Performance benchmarks
   - Cache behavior validation

3. **Content Renderer Tests**
   - Rich content detection accuracy
   - HTML rendering correctness
   - Mode switching functionality
   - Performance with complex content

4. **State Manager Tests**
   - State mutation operations
   - Synchronization logic
   - Persistence mechanisms
   - Undo/redo functionality

### Integration Testing

1. **WebView Communication**
   - Message passing between extension and webview
   - State synchronization accuracy
   - Performance under load

2. **Chat Integration**
   - Seamless toggle functionality
   - Input field synchronization
   - Theme compatibility

3. **VS Code API Integration**
   - Extension activation/deactivation
   - Command registration
   - Configuration management

### End-to-End Testing

1. **User Workflow Tests**
   - Complete editing workflows
   - Section management operations
   - Token usage scenarios
   - Content rendering workflows

2. **Performance Tests**
   - Large prompt handling
   - Real-time token calculation
   - Memory usage optimization
   - Rich content rendering performance

3. **Accessibility Tests**
   - Keyboard navigation
   - Screen reader compatibility
   - High contrast theme support

### Test Data and Scenarios

```typescript
// Test prompt examples
const testPrompts = {
  simple: '<context>Simple context</context><instructions>Do something</instructions>',
  nested: '<context><background>Info</background><current>State</current></context>',
  malformed: '<context>Unclosed tag<instructions>Valid section</instructions>',
  richContent: '<context>```typescript\nconst x = 1;\n```</context><instructions>- Item 1\n- Item 2</instructions>',
  large: generateLargePrompt(10000), // 10k character prompt
  empty: '',
  noTags: 'Plain text without any XML tags'
};

// Performance benchmarks
const performanceTargets = {
  parseTime: 100, // ms for 10k character prompt
  tokenCalculation: 500, // ms for full prompt
  contentRendering: 50, // ms for rich content
  uiUpdate: 16, // ms for 60fps
  memoryUsage: 50 // MB maximum
};
```

## Implementation Considerations

### Performance Optimization

1. **Lazy Loading**: Load visualizer only when needed
2. **Debounced Updates**: Batch token calculations and UI updates
3. **Virtual Scrolling**: Handle large numbers of sections efficiently
4. **Caching Strategy**: Cache parsed sections, token counts, and rendered content
5. **Content Rendering**: Optimize rich content parsing and HTML generation

### Accessibility

1. **Keyboard Navigation**: Full keyboard support for all operations including collapse/expand
2. **Screen Reader Support**: Proper ARIA labels and descriptions for all interactive elements
3. **High Contrast**: Theme-aware styling that works across all VS Code themes
4. **Focus Management**: Logical tab order and focus indicators for section navigation

### Extensibility

1. **Plugin Architecture**: Allow custom section types and renderers
2. **Theme Support**: Customizable styling with design token integration
3. **Configuration Options**: User preferences for behavior and appearance
4. **API Exposure**: Allow other extensions to integrate with the visualizer

### Security Considerations

1. **Content Sanitization**: Prevent XSS in webview content and rich content rendering
2. **Input Validation**: Validate all user inputs and parsed content
3. **Resource Limits**: Prevent excessive resource usage during content rendering
4. **Secure Communication**: Validate messages between components