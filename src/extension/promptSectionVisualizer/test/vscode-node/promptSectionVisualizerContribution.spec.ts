/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../../platform/log/common/logService';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { PromptSectionVisualizerContribution } from '../../vscode-node/promptSectionVisualizerContribution';

// Mock vscode module
vi.mock('vscode', () => ({
	window: {
		registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		setStatusBarMessage: vi.fn()
	},
	workspace: {
		getConfiguration: vi.fn(),
		onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() }))
	},
	commands: {
		registerCommand: vi.fn((id, handler) => ({ dispose: vi.fn() })),
		executeCommand: vi.fn()
	},
	ConfigurationTarget: {
		Global: 1
	}
}));

describe('PromptSectionVisualizerContribution - Toggle Functionality', () => {
	let contribution: PromptSectionVisualizerContribution;
	let mockLogService: ILogService;
	let mockInstantiationService: IInstantiationService;
	let mockExtensionContext: IVSCodeExtensionContext;
	let toggleCommandHandler: () => Promise<void>;
	let mockConfig: any;

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks();

		// Create mock log service
		mockLogService = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn()
		} as any;

		// Create mock configuration
		mockConfig = {
			get: vi.fn().mockReturnValue(false),
			update: vi.fn().mockResolvedValue(undefined)
		};

		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any);

		// Capture the toggle command handler
		vi.mocked(vscode.commands.registerCommand).mockImplementation((id, handler) => {
			if (id === 'github.copilot.promptSectionVisualizer.toggle') {
				toggleCommandHandler = handler as () => Promise<void>;
			}
			return { dispose: vi.fn() };
		});

		// Create mock instantiation service
		mockInstantiationService = {
			createInstance: vi.fn().mockReturnValue({
				updatePrompt: vi.fn(),
				getEditedPrompt: vi.fn().mockReturnValue(''),
				dispose: vi.fn()
			})
		} as any;

		// Create mock extension context
		mockExtensionContext = {
			extensionUri: { fsPath: '/test/path' } as any
		} as any;

		// Create contribution
		contribution = new PromptSectionVisualizerContribution(
			mockInstantiationService,
			mockLogService,
			mockExtensionContext
		);
	});

	describe('toggle command', () => {
		it('should register toggle command', () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				'github.copilot.promptSectionVisualizer.toggle',
				expect.any(Function)
			);
		});

		it('should enable visualizer when currently disabled', async () => {
			// Setup: visualizer is currently disabled
			mockConfig.get.mockReturnValue(false);

			// Execute toggle command
			await toggleCommandHandler();

			// Verify configuration was updated to enabled
			expect(mockConfig.update).toHaveBeenCalledWith(
				'promptSectionVisualizer.enabled',
				true,
				vscode.ConfigurationTarget.Global
			);

			// Verify focus command was executed
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				'github.copilot.promptSectionVisualizer.focus'
			);

			// Verify context was set
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				'setContext',
				'github.copilot.promptSectionVisualizer.enabled',
				true
			);

			// Verify user was notified
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				'Prompt Section Visualizer enabled. The view will appear in the chat panel.'
			);

			// Verify logging
			expect(mockLogService.info).toHaveBeenCalledWith('Prompt Section Visualizer enabled');
		});

		it('should disable visualizer when currently enabled', async () => {
			// Setup: visualizer is currently enabled
			mockConfig.get.mockReturnValue(true);

			// Execute toggle command
			await toggleCommandHandler();

			// Verify configuration was updated to disabled
			expect(mockConfig.update).toHaveBeenCalledWith(
				'promptSectionVisualizer.enabled',
				false,
				vscode.ConfigurationTarget.Global
			);

			// Verify focus command was NOT executed
			expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
				'github.copilot.promptSectionVisualizer.focus'
			);

			// Verify context was set
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				'setContext',
				'github.copilot.promptSectionVisualizer.enabled',
				false
			);

			// Verify user was notified
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				'Prompt Section Visualizer disabled.'
			);

			// Verify logging
			expect(mockLogService.info).toHaveBeenCalledWith('Prompt Section Visualizer disabled');
		});

		it('should handle toggle errors gracefully', async () => {
			// Setup: make update throw an error
			const error = new Error('Configuration update failed');
			mockConfig.update.mockRejectedValue(error);

			// Execute toggle command
			await toggleCommandHandler();

			// Verify error was logged
			expect(mockLogService.error).toHaveBeenCalledWith(
				'Failed to toggle Prompt Section Visualizer',
				error
			);

			// Verify user was notified of error
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				'Failed to toggle Prompt Section Visualizer. See output for details.'
			);
		});

		it('should persist toggle state globally', async () => {
			mockConfig.get.mockReturnValue(false);

			await toggleCommandHandler();

			// Verify Global configuration target was used
			expect(mockConfig.update).toHaveBeenCalledWith(
				'promptSectionVisualizer.enabled',
				true,
				vscode.ConfigurationTarget.Global
			);
		});
	});

	describe('keyboard shortcut', () => {
		it('should support Ctrl+Alt+P keyboard shortcut', async () => {
			// The keyboard shortcut is registered in package.json
			// This test verifies the command handler works when invoked via shortcut
			mockConfig.get.mockReturnValue(false);

			// Simulate keyboard shortcut invocation
			await toggleCommandHandler();

			// Verify the toggle worked
			expect(mockConfig.update).toHaveBeenCalled();
			expect(vscode.window.showInformationMessage).toHaveBeenCalled();
		});
	});

	describe('configuration listener', () => {
		it('should initialize context based on current configuration', () => {
			// Verify that setContext was called during initialization
			// This happens in the constructor via _registerCommands
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				'setContext',
				'github.copilot.promptSectionVisualizer.enabled',
				expect.any(Boolean)
			);
		});
	});

	describe('view visibility', () => {
		it('should show view when enabled', async () => {
			mockConfig.get.mockReturnValue(false);

			await toggleCommandHandler();

			// Verify focus command was executed to show the view
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				'github.copilot.promptSectionVisualizer.focus'
			);
		});

		it('should not explicitly hide view when disabled', async () => {
			mockConfig.get.mockReturnValue(true);

			await toggleCommandHandler();

			// When disabled, the view is hidden via the when clause in package.json
			// No explicit hide command is needed
			expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
				'github.copilot.promptSectionVisualizer.focus'
			);
		});
	});

	describe('refresh command', () => {
		it('should register refresh command', () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				'github.copilot.promptSectionVisualizer.refresh',
				expect.any(Function)
			);
		});
	});

	describe('disposal', () => {
		it('should dispose all resources', () => {
			expect(() => contribution.dispose()).not.toThrow();
		});
	});
});
