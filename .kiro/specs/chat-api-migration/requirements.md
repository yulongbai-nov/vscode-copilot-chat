# Requirements Document

## Introduction

This feature migrates the Prompt Section Visualizer from a custom WebView-based UI to leverage VS Code's native Copilot Chat rendering APIs (`ChatResponseMarkdownPart`, `ChatResponseFileTreePart`, `ChatResponseAnchorPart`, etc.). This migration will ensure visual consistency with the Copilot Chat interface, reduce maintenance burden, and provide a more integrated user experience.

## Glossary

- **Chat_Response_API**: VS Code's native API for rendering chat content using classes like `ChatResponseMarkdownPart`, `ChatResponseFileTreePart`, `ChatResponseAnchorPart`, and `ChatResponseCommandButtonPart`
- **Prompt_Section_Visualizer**: The existing UI component that displays and manages prompt sections in a custom WebView
- **Chat_Participant**: A VS Code extension component that handles chat requests and responses using the Chat API
- **Inline_Chat_Widget**: VS Code's native inline chat interface that can be embedded in the editor
- **Custom_WebView**: The current implementation using HTML/CSS/JavaScript for rendering the visualizer UI
- **Native_Renderer**: VS Code's built-in rendering engine for chat content that handles markdown, code blocks, file trees, and other rich content
- **Section_Parser_Service**: The existing service that parses XML-like tags in prompts
- **Token_Usage_Calculator**: The existing service that calculates token counts for sections

## Requirements

### Requirement 1

**User Story:** As a developer, I want the Prompt Section Visualizer to use VS Code's native chat rendering APIs, so that it has a consistent look and feel with the Copilot Chat interface.

#### Acceptance Criteria

1. THE Chat_Response_API SHALL be used to render all prompt section content instead of custom HTML
2. WHEN a section contains markdown content, THE Native_Renderer SHALL render it using `ChatResponseMarkdownPart`
3. WHEN a section contains code blocks, THE Native_Renderer SHALL render them using the same syntax highlighting as Copilot Chat
4. WHEN a section contains file references, THE Native_Renderer SHALL render them using `ChatResponseAnchorPart`
5. THE Native_Renderer SHALL automatically apply the current VS Code theme to all rendered content

### Requirement 2

**User Story:** As a developer, I want section headers and metadata to be rendered using native chat components, so that they integrate seamlessly with the chat interface.

#### Acceptance Criteria

1. THE Prompt_Section_Visualizer SHALL render section headers using `ChatResponseMarkdownPart` with appropriate markdown formatting
2. WHEN displaying token counts, THE Prompt_Section_Visualizer SHALL use inline markdown badges or `ChatResponseProgressPart` for visual consistency
3. WHEN displaying warning indicators, THE Prompt_Section_Visualizer SHALL use `ChatResponseWarningPart` for high token usage sections
4. THE Prompt_Section_Visualizer SHALL use `ChatResponseCommandButtonPart` for action buttons (Edit, Delete, Add Section)
5. WHEN sections are collapsed or expanded, THE Prompt_Section_Visualizer SHALL use markdown collapsible sections or native UI patterns

### Requirement 3

**User Story:** As a developer, I want to edit sections using VS Code's native editing capabilities, so that I have a familiar and powerful editing experience.

#### Acceptance Criteria

1. WHEN a user clicks Edit on a section, THE Prompt_Section_Visualizer SHALL open the content in a VS Code editor or inline chat widget
2. THE Prompt_Section_Visualizer SHALL leverage VS Code's native Monaco editor for syntax highlighting and editing features
3. WHEN editing is complete, THE Prompt_Section_Visualizer SHALL update the section content and re-render using Chat_Response_API
4. THE Prompt_Section_Visualizer SHALL preserve all existing editing features (undo/redo, auto-indent, cursor position)
5. WHEN editing in an inline widget, THE Prompt_Section_Visualizer SHALL use `ChatResponseTextEditPart` or similar native components

### Requirement 4

**User Story:** As a developer, I want the visualizer to integrate with the chat participant model, so that it can be invoked directly from chat commands.

#### Acceptance Criteria

