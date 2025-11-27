# Implementation Plan

- [x] 1. Set up core infrastructure for native chat rendering
  - Create `NativeChatRenderer` class in `src/extension/promptSectionVisualizer/vscode-node/nativeChatRenderer.ts`
  - Define `RenderOptions` interface in `common/types.ts`
  - Add configuration settings for render mode in `package.json`
  - Create feature flag service to toggle between old and new rendering
  - _Requirements: 1.1, 7.4, 7.5_

- [x] 2. Implement NativeChatRenderer core functionality
  - [x] 2.1 Implement section header rendering
    - Create `_createSectionHeader()` method to generate markdown headers
    - Add collapse/expand icon logic
    - Include token count badges in headers
    - _Requirements: 1.2, 2.1, 2.2_

  - [x] 2.2 Implement section content rendering
    - Create `_renderSection()` method using `ChatResponseMarkdownPart`
    - Add support for rich content rendering (code blocks, lists)
    - Implement plain text fallback for non-renderable content
    - _Requirements: 1.2, 1.3, 1.4_

  - [x] 2.3 Implement token warning rendering
    - Create `_createTokenWarning()` method using `ChatResponseWarningPart`
    - Add warning level detection (warning vs critical)
    - Include token breakdown in warning messages
    - _Requirements: 2.3, 3.1_

  - [x] 2.4 Implement action button rendering
    - Create `_renderActionButtons()` method using `ChatResponseCommandButtonPart`
    - Add Edit, Delete, Collapse/Expand buttons
    - Wire up command handlers for each button
    - _Requirements: 2.4, 5.1, 5.2_

  - [x] 2.5 Implement header and footer rendering
    - Create `_renderHeader()` method for total token display
    - Create `_renderFooter()` method for global actions (Add Section)
    - Use `ChatResponseProgressPart` for token breakdown display
    - _Requirements: 2.2, 5.5_

- [x] 3. Create PromptVisualizerChatParticipant
  - [x] 3.1 Implement chat participant registration
    - Create `PromptVisualizerChatParticipant` class in `src/extension/promptSectionVisualizer/vscode-node/chatParticipant.ts`
    - Register participant in extension activation
    - Define participant metadata (id, name, description)
    - _Requirements: 4.1, 4.2_

  - [x] 3.2 Implement command handlers
    - Create `_handleVisualizePrompt()` method for `/visualize-prompt` command
    - Create `_handleEditSection()` method for `/edit-section` command
    - Add command routing logic in `handleRequest()`
    - _Requirements: 4.2, 4.3_

  - [x] 3.3 Implement streaming rendering
    - Integrate `NativeChatRenderer` with `ChatResponseStream`
    - Add progressive rendering for large prompts
    - Implement error handling and recovery
    - _Requirements: 4.3, 4.4_

  - [x] 3.4 Add follow-up action support
    - Implement follow-up handlers for Edit, Delete, Add actions
    - Use `ChatResponseCommandButtonPart` for follow-up prompts
    - Add state management for multi-step interactions
    - _Requirements: 4.5, 5.3_

- [x] 4. Implement SectionEditorService
  - [x] 4.1 Create editor service infrastructure
    - Create `SectionEditorService` class in `src/extension/promptSectionVisualizer/vscode-node/sectionEditorService.ts`
    - Define editor options and configuration
    - Add service registration
    - _Requirements: 3.1, 3.2_

  - [x] 4.2 Implement document-based editing
    - Create `editSection()` method to open section in temporary document
    - Add Monaco editor integration with syntax highlighting
    - Implement save/close detection and content retrieval
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 4.3 Implement inline editing
    - Create `editSectionInline()` method using `showInputBox`
    - Add multi-line input support for larger sections
    - Implement validation and error handling
    - _Requirements: 3.1, 3.3_

  - [x] 4.4 Add editor state preservation
    - Integrate with existing editor state management
    - Preserve cursor position and scroll state
    - Implement undo/redo support using VS Code's command system
    - _Requirements: 3.4, 6.4_

