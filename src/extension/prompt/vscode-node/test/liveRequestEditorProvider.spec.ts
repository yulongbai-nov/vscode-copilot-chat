/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { ILogService } from '../../../../platform/log/common/logService';
import { Emitter } from '../../../../util/vs/base/common/event';
import { EditableChatRequest } from '../../common/liveRequestEditorModel';
import { ILiveRequestEditorService, PromptInterceptionState } from '../../common/liveRequestEditorService';
import { LiveRequestEditorProvider } from '../liveRequestEditorProvider';

vi.mock('vscode', async () => {
	const shim = await import('../../../../util/common/test/shims/vscodeTypesShim');
	return {
		...shim,
		commands: {
			executeCommand: vi.fn(),
			getCommands: vi.fn().mockResolvedValue([])
		},
		window: {}
	};
});

describe('LiveRequestEditorProvider', () => {
	let logService: ILogService;

	beforeEach(() => {
		vi.clearAllMocks();
		logService = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as unknown as ILogService;
	});

	test('activates the request associated with the pending interception when updated', () => {
		const { provider, emitRequest, emitInterception } = createProvider(logService);
		const initial = createRequest('session-initial');
		emitRequest(initial);
		expect(currentRequest(provider)).toBe(initial);

		const pendingSessionId = 'session-pending';
		emitInterception({
			enabled: true,
			pending: {
				key: { sessionId: pendingSessionId, location: ChatLocation.Panel },
				requestId: 'req-p',
				debugName: 'pending',
				requestedAt: Date.now(),
				nonce: 1
			}
		});

		const pendingRequest = createRequest(pendingSessionId);
		emitRequest(pendingRequest);

		expect(currentRequest(provider)).toBe(pendingRequest);
		expect(activeSessionKey(provider)).toContain(pendingSessionId);
	});

	test('resolvePendingIntercept targets the pending session if available', () => {
		const { provider, service, emitInterception } = createProvider(logService);
		const pendingKey = { sessionId: 'pending-session', location: ChatLocation.Panel };
		emitInterception({
			enabled: true,
			pending: {
				key: pendingKey,
				requestId: 'req-p',
				debugName: 'pending',
				requestedAt: Date.now(),
				nonce: 2
			}
		});

		(provider as any)._resolvePendingIntercept('resume');

		expect(service.resolvePendingIntercept).toHaveBeenCalledWith(
			pendingKey,
			'resume',
			undefined
		);

		// When no pending request remains we fall back to the current session
		(service.resolvePendingIntercept as Mock).mockClear();
		emitInterception({ enabled: true });
		(provider as any)._currentRequest = createRequest('fallback-session');

		(provider as any)._resolvePendingIntercept('cancel', 'user');

		expect(service.resolvePendingIntercept).toHaveBeenCalledWith(
			{ sessionId: 'fallback-session', location: ChatLocation.Panel },
			'cancel',
			{ reason: 'user' }
		);
	});
	function createProvider(logSvc: ILogService) {
		const onDidChange = new Emitter<EditableChatRequest>();
		const onDidRemove = new Emitter<{ sessionId: string; location: ChatLocation }>();
		const onDidInterception = new Emitter<PromptInterceptionState>();

		const service: ILiveRequestEditorService = {
			_serviceBrand: undefined,
			onDidChange: onDidChange.event,
			onDidRemoveRequest: onDidRemove.event,
			onDidUpdateSubagentHistory: new Emitter<void>().event,
			onDidChangeInterception: onDidInterception.event,
			isEnabled: () => true,
			isInterceptionEnabled: () => true,
			prepareRequest: () => undefined,
			getRequest: () => undefined,
			updateSectionContent: () => undefined,
			deleteSection: () => undefined,
			restoreSection: () => undefined,
			resetRequest: () => undefined,
			updateTokenCounts: () => undefined,
			getMessagesForSend: () => ({ messages: [] }),
			getInterceptionState: () => currentInterceptionState,
			waitForInterceptionApproval: async () => undefined,
			resolvePendingIntercept: vi.fn(),
			handleContextChange: () => undefined,
			recordLoggedRequest: () => undefined,
			getSubagentRequests: () => [],
			clearSubagentHistory: () => undefined,
		};

		let currentInterceptionState: PromptInterceptionState = { enabled: false };
		const extensionUri = { toString: () => 'test', with: () => extensionUri } as unknown as vscode.Uri;

		const provider = new LiveRequestEditorProvider(extensionUri, logSvc, service);

		const emitRequest = (request: EditableChatRequest) => onDidChange.fire(request);
		const emitInterception = (state: PromptInterceptionState) => {
			currentInterceptionState = state;
			(provider as any)._handleInterceptionStateChanged(state);
		};

		return { provider, service, emitRequest, emitInterception };
	}

	function createRequest(sessionId: string): EditableChatRequest {
		return {
			id: `${sessionId}-id`,
			sessionId,
			location: ChatLocation.Panel,
			debugName: sessionId,
			model: 'gpt-test',
			isSubagent: false,
			messages: [],
			sections: [],
			originalMessages: [],
			metadata: {
				requestId: `${sessionId}-req`,
				createdAt: Date.now(),
			},
			isDirty: false,
		};
	}

	function currentRequest(provider: LiveRequestEditorProvider): EditableChatRequest | undefined {
		return (provider as any)._currentRequest as EditableChatRequest | undefined;
	}

	function activeSessionKey(provider: LiveRequestEditorProvider): string | undefined {
		return (provider as any)._activeSessionKey as string | undefined;
	}
});
