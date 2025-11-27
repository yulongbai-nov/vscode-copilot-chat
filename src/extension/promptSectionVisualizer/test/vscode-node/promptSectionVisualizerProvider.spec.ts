/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ILogService } from '../../../../platform/log/common/logService';
import { IPromptSectionRenderer, IPromptStateManager, PromptRendererPart } from '../../common/services';
import { PromptSection, PromptStatePatch, VisualizerState } from '../../common/types';
import { PromptSectionVisualizerProvider } from '../../vscode-node/promptSectionVisualizerProvider';

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const createPromptSection = (id: string, tagName = 'context'): PromptSection => ({
	id,
	tagName,
	content: 'Sample',
	startIndex: 0,
	endIndex: 6,
	tokenCount: 42,
	isEditing: false,
	isCollapsed: false,
	hasRenderableElements: false
});

const createAsyncIterable = (parts: PromptRendererPart[]): AsyncIterable<PromptRendererPart> => ({
	[Symbol.asyncIterator]: async function* () {
		for (const part of parts) {
			yield part;
		}
	}
});

describe('PromptSectionVisualizerProvider', () => {
	let provider: PromptSectionVisualizerProvider;
	let mockLogService: ILogService;
	let mockStateManager: IPromptStateManager;
	let mockRenderer: IPromptSectionRenderer;
	let mockWebviewView: vscode.WebviewView;
	let mockWebview: vscode.Webview;
	let stateListeners: Array<(state: VisualizerState) => void>;
	let patchListeners: Array<(patch: PromptStatePatch) => void>;
	let rendererQueue: PromptRendererPart[][];
	let extensionUri: vscode.Uri;

	beforeEach(() => {
		stateListeners = [];
		patchListeners = [];
		rendererQueue = [];

		mockLogService = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn()
		} as any;

		const initialSections = [createPromptSection('s-1')];
		const initialState: VisualizerState = {
			sections: initialSections,
			totalTokens: 42,
			isEnabled: true,
			currentLanguageModel: 'gpt-4',
			uiTheme: 'dark'
		};

		mockStateManager = {
			getCurrentState: vi.fn().mockReturnValue(initialState),
			updatePrompt: vi.fn(),
			updateSection: vi.fn(),
			reorderSections: vi.fn(),
			addSection: vi.fn(),
			removeSection: vi.fn(),
			toggleSectionCollapse: vi.fn(),
			switchSectionMode: vi.fn(),
			onDidChangeState: vi.fn(listener => {
				stateListeners.push(listener);
				return { dispose: vi.fn() };
			}),
			onDidApplyPatch: vi.fn(listener => {
				patchListeners.push(listener);
				return { dispose: vi.fn() };
			})
		} as any;

		mockRenderer = {
			renderSections: vi.fn(() => createAsyncIterable(rendererQueue.shift() ?? []))
		} as any;

		mockWebview = {
			postMessage: vi.fn().mockResolvedValue(true),
			onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
			asWebviewUri: vi.fn(uri => uri),
			cspSource: 'test-csp',
			html: '',
			options: {}
		} as any;

		mockWebviewView = {
			webview: mockWebview,
			visible: true,
			show: vi.fn(),
			viewType: PromptSectionVisualizerProvider.viewType
		} as any;

		extensionUri = vscode.Uri.file('/test/extension');

		provider = new PromptSectionVisualizerProvider(
			extensionUri,
			mockLogService,
			mockStateManager,
			mockRenderer
		);
	});

	const enqueueRendererParts = (...batches: PromptRendererPart[][]) => {
		for (const batch of batches) {
			rendererQueue.push(batch);
		}
	};

	it('renders initial state when the view is resolved', async () => {
		enqueueRendererParts([
			{ type: 'header', title: 'Prompt Section Visualizer', sectionCount: 1, totalTokens: 42, markdown: '## Header' },
			{ type: 'section', id: 's-1', index: 0, tagName: 'context', headerMarkdown: 'Section', isCollapsed: false, tokenCount: 42, hasRenderableElements: false, contentText: 'Sample', content: 'Sample' }
		]);

		provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

		await flushPromises();

		expect(mockRenderer.renderSections).toHaveBeenCalledTimes(1);
		expect(mockWebview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'render' }));
	});

	it('sends patch messages when the state manager emits granular patches', async () => {
		const headerPart: PromptRendererPart = { type: 'header', title: 'Prompt Section Visualizer', sectionCount: 1, totalTokens: 42, markdown: '## Header' };
		const sectionA: PromptRendererPart = { type: 'section', id: 's-1', index: 0, tagName: 'context', headerMarkdown: 'Section A', isCollapsed: false, tokenCount: 42, hasRenderableElements: false, contentText: 'A', content: 'A' };
		const sectionB: PromptRendererPart = { type: 'section', id: 's-2', index: 1, tagName: 'instructions', headerMarkdown: 'Section B', isCollapsed: false, tokenCount: 10, hasRenderableElements: false, contentText: 'B', content: 'B' };

		enqueueRendererParts([headerPart, sectionA, sectionB], [headerPart, sectionA]);

		provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
		await flushPromises();
		mockWebview.postMessage.mockClear();

		const patch: PromptStatePatch = {
			type: 'sectionUpdated',
			section: createPromptSection('s-1')
		};

		patchListeners.forEach(listener => listener(patch));
		await flushPromises();

		expect(mockRenderer.renderSections).toHaveBeenCalledTimes(2);
		expect(mockWebview.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'patch',
				patch,
				parts: expect.arrayContaining([
					expect.objectContaining({ type: 'header' }),
					expect.objectContaining({ type: 'section', id: 's-1' })
				])
			})
		);
	});
});