- [x] 5. Create command handlers for section actions
  - [x] 5.1 Implement Edit Section command
    - Register `github.copilot.promptVisualizer.editSection` command
    - Integrate with `SectionEditorService`
    - Update section content in `PromptStateManager`
    - Trigger re-render after edit
    - _Requirements: 3.1, 3.3, 5.2_

  - [x] 5.2 Implement Delete Section command
    - Register `github.copilot.promptVisualizer.deleteSection` command
    - Add confirmation dialog using `ChatResponseConfirmationPart` or `showWarningMessage`
    - Remove section from `PromptStateManager`
    - Trigger re-render after deletion
    - _Requirements: 5.4, 6.4_

  - [x] 5.3 Implement Toggle Collapse command
    - Register `github.copilot.promptVisualizer.toggleCollapse` command
    - Update collapse state in `PromptStateManager`
    - Trigger re-render with updated state
    - _Requirements: 2.5, 6.4_

  - [x] 5.4 Implement Add Section command
    - Register `github.copilot.promptVisualizer.addSection` command
    - Use quick pick or input box for tag name and content
    - Add section to `PromptStateManager`
    - Trigger re-render with new section
    - _Requirements: 5.3, 6.4_

  - [x] 5.5 Implement Reorder Section commands
    - Register `github.copilot.promptVisualizer.moveSectionUp` command
    - Register `github.copilot.promptVisualizer.moveSectionDown` command
    - Update section order in `PromptStateManager`
    - Trigger re-render with new order
    - _Requirements: 5.2, 6.5_

- [x] 6. Implement hybrid mode support
  - [x] 6.1 Create PromptVisualizerController
    - Create `PromptVisualizerController` class in `src/extension/promptSectionVisualizer/vscode-node/controller.ts`
    - Add mode detection logic (inline vs standalone)
    - Implement mode switching based on configuration
    - _Requirements: 7.1, 7.2, 7.5_

  - [x] 6.2 Implement standalone webview mode
    - Update `PromptSectionVisualizerProvider` to use VS Code Webview UI Toolkit
    - Replace custom HTML/CSS with native webview components
    - Integrate `NativeChatRenderer` for content rendering where possible
    - _Requirements: 7.1, 7.4_

  - [x] 6.3 Implement inline chat mode
    - Create `renderInline()` method in controller
    - Use `NativeChatRenderer` to stream sections to chat
    - Handle chat context and follow-up interactions
    - _Requirements: 7.2, 7.3_

  - [x] 6.4 Add mode configuration
    - Add `github.copilot.promptVisualizer.renderMode` setting
    - Implement auto-detection logic (chat context vs standalone)
    - Add command to switch between modes
    - _Requirements: 7.5_

- [x] 7. Update ChatIntegrationService for native rendering
  - [x] 7.1 Refactor chat input synchronization
    - Update `ChatIntegrationService` to work with both rendering modes
    - Add support for chat participant integration
    - Maintain backward compatibility with existing webview
    - _Requirements: 4.2, 6.2_

  - [x] 7.2 Add chat command registration
    - Register `/visualize-prompt` command in chat
    - Register `/edit-section` command in chat
    - Add command descriptions and help text
    - _Requirements: 4.2_

  - [x] 7.3 Implement bidirectional sync for inline mode
    - Sync section edits back to chat input
    - Handle chat input changes in inline mode
    - Prevent circular updates
    - _Requirements: 4.4, 6.2_

- [x] 8. Remove deprecated custom WebView code
  - [x] 8.1 Mark old implementation as deprecated
    - Add deprecation notices to `PromptSectionVisualizerProvider`
    - Add migration guide in code comments
    - Update documentation to reflect new architecture
    - _Requirements: 8.1, 8.3, 9.3_

  - [x] 8.2 Remove custom HTML/CSS/JavaScript files
    - Delete or archive `media/promptSectionVisualizer.js`
    - Delete or archive `media/promptSectionVisualizer.css`
    - Remove custom WebView message passing logic
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 8.3 Clean up unused code
    - Remove custom accessibility implementations (replaced by native)
    - Remove custom theming code (replaced by native)
    - Remove custom event handling (replaced by commands)
    - _Requirements: 8.4, 8.5_