1. THE Prompt_Section_Visualizer SHALL register as a Chat_Participant or provide chat commands for visualization
2. WHEN a user types a chat command like `/visualize-prompt`, THE Chat_Participant SHALL parse the current prompt and render sections using Chat_Response_API
3. THE Chat_Participant SHALL stream section content progressively using `ChatResponseStream` for better performance
4. WHEN sections are modified, THE Chat_Participant SHALL update the chat response in real-time
5. THE Chat_Participant SHALL support follow-up actions through `ChatResponseCommandButtonPart` for editing and managing sections

### Requirement 5

**User Story:** As a developer, I want section management actions to use native chat interaction patterns, so that the interface feels cohesive with the rest of VS Code.

#### Acceptance Criteria

1. THE Prompt_Section_Visualizer SHALL use `ChatResponseCommandButtonPart` for all action buttons (Edit, Delete, Add, Reorder)
2. WHEN a user clicks an action button, THE Prompt_Section_Visualizer SHALL handle the action through VS Code command system
3. WHEN adding a new section, THE Prompt_Section_Visualizer SHALL use `ChatResponseConfirmationPart` or quick pick UI for tag name input
4. WHEN deleting a section, THE Prompt_Section_Visualizer SHALL use `ChatResponseConfirmationPart` for confirmation
5. THE Prompt_Section_Visualizer SHALL use `ChatResponseProgressPart` to show loading states during operations

### Requirement 6

**User Story:** As a developer, I want the migration to preserve all existing functionality, so that no features are lost in the transition.

#### Acceptance Criteria

1. THE Prompt_Section_Visualizer SHALL maintain all existing features including section parsing, token counting, and state management
2. THE Section_Parser_Service SHALL continue to work without modifications
3. THE Token_Usage_Calculator SHALL continue to work without modifications
4. THE Prompt_Section_Visualizer SHALL preserve section collapse/expand state across renders
5. THE Prompt_Section_Visualizer SHALL maintain drag-and-drop reordering functionality using native VS Code patterns or command-based reordering

### Requirement 7

**User Story:** As a developer, I want the visualizer to work both as a standalone view and inline in chat, so that I have flexibility in how I use it.

#### Acceptance Criteria

1. THE Prompt_Section_Visualizer SHALL support rendering in a dedicated webview panel (current behavior)
2. THE Prompt_Section_Visualizer SHALL support rendering inline in chat responses using Chat_Response_API
3. WHEN used inline in chat, THE Prompt_Section_Visualizer SHALL render sections as part of the chat response stream
4. WHEN used in a dedicated panel, THE Prompt_Section_Visualizer SHALL use a hybrid approach with native components where possible
5. THE Prompt_Section_Visualizer SHALL provide a configuration option to choose between standalone and inline modes

### Requirement 8

**User Story:** As a developer, I want the migration to reduce code complexity and maintenance burden, so that the feature is easier to maintain and extend.

#### Acceptance Criteria

1. THE Prompt_Section_Visualizer SHALL remove custom HTML/CSS/JavaScript rendering code from `media/promptSectionVisualizer.js` and `media/promptSectionVisualizer.css`
2. THE Prompt_Section_Visualizer SHALL reduce the codebase by at least 50% by leveraging native APIs
3. THE Prompt_Section_Visualizer SHALL eliminate the need for custom WebView message passing for rendering
4. THE Prompt_Section_Visualizer SHALL use VS Code's built-in accessibility features instead of custom ARIA implementations
5. THE Prompt_Section_Visualizer SHALL leverage VS Code's theming system automatically without custom CSS variables

### Requirement 9

**User Story:** As a developer, I want comprehensive documentation and examples for the new implementation, so that I can understand and extend the feature.

#### Acceptance Criteria

1. THE Prompt_Section_Visualizer SHALL include inline code documentation explaining the use of Chat_Response_API
2. THE Prompt_Section_Visualizer SHALL provide examples of rendering different section types using native APIs
3. THE Prompt_Section_Visualizer SHALL document the migration path from custom WebView to native rendering
4. THE Prompt_Section_Visualizer SHALL include unit tests demonstrating the use of Chat_Response_API
5. THE Prompt_Section_Visualizer SHALL update the design document to reflect the new architecture
