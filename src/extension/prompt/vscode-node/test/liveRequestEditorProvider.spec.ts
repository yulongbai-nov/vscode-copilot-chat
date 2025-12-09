/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import { Raw } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { ILogService } from '../../../../platform/log/common/logService';
import { Emitter } from '../../../../util/vs/base/common/event';
import { EditableChatRequest, LiveRequestSessionKey } from '../../common/liveRequestEditorModel';
import { ILiveRequestEditorService, LiveRequestEditorMode, LiveRequestMetadataEvent, LiveRequestOverrideScope, LiveRequestReplayEvent, PromptInterceptionState } from '../../common/liveRequestEditorService';
import { OptionalChatRequestParams } from '../../../../platform/networking/common/fetch';
import { LiveRequestEditorProvider } from '../liveRequestEditorProvider';

const mockExtraSectionsValue: string[] = [];

vi.mock('vscode', async () => {
	const shim = await import('../../../../util/common/test/shims/vscodeTypesShim');
	const configurationGetter = vi.fn().mockImplementation(() => ({
		get: vi.fn().mockImplementation((_key: string, defaultValue: unknown) => {
			return mockExtraSectionsValue.length ? [...mockExtraSectionsValue] : defaultValue;
		})
	}));
	return {
		...shim,
		commands: {
			executeCommand: vi.fn(),
			getCommands: vi.fn().mockResolvedValue([])
		},
		window: {},
		workspace: {
			getConfiguration: configurationGetter,
			onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() })
		}
	};
});