- [x] 9. Add core tests for implemented features





  - [x] 9.1 Create unit tests for NativeChatRenderer


    - Test section header generation with different token counts
    - Test token warning rendering for warning and critical levels
    - Test action button rendering (Edit, Delete, Collapse)
    - Test streaming rendering with progressive batching
    - Test error handling and recovery
    - _Requirements: 1.1, 2.1, 2.3, 5.1_

  - [x] 9.2 Create unit tests for PromptVisualizerChatParticipant


    - Test command routing for `/visualize-prompt` and `/edit-section`
    - Test `/visualize-prompt` handler with valid and empty prompts
    - Test `/edit-section` handler with valid and invalid section IDs
    - Test error handling for malformed requests
    - Test follow-up prompt generation
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 9.3 Create unit tests for SectionEditorService


    - Test document-based editing flow (open, edit, save, close)
    - Test inline editing with validation
    - Test state preservation (cursor position, scroll state)
    - Test undo/redo functionality
    - Test multi-line input handling
    - _Requirements: 3.1, 3.2, 3.4_



  - [x] 9.4 Create integration tests for command handlers
    - Test Edit Section command end-to-end flow
    - Test Delete Section command with confirmation
    - Test Add Section command with validation
    - Test Toggle Collapse command state changes
    - Test Reorder Section commands (move up/down)
    - Test re-rendering after each command
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 9.5 Create end-to-end tests for hybrid mode






    - Test standalone mode rendering
    - Test inline chat mode rendering
    - Test mode switching
    - Test feature parity between modes
    - _Requirements: 7.1, 7.2, 7.4, 7.5_

  - [x] 9.6 Update existing tests






    - Update tests that depend on custom WebView
    - Remove tests for deprecated code
    - Ensure all existing functionality is covered
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 10. Add documentation and examples
  - [ ]* 10.1 Update inline code documentation
    - Add JSDoc comments to `NativeChatRenderer`
    - Add JSDoc comments to `PromptVisualizerChatParticipant`
    - Add JSDoc comments to `SectionEditorService`
    - Document all public APIs and interfaces
    - _Requirements: 9.1_

  - [ ]* 10.2 Create usage examples
    - Add example of rendering sections in chat
    - Add example of editing sections
    - Add example of custom section types
    - Add example of hybrid mode usage
    - _Requirements: 9.2_

  - [ ]* 10.3 Update design document
    - Reflect actual implementation details
    - Add architecture diagrams
    - Document API changes
    - Add troubleshooting guide
    - _Requirements: 9.3, 9.5_

  - [ ]* 10.4 Create migration guide
    - Document breaking changes
    - Provide migration steps for users
    - Add FAQ section
    - Include before/after comparisons
    - _Requirements: 9.3_

- [ ] 11. Performance optimization
  - [x] 11.1 Implement progressive rendering
    - Add batching for large section lists
    - Implement "Load More" functionality
    - Add loading indicators using `ChatResponseProgressPart`
    - _Requirements: 4.3, 5.5_

  - [ ]* 11.2 Optimize token calculation
    - Leverage existing caching in `TokenUsageCalculator`
    - Add debouncing for real-time updates
    - Implement background calculation for large prompts
    - _Requirements: 6.3_

  - [ ]* 11.3 Add performance monitoring
    - Track rendering time for sections
    - Monitor memory usage
    - Add telemetry for performance metrics
    - _Requirements: 6.3_

- [ ] 12. Accessibility and theming validation
  - [ ]* 12.1 Validate native accessibility features
    - Test with screen readers (NVDA, JAWS, VoiceOver)
    - Verify keyboard navigation works correctly
    - Ensure ARIA labels are appropriate
    - _Requirements: 8.4_

  - [ ]* 12.2 Validate theming support
    - Test in light theme
    - Test in dark theme
    - Test in high contrast themes
    - Verify automatic theme switching
    - _Requirements: 1.5, 8.5_

  - [ ]* 12.3 Test with different VS Code versions
    - Test on minimum supported VS Code version
    - Test on latest stable VS Code version
    - Test on VS Code Insiders
    - _Requirements: 6.1_

