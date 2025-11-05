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

describe('PromptSectionVisualizerProvider - WebView Communication', () => {
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

	describe('resolveWebviewView', () => {
		it('should set up webview with correct options', () => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

			expect(mockWebviewView.webview.options).toEqual({
				enableScripts: true,
				localResourceRoots: [extensionUri]
			});
		});

		it('should set HTML content for webview', () => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

			expect(mockWebview.html).toBeTruthy();
			expect(mockWebview.html).toContain('promptSectionVisualizer.js');
			expect(mockWebview.html).toContain('promptSectionVisualizer.css');
		});

		it('should register message handler', () => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

			expect(mockWebview.onDidReceiveMessage).toHaveBeenCalled();
			expect(messageHandler).toBeDefined();
		});

		it('should send initial state to webview', () => {
			const mockState = createMockState([createMockSection('1', 'Test content')]);
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(mockState);

			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

			expect(mockWebview.postMessage).toHaveBeenCalledWith({
				type: 'updateState',
				state: mockState
			});
		});
	});

	describe('message handling', () => {
		beforeEach(() => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
		});

		it('should handle updateSection message', () => {
			const message = {
				type: 'updateSection',
				sectionId: '1',
				content: 'Updated content'
			};

			messageHandler?.(message);

			expect(mockStateManager.updateSection).toHaveBeenCalledWith('1', 'Updated content');
		});

		it('should handle reorderSections message', () => {
			const message = {
				type: 'reorderSections',
				newOrder: ['2', '1', '3']
			};

			messageHandler?.(message);

			expect(mockStateManager.reorderSections).toHaveBeenCalledWith(['2', '1', '3']);
		});

		it('should handle addSection message', () => {
			const message = {
				type: 'addSection',
				tagName: 'context',
				content: 'New section content',
				position: 1
			};

			messageHandler?.(message);

			expect(mockStateManager.addSection).toHaveBeenCalledWith('context', 'New section content', 1);
		});

		it('should handle removeSection message', () => {
			const message = {
				type: 'removeSection',
				sectionId: '1'
			};

			messageHandler?.(message);

			expect(mockStateManager.removeSection).toHaveBeenCalledWith('1');
		});

		it('should handle toggleCollapse message', () => {
			const message = {
				type: 'toggleCollapse',
				sectionId: '1'
			};

			messageHandler?.(message);

			expect(mockStateManager.toggleSectionCollapse).toHaveBeenCalledWith('1');
		});

		it('should handle switchMode message', () => {
			const message = {
				type: 'switchMode',
				sectionId: '1',
				mode: 'edit'
			};

			messageHandler?.(message);

			expect(mockStateManager.switchSectionMode).toHaveBeenCalledWith('1', 'edit');
		});

		it('should handle ready message by sending current state', () => {
			const mockState = createMockState([createMockSection('1', 'Test')]);
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(mockState);

			// Clear previous postMessage calls
			vi.mocked(mockWebview.postMessage).mockClear();

			const message = { type: 'ready' };
			messageHandler?.(message);

			expect(mockWebview.postMessage).toHaveBeenCalledWith({
				type: 'updateState',
				state: mockState
			});
		});

		it('should log warning for unknown message types', () => {
			const message = {
				type: 'unknownMessageType',
				data: 'test'
			};

			messageHandler?.(message);

			expect(mockLogService.warn).toHaveBeenCalledWith(
				expect.stringContaining('Unknown message type')
			);
		});
	});

	describe('state synchronization', () => {
		beforeEach(() => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
			// Clear initial state message
			vi.mocked(mockWebview.postMessage).mockClear();
		});

		it('should update webview when state changes', () => {
			const newState = createMockState([
				createMockSection('1', 'Section 1'),
				createMockSection('2', 'Section 2')
			]);

			// Trigger state change
			(mockStateManager as any)._fireStateChange(newState);

			expect(mockWebview.postMessage).toHaveBeenCalledWith({
				type: 'updateState',
				state: newState
			});
		});

		it('should handle multiple state changes', () => {
			const state1 = createMockState([createMockSection('1', 'First')]);
			const state2 = createMockState([createMockSection('1', 'Updated')]);

			(mockStateManager as any)._fireStateChange(state1);
			(mockStateManager as any)._fireStateChange(state2);

			expect(mockWebview.postMessage).toHaveBeenCalledTimes(2);
			expect(mockWebview.postMessage).toHaveBeenNthCalledWith(1, {
				type: 'updateState',
				state: state1
			});
			expect(mockWebview.postMessage).toHaveBeenNthCalledWith(2, {
				type: 'updateState',
				state: state2
			});
		});

		it('should not update webview if view is not resolved', () => {
			// Create new mock state manager for isolated test
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

			// Create new provider without resolving view
			new PromptSectionVisualizerProvider(
				extensionUri,
				mockLogService,
				newMockStateManager
			);

			const newState = createMockState([createMockSection('1', 'Test')]);
			newStateChangeListeners.forEach(listener => listener(newState));

			// Should not throw and should not call postMessage on the original webview
			expect(mockWebview.postMessage).not.toHaveBeenCalled();
		});
	});

	describe('external API', () => {
		beforeEach(() => {
			provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
		});

		it('should update prompt through state manager', () => {
			const prompt = '<context>Test</context><instructions>Do something</instructions>';

			provider.updatePrompt(prompt);

			expect(mockStateManager.updatePrompt).toHaveBeenCalledWith(prompt);
		});

		it('should get edited prompt from state', () => {
			const sections = [
				createMockSection('1', 'Context content', 'context'),
				createMockSection('2', 'Instructions content', 'instructions')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const result = provider.getEditedPrompt();

			expect(result).toBe('<context>Context content</context>\n<instructions>Instructions content</instructions>');
		});

		it('should show webview panel', () => {
			provider.show();

			expect(mockWebviewView.show).toHaveBeenCalledWith(true);
		});

		it('should hide webview panel', () => {
			provider.hide();

			expect(mockWebviewView.show).toHaveBeenCalledWith(false);
		});

		it('should handle show when view not resolved', () => {
			const newProvider = new PromptSectionVisualizerProvider(
				extensionUri,
				mockLogService,
				mockStateManager
			);

			// Should not throw
			expect(() => newProvider.show()).not.toThrow();
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