describe('LiveRequestEditorProvider', () => {
	let logService: ILogService;

	beforeEach(() => {
		vi.clearAllMocks();
		mockExtraSectionsValue.length = 0;
		logService = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as unknown as ILogService;
	});

	test('activates the request associated with the pending interception when updated', () => {
		const { provider, emitRequest, emitInterception, buildState } = createProvider(logService);
		const initial = createRequest('session-initial');
		emitRequest(initial);
		expect(currentRequest(provider)).toBe(initial);

		const pendingSessionId = 'session-pending';
		emitInterception(buildState({
			enabled: true,
			pending: {
				key: { sessionId: pendingSessionId, location: ChatLocation.Panel },
				requestId: 'req-p',
				debugName: 'pending',
				requestedAt: Date.now(),
				nonce: 1
			}
		}));

		const pendingRequest = createRequest(pendingSessionId);
		emitRequest(pendingRequest);

		expect(currentRequest(provider)).toBe(pendingRequest);
		expect(activeSessionKey(provider)).toContain(pendingSessionId);
	});

	test('resolvePendingIntercept targets the pending session if available', () => {
		const { provider, service, emitInterception, buildState } = createProvider(logService);
		const pendingKey = { sessionId: 'pending-session', location: ChatLocation.Panel };
		emitInterception(buildState({
			enabled: true,
			pending: {
				key: pendingKey,
				requestId: 'req-p',
				debugName: 'pending',
				requestedAt: Date.now(),
				nonce: 2
			}
		}));

		(provider as any)._resolvePendingIntercept('resume');

		expect(service.resolvePendingIntercept).toHaveBeenCalledWith(
			pendingKey,
			'resume',
			undefined
		);

		// When no pending request remains we fall back to the current session
		(service.resolvePendingIntercept as Mock).mockClear();
		emitInterception(buildState({ enabled: true }));
		(provider as any)._currentRequest = createRequest('fallback-session');

		(provider as any)._resolvePendingIntercept('cancel', 'user');

		expect(service.resolvePendingIntercept).toHaveBeenCalledWith(
			{ sessionId: 'fallback-session', location: ChatLocation.Panel },
			'cancel',
			{ reason: 'user' }
		);
	});

	test('includes telemetry extra section when posting state', () => {
		mockExtraSectionsValue.push('telemetry');
		const { provider } = createProvider(logService);
		const postMessage = vi.fn().mockResolvedValue(undefined);
		(provider as any)._view = {
			webview: {
				postMessage
			}
		};

		(provider as any)._postStateToWebview();

		expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
			extraSections: ['telemetry']
		}));
	});
	function createProvider(logSvc: ILogService) {
		const onDidChange = new Emitter<EditableChatRequest>();
		const onDidRemove = new Emitter<{ sessionId: string; location: ChatLocation }>();
		const onDidInterception = new Emitter<PromptInterceptionState>();
		const onDidMetadata = new Emitter<LiveRequestMetadataEvent>();
		const onDidReplay = new Emitter<LiveRequestReplayEvent>();
		let currentMode: LiveRequestEditorMode = 'off';
		let currentScope: LiveRequestOverrideScope | undefined;
		let previewLimit = 3;

		const baseAutoOverride = () => ({
			enabled: true,
			capturing: false,
			hasOverrides: false,
			scope: currentScope,
			previewLimit
		});

		let currentInterceptionState: PromptInterceptionState;

		const service: ILiveRequestEditorService = {
			_serviceBrand: undefined,
			onDidChange: onDidChange.event,
			onDidRemoveRequest: onDidRemove.event,
			onDidUpdateSubagentHistory: new Emitter<void>().event,
			onDidChangeInterception: onDidInterception.event,
			onDidChangeMetadata: onDidMetadata.event,
			onDidChangeReplay: onDidReplay.event,
			isEnabled: () => true,
			isInterceptionEnabled: () => true,
			isReplayEnabled: () => true,
			prepareRequest: () => undefined,
			getRequest: () => undefined,
			updateSectionContent: () => undefined,
			deleteSection: () => undefined,
			restoreSection: () => undefined,
			resetRequest: () => undefined,
			updateTokenCounts: () => undefined,
			applyTraceData: () => undefined,
			getOriginalRequestMessages: () => undefined,
			updateRequestOptions: (_key: LiveRequestSessionKey, _requestOptions: OptionalChatRequestParams | undefined) => undefined,
			getMessagesForSend: (_key: LiveRequestSessionKey, _fallback: Raw.ChatMessage[]) => ({ messages: [] as Raw.ChatMessage[] }),
			getInterceptionState: () => currentInterceptionState,
			setMode: async mode => {
				currentMode = mode;
				currentInterceptionState = { ...currentInterceptionState, mode };
			},
			getMode: () => currentMode,
			setAutoOverrideScope: async scope => {
				currentScope = scope;
				currentInterceptionState = {
					...currentInterceptionState,
					autoOverride: { ...(currentInterceptionState.autoOverride ?? baseAutoOverride()), scope }
				};
			},
			getAutoOverrideScope: () => currentScope,
			configureAutoOverridePreviewLimit: async limit => {
				previewLimit = limit;
				currentInterceptionState = {
					...currentInterceptionState,
					autoOverride: { ...(currentInterceptionState.autoOverride ?? baseAutoOverride()), previewLimit }
				};
			},
			clearAutoOverrides: async (_scope?: LiveRequestOverrideScope) => {
				currentInterceptionState = {
					...currentInterceptionState,
					autoOverride: { ...(currentInterceptionState.autoOverride ?? baseAutoOverride()), hasOverrides: false }
				};
			},
			beginAutoOverrideCapture: (_key: LiveRequestSessionKey) => {
				currentInterceptionState = {
					...currentInterceptionState,
					autoOverride: { ...(currentInterceptionState.autoOverride ?? baseAutoOverride()), capturing: true }
				};
			},
			getAutoOverrideEntry: () => undefined,
			waitForInterceptionApproval: async () => undefined,
			resolvePendingIntercept: vi.fn(),
			handleContextChange: () => undefined,
			recordLoggedRequest: () => undefined,
			getSubagentRequests: () => [],
			clearSubagentHistory: () => undefined,
			getMetadataSnapshot: () => undefined,
			buildReplayForRequest: () => undefined,
			getReplaySnapshot: () => undefined,
			restorePreviousReplay: () => undefined,
			markReplayForkActive: () => undefined,
			markReplayStale: () => undefined,
		};
		const buildState = (overrides: Partial<PromptInterceptionState> = {}): PromptInterceptionState => {
			const autoOverride = overrides.autoOverride
				? { ...baseAutoOverride(), ...overrides.autoOverride }
				: baseAutoOverride();
			return {
				enabled: overrides.enabled ?? false,
				mode: overrides.mode ?? currentMode,
				paused: overrides.paused ?? false,
				pending: overrides.pending,
				autoOverride
			};
		};

		currentInterceptionState = buildState();
		const extensionUri = { toString: () => 'test', with: () => extensionUri } as unknown as vscode.Uri;

		const provider = new LiveRequestEditorProvider(extensionUri, logSvc, service);

		const emitRequest = (request: EditableChatRequest) => onDidChange.fire(request);
		const emitInterception = (state: PromptInterceptionState) => {
			currentInterceptionState = state;
			(provider as any)._handleInterceptionStateChanged(state);
		};

		return { provider, service, emitRequest, emitInterception, buildState };
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
