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
			registerChatSessionItemProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
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
	const resource = vscode.Uri.from({ scheme: 'copilot-live-replay', path: `/${compositeKey}` });
	const encodedResource = vscode.Uri.from({ scheme: 'copilot-live-replay', path: `/${encodeURIComponent(compositeKey)}` });
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
			getReplaySnapshot: vi.fn().mockReturnValue(undefined),
			getOriginalRequestMessages: vi.fn().mockReturnValue(undefined),
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
		expect(session.history).toHaveLength(6);

		await vscode.commands.executeCommand('github.copilot.liveRequestEditor.startReplayChat', resource);

		const forkResource = vscode.Uri.from({ scheme: 'copilot-live-replay-fork', path: resource.path });
		const activatedSession = await provider.provideChatSessionContent(forkResource, new vscode.CancellationTokenSource().token);
		expect(activatedSession.requestHandler).toBeDefined();
	});

	test('recovers state for encoded resources', async () => {
		const snapshot = buildSnapshot();
		provider.showReplay(snapshot);

		const session = await provider.provideChatSessionContent(encodedResource, new vscode.CancellationTokenSource().token);
		expect(session.history).toHaveLength(6);
	});

	test('rebuilds sample snapshot when missing state', async () => {
		const sampleResource = vscode.Uri.from({ scheme: 'copilot-live-replay', path: '/sample-session::1::sample-turn' });
		const session = await provider.provideChatSessionContent(sampleResource, new vscode.CancellationTokenSource().token);
		expect(session.history).toHaveLength(6);
	});

	test('request handler forwards to ChatParticipantRequestHandler with payload history', async () => {
		const snapshot = buildSnapshot();
		provider.showReplay(snapshot);
		await vscode.commands.executeCommand('github.copilot.liveRequestEditor.startReplayChat', resource);

		const forkResource = vscode.Uri.from({ scheme: 'copilot-live-replay-fork', path: resource.path });
		const session = await provider.provideChatSessionContent(forkResource, new vscode.CancellationTokenSource().token);
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

	test('toggle view command accepts string resources', async () => {
		const snapshot = buildSnapshot();
		provider.showReplay(snapshot);

		const session = await provider.provideChatSessionContent(resource, new vscode.CancellationTokenSource().token);
		const payloadParticipant = (session.history?.[2] as vscode.ChatRequestTurn)?.participant;
		expect(payloadParticipant).not.toBe('copilot-live-replay');

		await vscode.commands.executeCommand('github.copilot.liveRequestEditor.toggleReplayView', resource.toString());

		const toggledSession = await provider.provideChatSessionContent(resource, new vscode.CancellationTokenSource().token);
		const projectionParticipant = (toggledSession.history?.[2] as vscode.ChatRequestTurn)?.participant;
		expect(projectionParticipant).toBe('copilot-live-replay');
	});

	test('start replay chat opens fork session with payload only', async () => {
		const snapshot = buildSnapshot();
		provider.showReplay(snapshot);

		await vscode.commands.executeCommand('github.copilot.liveRequestEditor.startReplayChat', resource);

		const forkResource = vscode.Uri.from({ scheme: 'copilot-live-replay-fork', path: resource.path });
		const session = await provider.provideChatSessionContent(forkResource, new vscode.CancellationTokenSource().token);
		// Activated fork should have payload view only; no summary bubble.
		expect(session.history[0]).toBeInstanceOf(vscode.ChatRequestTurn2);
		expect((session.history[0] as vscode.ChatRequestTurn).participant).not.toBe('copilot-live-replay');
	});

	test('fork payload history includes synthetic request/response pairs unlike native', async () => {
		const snapshot = buildSnapshot();
		provider.showReplay(snapshot);
		await vscode.commands.executeCommand('github.copilot.liveRequestEditor.startReplayChat', resource);

		const forkResource = vscode.Uri.from({ scheme: 'copilot-live-replay-fork', path: resource.path });
		const session = await provider.provideChatSessionContent(forkResource, new vscode.CancellationTokenSource().token);
		// For two payload messages we expect four entries (request/response pairs).
		expect(session.history).toHaveLength(4);
		// Native Copilot history would not inject empty response turns after user messages; here we assert ours does.
		const userReq = session.history[0] as vscode.ChatRequestTurn;
		const emptyResp = session.history[1] as vscode.ChatResponseTurn2;
		expect(userReq.participant).not.toBe('copilot-live-replay');
		// We synthesize a response turn; native wouldn't. This verifies that we
		// still emit a separate response object for the payload-only fork.
		expect(emptyResp).toBeInstanceOf(vscode.ChatResponseTurn2);
	});

	test('summary bubble includes Open in Copilot CLI action wired with replay key', async () => {
		const snapshot = buildSnapshot();
		provider.showReplay(snapshot);

		const session = await provider.provideChatSessionContent(resource, new vscode.CancellationTokenSource().token);
		const summaryTurn = session.history[1] as vscode.ChatResponseTurn2;
		const responseParts = summaryTurn.response ?? [];
		const buttonParts = responseParts.filter(part => part instanceof vscode.ChatResponseCommandButtonPart) as vscode.ChatResponseCommandButtonPart[];

		const openInCli = buttonParts.find(part => (part as any).value?.command === 'github.copilot.liveRequestEditor.openInCopilotCLI');
		expect(openInCli).toBeDefined();
		expect((openInCli as any).value?.arguments).toEqual([snapshot.key]);
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