- [x] 13. Feature flag and gradual rollout
  - [x] 13.1 Implement feature flag system
    - Add `github.copilot.promptVisualizer.useNativeRendering` setting
    - Default to `false` initially for testing
    - Add runtime toggle for A/B testing
    - _Requirements: 7.5_

  - [ ]* 13.2 Add telemetry for feature adoption
    - Track usage of native rendering vs old rendering
    - Monitor error rates for each mode
    - Collect user feedback
    - _Requirements: 6.3_

  - [ ] 13.3 Plan gradual rollout
    - Phase 1: Internal testing (feature flag off by default) ✓ COMPLETE
    - Phase 2: Beta testing (opt-in via setting) ← CURRENT PHASE
    - Phase 3: General availability (feature flag on by default)
    - Phase 4: Remove old implementation
    - _Requirements: 8.1, 8.2_

---

## Implementation Notes

### Critical Path
The critical path for this migration is:
1. Tasks 1-2: Core rendering infrastructure
2. Tasks 3-4: Chat participant and editor service
3. Task 5: Command handlers
4. Task 6: Hybrid mode support
5. Task 13: Feature flag and rollout

### Dependencies
- Task 3 depends on Task 2 (NativeChatRenderer must exist)
- Task 5 depends on Task 4 (commands need editor service)
- Task 6 depends on Tasks 2-5 (controller needs all components)
- Task 8 depends on Task 13 (only remove old code after successful rollout)
- Task 9 should be done in parallel with implementation tasks

### Testing Priority
- **Critical**: Unit tests (Task 9.1-9.3) are now required to validate the implemented features and catch bugs early
- **Critical**: Integration tests (Task 9.4) are required to ensure command handlers work end-to-end
- **Optional**: E2E tests (Task 9.5-9.6) can be deferred but are recommended for comprehensive coverage
- Tests should focus on core functionality and common use cases first, then expand to edge cases

### Code Reduction Target
After completing Task 8, the codebase should be reduced by approximately:
- ~1000 lines from `media/promptSectionVisualizer.js`
- ~500 lines from `media/promptSectionVisualizer.css`
- ~200 lines from WebView message passing logic
- **Total: ~1700 lines removed**

### Backward Compatibility
- Maintain old WebView implementation until Task 13.3 Phase 4
- Ensure all existing features work in both modes
- Provide migration path for users with custom configurations

---

## Current Status Summary

### ✅ Completed (Core Implementation)
All core functionality has been implemented and tested:
- **Infrastructure**: NativeChatRenderer, PromptVisualizerChatParticipant, SectionEditorService, PromptVisualizerController
- **Commands**: All section action commands (edit, delete, add, toggle, reorder) are registered and functional
- **Hybrid Mode**: Both inline chat and standalone webview modes are supported with auto-detection
- **Feature Flags**: Configuration settings for `useNativeRendering` and `renderMode` are in place
- **Code Cleanup**: Custom WebView files (promptSectionVisualizer.js/css) have been removed
- **Core Tests**: Unit tests for NativeChatRenderer, ChatParticipant, SectionEditorService, and integration tests for command handlers

### 🔄 Current Phase: Beta Testing (Phase 2)
The feature is ready for opt-in beta testing:
- Feature flag `github.copilot.chat.promptSectionVisualizer.useNativeRendering` defaults to `false`
- Users can enable native rendering via settings
- All core functionality is complete and tested

### 📋 Remaining Optional Tasks
The following tasks are marked as optional and can be completed as needed:
- **Documentation** (Task 10): Inline JSDoc comments, usage examples, migration guide
- **Performance Optimization** (Task 11.2-11.3): Token calculation optimization, performance monitoring
- **Accessibility Validation** (Task 12): Screen reader testing, theme validation, VS Code version compatibility
- **Telemetry** (Task 13.2): Usage tracking and error monitoring
- **E2E Tests** (Task 9.5-9.6): Hybrid mode end-to-end tests, test updates

### 🎯 Next Steps for Production
To move to Phase 3 (General Availability):
1. Gather beta user feedback
2. Monitor for any issues or edge cases
3. Complete optional performance optimizations if needed
4. Update feature flag default to `true`
5. Plan Phase 4 removal of deprecated WebView code
