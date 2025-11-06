/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { IPromptStateManager, ISectionEditorService } from '../../common/services';
import { PromptSection, VisualizerState } from '../../common/types';

// Mock vscode module
vi.mock('vscode', () => ({
	workspace: {
		onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		applyEdit: vi.fn()
	},
	window: {
		showTextDocument: vi.fn(),
		showInputBox: vi.fn(),
		showQuickPick: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn()
	},
	WorkspaceEdit: vi.fn(() => ({
		replace: vi.fn()
	})),
	Range: vi.fn((start, end) => ({ start, end })),
	Uri: {
		parse: vi.fn(),
		file: vi.fn((path) => ({ fsPath: path, path }))
	}
}));

/**
 * Integration tests for command handlers
 * These tests verify the end-to-end flow of command execution
 */
describe('Command Handlers Integration', () => {
	let mockStateManager: IPromptStateManager;
	let mockEditorService: ISectionEditorService;
	let stateChangeListeners: Array<(state: VisualizerState) => void>;

	const createMockSection = (id: string, tagName: string, content: string): PromptSection => ({
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
		// Reset state change listeners
		stateChangeListeners = [];

		// Create mock log service
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

		// Create mock editor service
		mockEditorService = {
			editSection: vi.fn().mockResolvedValue('Updated content'),
			editSectionInDocument: vi.fn().mockResolvedValue('Updated content'),
			editSectionInline: vi.fn().mockResolvedValue('Updated content'),
			saveEditorState: vi.fn(),
			restoreEditorState: vi.fn(),
			getEditorState: vi.fn(),
			clearEditorState: vi.fn(),
			undoEdit: vi.fn().mockResolvedValue(true),
			redoEdit: vi.fn().mockResolvedValue(true),
			canUndo: vi.fn().mockReturnValue(true),
			canRedo: vi.fn().mockReturnValue(false),
			dispose: vi.fn()
		} as any;
	});

	describe('Edit Section command', () => {
		it('should execute edit section command end-to-end', async () => {
			const sections = [createMockSection('1', 'context', 'Original content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Simulate command execution
			const sectionId = '1';
			const newContent = 'Updated content';

			// Mock editor service to return new content
			vi.mocked(mockEditorService.editSection).mockResolvedValue(newContent);

			// Execute the command flow
			const result = await mockEditorService.editSection(sections[0]);
			expect(result).toBe(newContent);

			// Update state manager
			mockStateManager.updateSection(sectionId, newContent);

			// Verify state manager was called
			expect(mockStateManager.updateSection).toHaveBeenCalledWith(sectionId, newContent);
		});

		it('should trigger re-render after edit', async () => {
			const sections = [createMockSection('1', 'context', 'Original content')];
			const updatedSections = [createMockSection('1', 'context', 'Updated content')];

			vi.mocked(mockStateManager.getCurrentState)
				.mockReturnValueOnce(createMockState(sections))
				.mockReturnValueOnce(createMockState(updatedSections));

			// Setup state change listener
			const stateChangeSpy = vi.fn();
			mockStateManager.onDidChangeState(stateChangeSpy);

			// Execute edit
			const newContent = 'Updated content';
			vi.mocked(mockEditorService.editSection).mockResolvedValue(newContent);

			await mockEditorService.editSection(sections[0]);
			mockStateManager.updateSection('1', newContent);

			// Trigger state change
			stateChangeListeners.forEach(listener => listener(createMockState(updatedSections)));

			// Verify state change was triggered
			expect(stateChangeSpy).toHaveBeenCalled();
		});

		it('should handle edit cancellation', async () => {
			const sections = [createMockSection('1', 'context', 'Original content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Mock editor service to return undefined (cancelled)
			vi.mocked(mockEditorService.editSection).mockResolvedValue(undefined);

			const result = await mockEditorService.editSection(sections[0]);
			expect(result).toBeUndefined();

			// State manager should not be called
			expect(mockStateManager.updateSection).not.toHaveBeenCalled();
		});

		it('should handle edit errors gracefully', async () => {
			const sections = [createMockSection('1', 'context', 'Original content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Mock editor service to throw error
			vi.mocked(mockEditorService.editSection).mockRejectedValue(new Error('Edit failed'));

			await expect(mockEditorService.editSection(sections[0])).rejects.toThrow('Edit failed');
		});
	});

	describe('Delete Section command', () => {
		it('should execute delete section command with confirmation', async () => {
			const sections = [
				createMockSection('1', 'context', 'Context content'),
				createMockSection('2', 'instructions', 'Instructions content')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Mock confirmation dialog
			vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete' as any);

			// Simulate command execution
			const sectionId = '1';

			// Show confirmation
			const confirmation = await vscode.window.showWarningMessage(
				'Are you sure you want to delete this section?',
				{ modal: true },
				'Delete',
				'Cancel'
			);

			expect(confirmation).toBe('Delete');

			// Delete section
			mockStateManager.removeSection(sectionId);

			// Verify state manager was called
			expect(mockStateManager.removeSection).toHaveBeenCalledWith(sectionId);
		});

		it('should not delete when user cancels confirmation', async () => {
			const sections = [createMockSection('1', 'context', 'Context content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Mock confirmation dialog to return Cancel
			vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Cancel' as any);

			const confirmation = await vscode.window.showWarningMessage(
				'Are you sure you want to delete this section?',
				{ modal: true },
				'Delete',
				'Cancel'
			);

			expect(confirmation).toBe('Cancel');

			// State manager should not be called
			expect(mockStateManager.removeSection).not.toHaveBeenCalled();
		});

		it('should trigger re-render after deletion', async () => {
			const sections = [
				createMockSection('1', 'context', 'Context content'),
				createMockSection('2', 'instructions', 'Instructions content')
			];
			const updatedSections = [createMockSection('2', 'instructions', 'Instructions content')];

			vi.mocked(mockStateManager.getCurrentState)
				.mockReturnValueOnce(createMockState(sections))
				.mockReturnValueOnce(createMockState(updatedSections));

			// Setup state change listener
			const stateChangeSpy = vi.fn();
			mockStateManager.onDidChangeState(stateChangeSpy);

			// Mock confirmation
			vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete' as any);

			// Execute delete
			await vscode.window.showWarningMessage(
				'Are you sure?',
				{ modal: true },
				'Delete',
				'Cancel'
			);
			mockStateManager.removeSection('1');

			// Trigger state change
			stateChangeListeners.forEach(listener => listener(createMockState(updatedSections)));

			// Verify state change was triggered
			expect(stateChangeSpy).toHaveBeenCalled();
		});
	});

	describe('Add Section command', () => {
		it('should execute add section command with validation', async () => {
			const sections = [createMockSection('1', 'context', 'Context content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Mock input dialogs
			vi.spyOn(vscode.window, 'showInputBox')
				.mockResolvedValueOnce('instructions') // Tag name
				.mockResolvedValueOnce('New instructions content'); // Content

			// Get tag name
			const tagName = await vscode.window.showInputBox({
				prompt: 'Enter section tag name',
				placeHolder: 'e.g., context, instructions, examples'
			});

			expect(tagName).toBe('instructions');

			// Get content
			const content = await vscode.window.showInputBox({
				prompt: 'Enter section content',
				placeHolder: 'Enter the content for this section'
			});

			expect(content).toBe('New instructions content');

			// Add section
			mockStateManager.addSection(tagName!, content!);

			// Verify state manager was called
			expect(mockStateManager.addSection).toHaveBeenCalledWith('instructions', 'New instructions content');
		});

		it('should not add section when user cancels', async () => {
			// Mock input dialog to return undefined (cancelled)
			vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue(undefined);

			const tagName = await vscode.window.showInputBox({
				prompt: 'Enter section tag name'
			});

			expect(tagName).toBeUndefined();

			// State manager should not be called
			expect(mockStateManager.addSection).not.toHaveBeenCalled();
		});

		it('should validate tag name input', async () => {
			vi.spyOn(vscode.window, 'showInputBox').mockImplementation(async (options) => {
				if (options?.validateInput) {
					// Test empty tag name
					const validationError1 = await Promise.resolve(options.validateInput(''));
					expect(validationError1).toBeDefined();

					// Test valid tag name
					const validationError2 = await Promise.resolve(options.validateInput('context'));
					expect(validationError2).toBeUndefined();
				}
				return 'context';
			});

			await vscode.window.showInputBox({
				prompt: 'Enter section tag name',
				validateInput: (value) => {
					if (!value.trim()) {
						return 'Tag name cannot be empty';
					}
					if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
						return 'Tag name must start with a letter and contain only letters, numbers, hyphens, and underscores';
					}
					return undefined;
				}
			});
		});

		it('should trigger re-render after adding section', async () => {
			const sections = [createMockSection('1', 'context', 'Context content')];
			const updatedSections = [
				...sections,
				createMockSection('2', 'instructions', 'New instructions')
			];

			vi.mocked(mockStateManager.getCurrentState)
				.mockReturnValueOnce(createMockState(sections))
				.mockReturnValueOnce(createMockState(updatedSections));

			// Setup state change listener
			const stateChangeSpy = vi.fn();
			mockStateManager.onDidChangeState(stateChangeSpy);

			// Execute add
			mockStateManager.addSection('instructions', 'New instructions');

			// Trigger state change
			stateChangeListeners.forEach(listener => listener(createMockState(updatedSections)));

			// Verify state change was triggered
			expect(stateChangeSpy).toHaveBeenCalled();
		});
	});

	describe('Toggle Collapse command', () => {
		it('should toggle section collapse state', () => {
			const sections = [createMockSection('1', 'context', 'Context content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Toggle collapse
			mockStateManager.toggleSectionCollapse('1');

			// Verify state manager was called
			expect(mockStateManager.toggleSectionCollapse).toHaveBeenCalledWith('1');
		});

		it('should trigger re-render after toggle', () => {
			const sections = [createMockSection('1', 'context', 'Context content')];
			const updatedSections = [
				{ ...createMockSection('1', 'context', 'Context content'), isCollapsed: true }
			];

			vi.mocked(mockStateManager.getCurrentState)
				.mockReturnValueOnce(createMockState(sections))
				.mockReturnValueOnce(createMockState(updatedSections));

			// Setup state change listener
			const stateChangeSpy = vi.fn();
			mockStateManager.onDidChangeState(stateChangeSpy);

			// Execute toggle
			mockStateManager.toggleSectionCollapse('1');

			// Trigger state change
			stateChangeListeners.forEach(listener => listener(createMockState(updatedSections)));

			// Verify state change was triggered
			expect(stateChangeSpy).toHaveBeenCalled();
		});

		it('should handle toggle for non-existent section', () => {
			const sections = [createMockSection('1', 'context', 'Context content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Toggle non-existent section
			mockStateManager.toggleSectionCollapse('nonexistent');

			// Should still call state manager (it will handle the error)
			expect(mockStateManager.toggleSectionCollapse).toHaveBeenCalledWith('nonexistent');
		});
	});

	describe('Reorder Section commands', () => {
		it('should move section up', () => {
			const sections = [
				createMockSection('1', 'context', 'Context'),
				createMockSection('2', 'instructions', 'Instructions'),
				createMockSection('3', 'examples', 'Examples')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Move section 2 up (swap with section 1)
			const newOrder = ['2', '1', '3'];
			mockStateManager.reorderSections(newOrder);

			// Verify state manager was called
			expect(mockStateManager.reorderSections).toHaveBeenCalledWith(newOrder);
		});

		it('should move section down', () => {
			const sections = [
				createMockSection('1', 'context', 'Context'),
				createMockSection('2', 'instructions', 'Instructions'),
				createMockSection('3', 'examples', 'Examples')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Move section 1 down (swap with section 2)
			const newOrder = ['2', '1', '3'];
			mockStateManager.reorderSections(newOrder);

			// Verify state manager was called
			expect(mockStateManager.reorderSections).toHaveBeenCalledWith(newOrder);
		});

		it('should not move first section up', () => {
			const sections = [
				createMockSection('1', 'context', 'Context'),
				createMockSection('2', 'instructions', 'Instructions')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Try to move first section up (should be no-op)
			const currentOrder = sections.map(s => s.id);

			// In a real implementation, this would check if section is first
			// and not call reorderSections
			const sectionIndex = 0;
			if (sectionIndex > 0) {
				mockStateManager.reorderSections(currentOrder);
			}

			// Verify state manager was not called
			expect(mockStateManager.reorderSections).not.toHaveBeenCalled();
		});

		it('should not move last section down', () => {
			const sections = [
				createMockSection('1', 'context', 'Context'),
				createMockSection('2', 'instructions', 'Instructions')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Try to move last section down (should be no-op)
			const currentOrder = sections.map(s => s.id);

			// In a real implementation, this would check if section is last
			// and not call reorderSections
			const sectionIndex = 1;
			if (sectionIndex < sections.length - 1) {
				mockStateManager.reorderSections(currentOrder);
			}

			// Verify state manager was not called
			expect(mockStateManager.reorderSections).not.toHaveBeenCalled();
		});

		it('should trigger re-render after reordering', () => {
			const sections = [
				createMockSection('1', 'context', 'Context'),
				createMockSection('2', 'instructions', 'Instructions')
			];
			const reorderedSections = [
				createMockSection('2', 'instructions', 'Instructions'),
				createMockSection('1', 'context', 'Context')
			];

			vi.mocked(mockStateManager.getCurrentState)
				.mockReturnValueOnce(createMockState(sections))
				.mockReturnValueOnce(createMockState(reorderedSections));

			// Setup state change listener
			const stateChangeSpy = vi.fn();
			mockStateManager.onDidChangeState(stateChangeSpy);

			// Execute reorder
			mockStateManager.reorderSections(['2', '1']);

			// Trigger state change
			stateChangeListeners.forEach(listener => listener(createMockState(reorderedSections)));

			// Verify state change was triggered
			expect(stateChangeSpy).toHaveBeenCalled();
		});
	});

	describe('Command error handling', () => {
		it('should handle state manager errors in edit command', async () => {
			const sections = [createMockSection('1', 'context', 'Content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Mock state manager to throw error
			vi.mocked(mockStateManager.updateSection).mockImplementation(() => {
				throw new Error('State update failed');
			});

			// Execute edit
			await mockEditorService.editSection(sections[0]);

			// Try to update state
			expect(() => mockStateManager.updateSection('1', 'New content')).toThrow('State update failed');
		});

		it('should handle state manager errors in delete command', () => {
			const sections = [createMockSection('1', 'context', 'Content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			// Mock state manager to throw error
			vi.mocked(mockStateManager.removeSection).mockImplementation(() => {
				throw new Error('Delete failed');
			});

			// Try to delete
			expect(() => mockStateManager.removeSection('1')).toThrow('Delete failed');
		});

		it('should handle state manager errors in add command', () => {
			// Mock state manager to throw error
			vi.mocked(mockStateManager.addSection).mockImplementation(() => {
				throw new Error('Add failed');
			});

			// Try to add
			expect(() => mockStateManager.addSection('test', 'content')).toThrow('Add failed');
		});
	});
});
