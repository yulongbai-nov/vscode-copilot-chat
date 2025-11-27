/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ILogService } from '../../../../platform/log/common/logService';
import { IPromptStateManager } from '../../common/services';
import { PromptSection, VisualizerState } from '../../common/types';
import { PromptSectionVisualizerProvider } from '../../vscode-node/promptSectionVisualizerProvider';

/**
 * Tests for PromptSectionVisualizerProvider - Deprecated WebView Implementation
 *
 * This test suite verifies the deprecated WebView implementation behavior.
 * The custom WebView UI has been replaced with VS Code's native Chat API.
 * These tests ensure backward compatibility during the transition period.
 *
 * @deprecated This test suite covers deprecated functionality that will be removed
 * once the migration to native Chat API is complete (Phase 4 of rollout).
 */
describe('PromptSectionVisualizerProvider - Deprecated WebView', () => {
	let provider: PromptSectionVisualizerProvider;
	let mockLogService: ILogService;
	let mockStateManager: IPromptStateManager;
	let mockWebviewView: vscode.WebviewView;
	let mockWebview: vscode.Webview;
	let messageHandler: ((message: any) => void) | undefined;
	let extensionUri: vscode.Uri;

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
		// Reset message handler
		messageHandler = undefined;

		// Create mock log service
		mockLogService = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn()
		} as any;

		// Create mock state manager
		const stateChangeListeners: Array<(state: VisualizerState) => void> = [];
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

		// Store state change listeners for testing
		(mockStateManager as any)._fireStateChange = (state: VisualizerState) => {
			stateChangeListeners.forEach(listener => listener(state));
		};

		// Create mock webview
		mockWebview = {
			postMessage: vi.fn().mockResolvedValue(true),
			onDidReceiveMessage: vi.fn((handler) => {
				messageHandler = handler;
				return { dispose: vi.fn() };
			}),
			asWebviewUri: vi.fn((uri) => uri),
			cspSource: 'test-csp-source',
			html: '',
			options: {}
		} as any;

		// Create mock webview view
		mockWebviewView = {
			webview: mockWebview,
			show: vi.fn(),
			visible: true,
			viewType: PromptSectionVisualizerProvider.viewType
		} as any;

		// Create extension URI
		extensionUri = vscode.Uri.file('/test/extension');

		// Create provider
		provider = new PromptSectionVisualizerProvider(
			extensionUri,
			mockLogService,
			mockStateManager
		);
	});

	describe('resolveWebviewView - backward compatibility', () => {
		it('should set up webview with correct options', () => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

			expect(mockWebviewView.webview.options).toEqual({
				enableScripts: true,
				localResourceRoots: [extensionUri]
			});
		});

		it('should render lightweight standalone UI with command bindings', () => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

			expect(mockWebview.html).toBeTruthy();
			expect(mockWebview.html).toContain('Prompt Section Visualizer');
			expect(mockWebview.html).toContain('data-command="github.copilot.promptSectionVisualizer.addSection"');
			expect(mockWebview.html).toContain('github.copilot.promptSectionVisualizer.toggleCollapse');
		});

		it('should register message handler for backward compatibility', () => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

			expect(mockWebview.onDidReceiveMessage).toHaveBeenCalled();
			expect(messageHandler).toBeDefined();
		});

		it('should send current state to the webview immediately', () => {
			const mockState = createMockState([createMockSection('1', 'Test content')]);
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(mockState);

			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

			expect(mockWebview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
				type: 'stateUpdate',
				state: mockState
			}));
		});

		it('should verify custom WebView files are not referenced', () => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

			// Verify that custom JS/CSS files are not referenced in HTML
			expect(mockWebview.html).not.toContain('promptSectionVisualizer.js');
			expect(mockWebview.html).not.toContain('promptSectionVisualizer.css');
		});
	});

	describe('deprecated message handling', () => {
		beforeEach(() => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
		});

		it('should ignore deprecated updateSection message', () => {
			const message = {
				type: 'updateSection',
				sectionId: '1',
				content: 'Updated content'
			};

			messageHandler?.(message);

			// Verify message is not processed
			expect(mockStateManager.updateSection).not.toHaveBeenCalled();
			expect(mockLogService.trace).toHaveBeenCalledWith(expect.stringContaining('webview message ignored'));
		});

		it('should ignore deprecated reorderSections message', () => {
			const message = {
				type: 'reorderSections',
				newOrder: ['2', '1', '3']
			};

			messageHandler?.(message);

			expect(mockStateManager.reorderSections).not.toHaveBeenCalled();
			expect(mockLogService.trace).toHaveBeenCalledWith(expect.stringContaining('webview message ignored'));
		});

		it('should ignore deprecated addSection message', () => {
			const message = {
				type: 'addSection',
				tagName: 'context',
				content: 'New section content',
				position: 1
			};

			messageHandler?.(message);

			expect(mockStateManager.addSection).not.toHaveBeenCalled();
			expect(mockLogService.trace).toHaveBeenCalledWith(expect.stringContaining('webview message ignored'));
		});

		it('should ignore deprecated removeSection message', () => {
			const message = {
				type: 'removeSection',
				sectionId: '1'
			};

			messageHandler?.(message);

			expect(mockStateManager.removeSection).not.toHaveBeenCalled();
			expect(mockLogService.trace).toHaveBeenCalledWith(expect.stringContaining('webview message ignored'));
		});

		it('should ignore deprecated toggleCollapse message', () => {
			const message = {
				type: 'toggleCollapse',
				sectionId: '1'
			};

			messageHandler?.(message);

			expect(mockStateManager.toggleSectionCollapse).not.toHaveBeenCalled();
			expect(mockLogService.trace).toHaveBeenCalledWith(expect.stringContaining('webview message ignored'));
		});

		it('should ignore deprecated switchMode message', () => {
			const message = {
				type: 'switchMode',
				sectionId: '1',
				mode: 'edit'
			};

			messageHandler?.(message);

			expect(mockStateManager.switchSectionMode).not.toHaveBeenCalled();
			expect(mockLogService.trace).toHaveBeenCalledWith(expect.stringContaining('webview message ignored'));
		});

		it('should ignore deprecated ready message', () => {
			const mockState = createMockState([createMockSection('1', 'Test')]);
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(mockState);

			vi.mocked(mockWebview.postMessage).mockClear();

			const message = { type: 'ready' };
			messageHandler?.(message);

			expect(mockWebview.postMessage).not.toHaveBeenCalled();
			expect(mockLogService.trace).toHaveBeenCalledWith(expect.stringContaining('webview message ignored'));
		});

		it('should log deprecation warning for unknown message types', () => {
			const message = {
				type: 'unknownMessageType',
				data: 'test'
			};

			messageHandler?.(message);

			expect(mockLogService.trace).toHaveBeenCalledWith(
				expect.stringContaining('webview message ignored')
			);
		});

		it('should verify all message types are ignored', () => {
			const messageTypes = [
				'updateSection',
				'reorderSections',
				'addSection',
				'removeSection',
				'toggleCollapse',
				'switchMode',
				'ready'
			];

			messageTypes.forEach(type => {
				vi.clearAllMocks();
				messageHandler?.({ type, data: 'test' });

				// Verify no state manager methods were called
				expect(mockStateManager.updateSection).not.toHaveBeenCalled();
				expect(mockStateManager.reorderSections).not.toHaveBeenCalled();
				expect(mockStateManager.addSection).not.toHaveBeenCalled();
				expect(mockStateManager.removeSection).not.toHaveBeenCalled();
				expect(mockStateManager.toggleSectionCollapse).not.toHaveBeenCalled();
				expect(mockStateManager.switchSectionMode).not.toHaveBeenCalled();

				// Verify deprecation was logged
				expect(mockLogService.trace).toHaveBeenCalled();
			});
		});
	});

	describe('state synchronization', () => {
		beforeEach(() => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
			vi.mocked(mockWebview.postMessage).mockClear();
		});

		it('should send state updates to webview', () => {
			const newState = createMockState([
				createMockSection('1', 'Section 1'),
				createMockSection('2', 'Section 2')
			]);

			(mockStateManager as any)._fireStateChange(newState);

			expect(mockWebview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
				type: 'stateUpdate',
				state: newState
			}));
		});

		it('should send messages for multiple state changes', () => {
			const state1 = createMockState([createMockSection('1', 'First')]);
			const state2 = createMockState([createMockSection('1', 'Updated')]);

			(mockStateManager as any)._fireStateChange(state1);
			(mockStateManager as any)._fireStateChange(state2);

			expect(mockWebview.postMessage).toHaveBeenCalledTimes(2);
			expect(mockWebview.postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
				type: 'stateUpdate',
				state: state1
			}));
			expect(mockWebview.postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
				type: 'stateUpdate',
				state: state2
			}));
		});

		it('should not send messages if view is not resolved', () => {
			const newStateChangeListeners: Array<(state: VisualizerState) => void> = [];
			const newMockStateManager = {
				getCurrentState: vi.fn().mockReturnValue(createMockState([])),
				updatePrompt: vi.fn(),
				updateSection: vi.fn(),
				reorderSections: vi.fn(),
				addSection: vi.fn(),
				removeSection: vi.fn(),
				toggleSectionCollapse: vi.fn(),
				switchSectionMode: vi.fn(),
				onDidChangeState: vi.fn((listener) => {
					newStateChangeListeners.push(listener);
					return { dispose: vi.fn() };
				}),
				dispose: vi.fn()
			} as any;

			new PromptSectionVisualizerProvider(
				extensionUri,
				mockLogService,
				newMockStateManager
			);

			const newState = createMockState([createMockSection('1', 'Test')]);
			newStateChangeListeners.forEach(listener => listener(newState));

			expect(mockWebview.postMessage).not.toHaveBeenCalled();
		});

		it('should propagate each state change to the webview', () => {
			const states = [
				createMockState([createMockSection('1', 'State 1')]),
				createMockState([createMockSection('1', 'State 2'), createMockSection('2', 'State 2')]),
				createMockState([])
			];

			states.forEach(state => {
				vi.mocked(mockWebview.postMessage).mockClear();
				(mockStateManager as any)._fireStateChange(state);
				expect(mockWebview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
					type: 'stateUpdate',
					state
				}));
			});
		});
	});

	describe('deprecated external API', () => {
		beforeEach(() => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
		});

		it('should still support updatePrompt for backward compatibility', () => {
			const prompt = '<context>Test</context><instructions>Do something</instructions>';

			provider.updatePrompt(prompt);

			expect(mockStateManager.updatePrompt).toHaveBeenCalledWith(prompt);
		});

		it('should still support getEditedPrompt for backward compatibility', () => {
			const sections = [
				createMockSection('1', 'Context content', 'context'),
				createMockSection('2', 'Instructions content', 'instructions')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const result = provider.getEditedPrompt();

			expect(result).toBe('<context>Context content</context>\n<instructions>Instructions content</instructions>');
		});

		it('should still support show() for backward compatibility', () => {
			provider.show();

			expect(mockWebviewView.show).toHaveBeenCalledWith(true);
		});

		it('should still support hide() for backward compatibility', () => {
			provider.hide();

			expect(mockWebviewView.show).toHaveBeenCalledWith(false);
		});

		it('should handle show when view not resolved', () => {
			const newProvider = new PromptSectionVisualizerProvider(
				extensionUri,
				mockLogService,
				mockStateManager
			);

			expect(() => newProvider.show()).not.toThrow();
		});

		it('should support getCurrentState for accessing visualizer state', () => {
			const mockState = createMockState([createMockSection('1', 'Test')]);
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(mockState);

			const result = provider.getCurrentState();

			expect(result).toEqual(mockState);
		});

		it('should support isVisible for checking panel visibility', () => {
			expect(provider.isVisible()).toBe(true);

			// Test with invisible view - create new mock with visible = false
			const invisibleMockWebviewView = {
				...mockWebviewView,
				visible: false
			} as any;

			const newProvider = new PromptSectionVisualizerProvider(
				extensionUri,
				mockLogService,
				mockStateManager
			);
			newProvider.resolveWebviewView(invisibleMockWebviewView, {} as any, {} as any);

			expect(newProvider.isVisible()).toBe(false);
		});
	});

	describe('disposal', () => {
		it('should dispose properly', () => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

			provider.dispose();

			// Verify no errors occur after disposal
			expect(() => provider.updatePrompt('test')).not.toThrow();
		});
	});
});
