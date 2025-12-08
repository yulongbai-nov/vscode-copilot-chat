/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { ILiveRequestEditorService } from '../../common/liveRequestEditorService';
import { LiveRequestReplaySnapshot } from '../../common/liveRequestEditorModel';
import { LiveReplayChatProvider } from '../liveReplayChatProvider';

vi.mock('vscode', async () => {
	const shim = await import('../../../../util/common/test/shims/vscodeTypesShim');
	const commandHandlers: Record<string, (...args: unknown[]) => unknown> = {};
	return {
		...shim,
		chat: {
			createChatParticipant: vi.fn().mockReturnValue({}),
			registerChatSessionContentProvider: vi.fn().mockReturnValue({ dispose: vi.fn() })
		},
		commands: {
			registerCommand: vi.fn().mockImplementation((command: string, handler: (...args: unknown[]) => unknown) => {
				commandHandlers[command] = handler;
				return { dispose: vi.fn() };
			}),
			executeCommand: vi.fn().mockImplementation((command: string, ...args: unknown[]) => commandHandlers[command]?.(...args))
		},
	};
});

describe('LiveReplayChatProvider', () => {
	const compositeKey = 'session-1::1::req-1';
	const resource = vscode.Uri.from({ scheme: 'copilot-live-replay', path: `/${encodeURIComponent(compositeKey)}` });
	let instantiationService: IInstantiationService;
	let liveRequestEditorService: ILiveRequestEditorService;
	let provider: LiveReplayChatProvider;
	let handlerResult: { getResult: Mock };

	beforeEach(() => {
		handlerResult = { getResult: vi.fn().mockResolvedValue({}) as Mock };
		instantiationService = {
			createInstance: vi.fn().mockReturnValue(handlerResult)
		} as unknown as IInstantiationService;
		liveRequestEditorService = {
			markReplayForkActive: vi.fn().mockImplementation((_key, _forkId) => undefined),
		} as unknown as ILiveRequestEditorService;
		provider = new LiveReplayChatProvider(instantiationService, liveRequestEditorService, {
			_serviceBrand: undefined,
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			show: vi.fn(),
		});
	});

	test('remains read-only until activated', async () => {
		const snapshot = buildSnapshot();
		provider.showReplay(snapshot);

		const session = await provider.provideChatSessionContent(resource, new vscode.CancellationTokenSource().token);
		expect(session.requestHandler).toBeUndefined();
		expect(session.history).toHaveLength(2);

		await vscode.commands.executeCommand('github.copilot.liveRequestEditor.startReplayChat', resource);

		const activatedSession = await provider.provideChatSessionContent(resource, new vscode.CancellationTokenSource().token);
		expect(activatedSession.requestHandler).toBeDefined();
	});

	test('request handler forwards to ChatParticipantRequestHandler with payload history', async () => {
		const snapshot = buildSnapshot();
		provider.showReplay(snapshot);
		await vscode.commands.executeCommand('github.copilot.liveRequestEditor.startReplayChat', resource);

		const session = await provider.provideChatSessionContent(resource, new vscode.CancellationTokenSource().token);
		expect(session.requestHandler).toBeDefined();
		await session.requestHandler?.(
			{ prompt: 'next', references: [], toolReferences: [], model: { id: 'm' } } as unknown as vscode.ChatRequest,
			{ history: [] } as unknown as vscode.ChatContext,
			{ markdown: vi.fn() } as unknown as vscode.ChatResponseStream,
			new vscode.CancellationTokenSource().token
		);

		expect(instantiationService.createInstance).toHaveBeenCalled();
		expect(handlerResult.getResult).toHaveBeenCalled();
		expect((liveRequestEditorService.markReplayForkActive as Mock)).toHaveBeenCalled();
	});

	function buildSnapshot(): LiveRequestReplaySnapshot {
		const payload: Raw.ChatMessage[] = [
			{
				role: Raw.ChatRole.System,
				content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'sys' }]
			},
			{
				role: Raw.ChatRole.User,
				content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'hi' }]
			}
		];
		return {
			key: { sessionId: 'session-1', location: 1, requestId: 'req-1' },
			state: 'ready',
			version: 1,
			updatedAt: Date.now(),
			payload,
			payloadHash: 1,
			projection: {
				sections: [
					{ id: 's', kind: 'system', label: 'System', content: 'sys', collapsed: true, edited: false, sourceMessageIndex: 0 },
					{ id: 'u', kind: 'user', label: 'User', content: 'hi', collapsed: false, edited: false, sourceMessageIndex: 1 }
				],
				totalSections: 2,
				overflowCount: 0,
				editedCount: 0,
				deletedCount: 0
			},
			projectionHash: 1,
			parentSessionId: 'session-1',
			parentTurnId: 'req-1',
		};
	}
});
