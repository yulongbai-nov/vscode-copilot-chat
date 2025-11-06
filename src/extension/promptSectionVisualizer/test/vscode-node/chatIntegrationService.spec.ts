/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ILogService } from '../../../../platform/log/common/logService';
import { IFeatureFlagService, IPromptStateManager } from '../../common/services';
import { PromptSection, VisualizerState } from '../../common/types';
import { ChatIntegrationService } from '../../vscode-node/chatIntegrationService';

// Mock vscode module
vi.mock('vscode', () => ({
	workspace: {
		onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		textDocuments: [],
		applyEdit: vi.fn()
	},
	WorkspaceEdit: vi.fn(() => ({
		replace: vi.fn()
	})),
	Range: vi.fn((start, end) => ({ start, end })),
	Uri: {
		parse: vi.fn()
	}
}));

describe('ChatIntegrationService - Chat Integration', () => {
	let service: ChatIntegrationService;
	let mockLogService: ILogService;
	let mockStateManager: IPromptStateManager;
	let mockFeatureFlagService: IFeatureFlagService;
	let stateChangeListeners: Array<(state: VisualizerState) => void>;

	const createMockSection = (id: string, content: string, tagName: string = 'context'): PromptSection => ({
		id,
		tagName,
		content,
		startIndex: 0,
		endIndex: content.length,
		tokenCount: 10,
		isEditing: false,
		isCollapsed: false,
		hasRenderableElements: false
	});

	const createMockState = (sections: PromptSection[]): VisualizerState => ({
		sections,
		totalTokens: sections.reduce((sum, s) => sum + s.tokenCount, 0),
		isEnabled: true,
		currentLanguageModel: 'gpt-4',
		uiTheme: 'dark'
	});

	beforeEach(() => {
		stateChangeListeners = [];

		// Create mock log service
		mockLogService = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn()
		} as any;

		// Create mock state manager
		mockStateManager = {
			getCurrentState: vi.fn().mockReturnValue(createMockState([])),
			updatePrompt: vi.fn(),
			updateSection: vi.fn(),
			reorderSections: vi.fn(),
			addSection: vi.fn(),
			removeSection: vi.fn(),
			toggleSectionCollapse: vi.fn(),
			switchSectionMode: vi.fn(),
			onDidChangeState: vi.fn((listener) => {
				stateChangeListeners.push(listener);
				return { dispose: vi.fn() };
			}),
			dispose: vi.fn()
		} as any;

		// Create mock feature flag service
		mockFeatureFlagService = {
			isNativeRenderingEnabled: vi.fn().mockReturnValue(true),
			getRenderMode: vi.fn().mockReturnValue('standalone'),
			isVisualizerEnabled: vi.fn().mockReturnValue(true),
			getEffectiveRenderMode: vi.fn().mockReturnValue('standalone'),
			onConfigurationChanged: vi.fn(() => ({ dispose: vi.fn() }))
		} as any;

		// Create service
		service = new ChatIntegrationService(mockLogService, mockStateManager, mockFeatureFlagService);
	});

	describe('chat input synchronization', () => {
		it('should update visualizer from chat input', async () => {
			const chatInput = '<context>Test context</context><instructions>Do something</instructions>';

			service.updateFromChatInput(chatInput);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 350));

			expect(mockStateManager.updatePrompt).toHaveBeenCalledWith(chatInput);
			expect(mockLogService.trace).toHaveBeenCalledWith(
				expect.stringContaining('Updated visualizer from chat input')
			);
		});

		it('should debounce rapid chat input updates', async () => {
			const input1 = '<context>First</context>';
			const input2 = '<context>Second</context>';
			const input3 = '<context>Third</context>';

			service.updateFromChatInput(input1);
			await new Promise(resolve => setTimeout(resolve, 100));
			service.updateFromChatInput(input2);
			await new Promise(resolve => setTimeout(resolve, 100));
			service.updateFromChatInput(input3);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 350));

			// Should only call updatePrompt once with the last value
			expect(mockStateManager.updatePrompt).toHaveBeenCalledTimes(1);
			expect(mockStateManager.updatePrompt).toHaveBeenCalledWith(input3);
		});

		it('should handle empty chat input', async () => {
			service.updateFromChatInput('');

			await new Promise(resolve => setTimeout(resolve, 350));

			expect(mockStateManager.updatePrompt).toHaveBeenCalledWith('');
		});

		it('should handle chat input without XML tags', async () => {
			const plainText = 'Just plain text without tags';

			service.updateFromChatInput(plainText);

			await new Promise(resolve => setTimeout(resolve, 350));

			expect(mockStateManager.updatePrompt).toHaveBeenCalledWith(plainText);
		});

		it('should log error on update failure', async () => {
			const error = new Error('Update failed');
			vi.mocked(mockStateManager.updatePrompt).mockImplementation(() => {
				throw error;
			});

			service.updateFromChatInput('<context>Test</context>');

			await new Promise(resolve => setTimeout(resolve, 350));

			expect(mockLogService.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to update visualizer'),
				error
			);
		});
	});

	describe('bidirectional content updates', () => {
		it('should get visualizer prompt for chat input sync', () => {
			const sections = [
				createMockSection('1', 'Context content', 'context'),
				createMockSection('2', 'Instructions content', 'instructions')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const result = service.getVisualizerPrompt();

			expect(result).toBe('<context>Context content</context>\n<instructions>Instructions content</instructions>');
		});

		it('should emit event when visualizer state changes', () => {
			const eventListener = vi.fn();
			service.onDidChangeChatInput(eventListener);

			const sections = [createMockSection('1', 'Updated content', 'context')];
			const newState = createMockState(sections);

			// Update mock to return new state before triggering change
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(newState);

			// Trigger state change
			stateChangeListeners.forEach(listener => listener(newState));

			expect(eventListener).toHaveBeenCalledWith('<context>Updated content</context>');
			expect(mockLogService.trace).toHaveBeenCalledWith(
				expect.stringContaining('Visualizer state changed, prompt updated')
			);
		});

		it('should handle multiple state change listeners', () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();

			service.onDidChangeChatInput(listener1);
			service.onDidChangeChatInput(listener2);

			const sections = [createMockSection('1', 'Test', 'context')];
			const newState = createMockState(sections);

			stateChangeListeners.forEach(listener => listener(newState));

			expect(listener1).toHaveBeenCalled();
			expect(listener2).toHaveBeenCalled();
		});

		it('should reconstruct prompt with multiple sections', () => {
			const sections = [
				createMockSection('1', 'Context 1', 'context'),
				createMockSection('2', 'Context 2', 'background'),
				createMockSection('3', 'Do this', 'instructions'),
				createMockSection('4', 'Example code', 'examples')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const result = service.getVisualizerPrompt();

			expect(result).toBe(
				'<context>Context 1</context>\n' +
				'<background>Context 2</background>\n' +
				'<instructions>Do this</instructions>\n' +
				'<examples>Example code</examples>'
			);
		});

		it('should handle empty sections list', () => {
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState([]));

			const result = service.getVisualizerPrompt();

			expect(result).toBe('');
		});
	});

	describe('integration workflow', () => {
		it('should handle complete edit workflow', async () => {
			const eventListener = vi.fn();
			service.onDidChangeChatInput(eventListener);

			// 1. User types in chat input
			const initialInput = '<context>Initial context</context>';
			service.updateFromChatInput(initialInput);
			await new Promise(resolve => setTimeout(resolve, 350));

			expect(mockStateManager.updatePrompt).toHaveBeenCalledWith(initialInput);

			// 2. User edits section in visualizer
			const updatedSections = [createMockSection('1', 'Updated context', 'context')];
			const updatedState = createMockState(updatedSections);
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(updatedState);

			// 3. State change triggers chat input update
			stateChangeListeners.forEach(listener => listener(updatedState));

			expect(eventListener).toHaveBeenCalledWith('<context>Updated context</context>');
		});

		it('should handle section reordering workflow', async () => {
			const eventListener = vi.fn();
			service.onDidChangeChatInput(eventListener);

			// Initial state with multiple sections
			const initialSections = [
				createMockSection('1', 'Context', 'context'),
				createMockSection('2', 'Instructions', 'instructions')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(initialSections));

			// User reorders sections
			const reorderedSections = [
				createMockSection('2', 'Instructions', 'instructions'),
				createMockSection('1', 'Context', 'context')
			];
			const reorderedState = createMockState(reorderedSections);
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(reorderedState);

			stateChangeListeners.forEach(listener => listener(reorderedState));

			expect(eventListener).toHaveBeenCalledWith(
				'<instructions>Instructions</instructions>\n<context>Context</context>'
			);
		});

		it('should handle section addition workflow', async () => {
			const eventListener = vi.fn();
			service.onDidChangeChatInput(eventListener);

			// Start with one section
			const initialSections = [createMockSection('1', 'Context', 'context')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(initialSections));

			// Add new section
			const updatedSections = [
				createMockSection('1', 'Context', 'context'),
				createMockSection('2', 'New instructions', 'instructions')
			];
			const updatedState = createMockState(updatedSections);
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(updatedState);

			stateChangeListeners.forEach(listener => listener(updatedState));

			expect(eventListener).toHaveBeenCalledWith(
				'<context>Context</context>\n<instructions>New instructions</instructions>'
			);
		});

		it('should handle section deletion workflow', async () => {
			const eventListener = vi.fn();
			service.onDidChangeChatInput(eventListener);

			// Start with two sections
			const initialSections = [
				createMockSection('1', 'Context', 'context'),
				createMockSection('2', 'Instructions', 'instructions')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(initialSections));

			// Delete one section
			const updatedSections = [createMockSection('1', 'Context', 'context')];
			const updatedState = createMockState(updatedSections);
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(updatedState);

			stateChangeListeners.forEach(listener => listener(updatedState));

			expect(eventListener).toHaveBeenCalledWith('<context>Context</context>');
		});
	});

	describe('disposal', () => {
		it('should clear debounce timer on disposal', async () => {
			service.updateFromChatInput('<context>Test</context>');

			// Dispose before debounce completes
			service.dispose();

			// Wait for what would have been the debounce time
			await new Promise(resolve => setTimeout(resolve, 350));

			// Should not have called updatePrompt since service was disposed
			expect(mockStateManager.updatePrompt).not.toHaveBeenCalled();
		});

		it('should handle disposal without pending updates', () => {
			expect(() => service.dispose()).not.toThrow();
		});

		it('should not process updates after disposal', async () => {
			// Start an update
			service.updateFromChatInput('<context>Test</context>');

			// Dispose immediately (before debounce completes)
			service.dispose();

			// Wait for what would have been the debounce time
			await new Promise(resolve => setTimeout(resolve, 350));

			// Should not have called updatePrompt since service was disposed
			expect(mockStateManager.updatePrompt).not.toHaveBeenCalled();
		});
	});

	describe('error handling', () => {
		it('should handle state manager errors gracefully', async () => {
			vi.mocked(mockStateManager.updatePrompt).mockImplementation(() => {
				throw new Error('State manager error');
			});

			service.updateFromChatInput('<context>Test</context>');

			await new Promise(resolve => setTimeout(resolve, 350));

			expect(mockLogService.error).toHaveBeenCalled();
		});

		it('should handle getCurrentState errors', () => {
			vi.mocked(mockStateManager.getCurrentState).mockImplementation(() => {
				throw new Error('Get state error');
			});

			expect(() => service.getVisualizerPrompt()).toThrow();
		});
	});

	describe('chat input monitoring', () => {
		it('should log chat input monitoring setup', () => {
			// Verify that the service logged the setup completion
			expect(mockLogService.info).toHaveBeenCalledWith(
				expect.stringContaining('Chat input monitoring setup complete')
			);
		});

		it('should handle chat input changes with debouncing', async () => {
			// This test verifies the core functionality works
			// The actual vscode event registration is tested through integration tests
			const chatInput = '<context>Test from chat</context>';

			service.updateFromChatInput(chatInput);
			await new Promise(resolve => setTimeout(resolve, 350));

			expect(mockStateManager.updatePrompt).toHaveBeenCalledWith(chatInput);
		});
	});
});
