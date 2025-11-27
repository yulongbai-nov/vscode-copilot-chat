# Requirements Document

## Introduction

This feature adds a UI element to the VS Code Copilot Chat extension that visualizes prompt sections wrapped in XML-like tags (e.g., `<context>...</context>`, `<instructions>...</instructions>`), provides live editing capabilities for each section, and displays token usage information per section and in total according to the language model provider.

## Glossary

- **Prompt_Section_Visualizer**: The main UI component that displays and manages prompt sections
- **Prompt_Section**: A text block wrapped in XML-like tags (e.g., `<tag>content</tag>`)
- **Token_Counter**: Component responsible for calculating token usage using the existing tokenizer
- **Section_Editor**: Interactive editor component for modifying section content
- **Language_Model_Provider**: The AI service provider (e.g., OpenAI, Azure OpenAI) that determines tokenization rules
- **Copilot_Chat_Extension**: The VS Code extension for GitHub Copilot Chat functionality

## Requirements

### Requirement 1

**User Story:** As a developer using Copilot Chat, I want to see my prompt broken down into visual sections, so that I can understand the structure and organization of my request.

#### Acceptance Criteria

1. WHEN a prompt contains XML-like tags, THE Prompt_Section_Visualizer SHALL parse and display each section as a distinct visual component
2. WHEN a prompt has nested XML tags, THE Prompt_Section_Visualizer SHALL handle nested sections with appropriate visual hierarchy
3. WHEN a prompt contains malformed XML tags, THE Prompt_Section_Visualizer SHALL display the content as plain text with error indicators
4. THE Prompt_Section_Visualizer SHALL preserve the original prompt structure and content integrity
5. WHEN no XML-like sections are detected, THE Prompt_Section_Visualizer SHALL display the prompt as a single section

### Requirement 2

**User Story:** As a developer, I want to edit individual prompt sections in place, so that I can refine specific parts of my prompt without rewriting the entire request.

#### Acceptance Criteria

1. WHEN a user clicks on a prompt section, THE Section_Editor SHALL activate inline editing mode for that section
2. WHILE editing a section, THE Section_Editor SHALL provide syntax highlighting and basic text editing features
3. WHEN a user saves section changes, THE Prompt_Section_Visualizer SHALL update the underlying prompt text immediately
4. WHEN a user cancels section editing, THE Section_Editor SHALL revert to the original section content
5. THE Section_Editor SHALL validate XML tag structure and prevent malformed tag creation

### Requirement 3

**User Story:** As a developer, I want to see token usage for each prompt section and the total, so that I can optimize my prompts for token efficiency and cost management.

#### Acceptance Criteria

1. THE Token_Counter SHALL calculate and display token count for each individual prompt section
2. THE Token_Counter SHALL calculate and display the total token count for the entire prompt
3. WHEN the Language_Model_Provider changes, THE Token_Counter SHALL recalculate all token counts using the appropriate tokenizer
4. WHEN a section is edited, THE Token_Counter SHALL update the affected section's token count in real-time
5. THE Token_Counter SHALL display token counts with visual indicators for high usage sections

### Requirement 4

**User Story:** As a developer, I want the prompt section visualizer to integrate seamlessly with the existing Copilot Chat interface, so that it enhances my workflow without disrupting the current experience.

#### Acceptance Criteria

1. THE Prompt_Section_Visualizer SHALL integrate with the existing Copilot Chat UI as an optional enhancement
2. WHEN the visualizer is enabled, THE Copilot_Chat_Extension SHALL maintain all existing chat functionality
3. THE Prompt_Section_Visualizer SHALL provide a toggle option to enable or disable the visualization feature
4. WHEN the visualizer is disabled, THE Copilot_Chat_Extension SHALL function exactly as before
5. THE Prompt_Section_Visualizer SHALL respect the current VS Code theme and styling conventions

### Requirement 5

**User Story:** As a developer, I want to manage and organize my prompt sections efficiently, so that I can create more structured and maintainable prompts.

#### Acceptance Criteria

1. THE Prompt_Section_Visualizer SHALL provide collapse and expand buttons for each individual section
2. THE Prompt_Section_Visualizer SHALL provide section reordering capabilities through drag-and-drop
3. WHEN sections are reordered, THE Prompt_Section_Visualizer SHALL update the underlying prompt text to reflect the new order
4. THE Prompt_Section_Visualizer SHALL allow users to add new sections with predefined or custom tags
5. THE Prompt_Section_Visualizer SHALL allow users to delete existing sections with confirmation prompts

### Requirement 6

**User Story:** As a developer, I want a modern and minimalistic UI design for the prompt visualizer, so that it integrates seamlessly with VS Code's aesthetic and doesn't feel cluttered.

#### Acceptance Criteria

1. THE Prompt_Section_Visualizer SHALL use a modern minimalistic design language consistent with VS Code's UI patterns
2. THE Prompt_Section_Visualizer SHALL use subtle visual elements like clean borders, appropriate spacing, and minimal color usage
3. THE Prompt_Section_Visualizer SHALL provide clear visual hierarchy without overwhelming the user interface
4. THE Prompt_Section_Visualizer SHALL use VS Code's native icons and styling conventions where applicable
5. THE Prompt_Section_Visualizer SHALL maintain visual consistency across different VS Code themes

### Requirement 7

**User Story:** As a developer, I want to see rich content elements within prompt sections rendered appropriately, so that I can understand complex prompts with embedded elements while still being able to edit the raw text when needed.

#### Acceptance Criteria

1. WHEN a section contains Copilot Chat renderable elements, THE Prompt_Section_Visualizer SHALL display them in read-only rendered mode by default
2. WHEN a user enters edit mode for a section, THE Section_Editor SHALL reveal the plain text representation of all content including markup
3. THE Prompt_Section_Visualizer SHALL detect and render common elements like code blocks, lists, and formatted text in view mode
4. WHEN switching between view and edit modes, THE Section_Editor SHALL preserve all content formatting and structure
5. THE Prompt_Section_Visualizer SHALL provide clear visual indicators to distinguish between rendered content and plain text sections