/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw, RenderPromptResult } from '@vscode/prompt-tsx';
import { describe, expect, test } from 'vitest';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { IChatSessionService } from '../../../../platform/chat/common/chatSessionService';
import { ConfigKey } from '../../../../platform/configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../../../platform/configuration/common/defaultsOnlyConfigurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { SpyingTelemetryService } from '../../../../platform/telemetry/node/spyingTelemetryService';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { Emitter } from '../../../../util/vs/base/common/event';
import { EditableChatRequestInit, LiveRequestSessionKey } from '../../common/liveRequestEditorModel';
import { LiveRequestMetadataEvent } from '../../common/liveRequestEditorService';
import { LiveRequestEditorService } from '../liveRequestEditorService';
import { nullRenderPromptResult } from '../intents';

function createRenderResult(text: string): RenderPromptResult {
	return {
		...nullRenderPromptResult(),
		messages: [{
			role: Raw.ChatRole.User,
			content: [{
				type: Raw.ChatCompletionContentPartKind.Text,
				text
			}]
		}]
	};
}

class TestChatSessionService implements IChatSessionService {
	declare _serviceBrand: undefined;

	private readonly _onDidDispose = new Emitter<string>();
	public readonly onDidDisposeChatSession = this._onDidDispose.event;

	fireDidDispose(sessionId: string): void {
		this._onDidDispose.fire(sessionId);
	}
}

async function createService() {
	const defaults = new DefaultsOnlyConfigurationService();
	const config = new InMemoryConfigurationService(defaults);
	await config.setConfig(ConfigKey.Advanced.LivePromptEditorEnabled, true);
	await config.setConfig(ConfigKey.Advanced.LivePromptEditorInterception, true);
	const telemetry = new SpyingTelemetryService();
	const chatSessions = new TestChatSessionService();
	const service = new LiveRequestEditorService(config, telemetry, chatSessions);
	return { service, telemetry, chatSessions };
}

describe('LiveRequestEditorService interception', () => {
	test('resolves resume with edited messages', async () => {
		const { service, telemetry } = await createService();
		const init = createServiceInit();
		const key = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);
		const decisionPromise = service.waitForInterceptionApproval(key, CancellationToken.None);

		const request = service.getRequest(key)!;
		const firstSection = request.sections[0];
		service.updateSectionContent(key, firstSection.id, 'edited');
		const sendResult = service.getMessagesForSend(key, request.originalMessages);
		expect(sendResult.error).toBeUndefined();
		const editedMessages = sendResult.messages;
		service.resolvePendingIntercept(key, 'resume');

		const decision = await decisionPromise;
		expect(decision).toEqual({ action: 'resume', messages: editedMessages });

		const events = telemetry.getEvents().telemetryServiceEvents;
		const hasResumeEvent = events.some(evt => {
			const properties = evt.properties as Record<string, unknown> | undefined;
			return evt.eventName === 'liveRequestEditor.promptInterception.outcome' && properties?.['action'] === 'resume';
		});
		expect(hasResumeEvent).toBe(true);
	});

	test('resolves cancel when interception is discarded', async () => {
		const { service, telemetry } = await createService();
		const init = {
			sessionId: 'session',
			location: ChatLocation.Panel,
			debugName: 'debug',
			model: 'gpt-test',
			renderResult: createRenderResult('original'),
			requestId: 'req'
		};
		const key = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);
		const decisionPromise = service.waitForInterceptionApproval(key, CancellationToken.None);

		service.resolvePendingIntercept(key, 'cancel', { reason: 'user' });
		const decision = await decisionPromise;
		expect(decision).toEqual({ action: 'cancel', reason: 'user' });

		const events = telemetry.getEvents().telemetryServiceEvents;
		const hasCancelEvent = events.some(evt => {
			const properties = evt.properties as Record<string, unknown> | undefined;
			return evt.eventName === 'liveRequestEditor.promptInterception.outcome' && properties?.['reason'] === 'user';
		});
		expect(hasCancelEvent).toBe(true);
	});

	test('records logged request metadata when messages match', async () => {
		const { service, telemetry } = await createService();
		const key = { sessionId: 'session', location: ChatLocation.Panel };
		const init = createServiceInit();
		service.prepareRequest(init);
		const request = service.getRequest(key)!;

		service.recordLoggedRequest(key, request.messages);

		const updated = service.getRequest(key)!;
		expect(updated.metadata.lastLoggedMatches).toBe(true);
		const events = telemetry.getEvents().telemetryServiceEvents;
		expect(events.some(evt => evt.eventName === 'liveRequestEditor.requestParityMismatch')).toBe(false);
	});

	test('emits telemetry when logged messages differ', async () => {
		const { service, telemetry } = await createService();
		const key = { sessionId: 'session', location: ChatLocation.Panel };
		const init = createServiceInit();
		service.prepareRequest(init);
		const request = service.getRequest(key)!;
		const mutated = request.messages.map((message, index) => {
			if (index === 0) {
				return {
					...message,
					content: [{
						type: Raw.ChatCompletionContentPartKind.Text,
						text: 'mutated'
					}] satisfies Raw.ChatCompletionContentPart[]
				};
			}
			return message;
		});

		service.recordLoggedRequest(key, mutated);

		const updated = service.getRequest(key)!;
		expect(updated.metadata.lastLoggedMatches).toBe(false);
		const events = telemetry.getEvents().telemetryServiceEvents;
		expect(events.some(evt => evt.eventName === 'liveRequestEditor.requestParityMismatch')).toBe(true);
	});

	test('emits metadata events on prepare and disposal', async () => {
		const { service, chatSessions } = await createService();
		const events: LiveRequestMetadataEvent[] = [];
		service.onDidChangeMetadata(event => events.push(event));
		const init = createServiceInit();
		service.prepareRequest(init);
		expect(events.length).toBeGreaterThan(0);
		expect(events[events.length - 1]?.metadata?.sessionId).toBe(init.sessionId);

		chatSessions.fireDidDispose(init.sessionId);
		expect(events[events.length - 1]?.metadata).toBeUndefined();
	});

	test('tool sections expose invocation metadata', async () => {
		const { service } = await createService();
		const callId = 'call-123';
		const renderResult: RenderPromptResult = {
			...nullRenderPromptResult(),
			messages: [
				{
					role: Raw.ChatRole.Assistant,
					content: [{
						type: Raw.ChatCompletionContentPartKind.Text,
						text: ''
					}],
					toolCalls: [{
						id: callId,
						type: 'function',
						function: {
							name: 'runSearch',
							arguments: '{"query":"readme","limit":3}'
						}
					}]
				} as Raw.ChatMessage,
				{
					role: Raw.ChatRole.Tool,
					name: 'runSearch',
					toolCallId: callId,
					content: [{
						type: Raw.ChatCompletionContentPartKind.Text,
						text: 'result payload'
					}]
				} as Raw.ChatMessage
			]
		};

		const key = { sessionId: 'session', location: ChatLocation.Panel };
		service.prepareRequest(createServiceInit({ renderResult }));
		const request = service.getRequest(key)!;
		const toolSection = request.sections.find(section => section.kind === 'tool');
		expect(toolSection).toBeDefined();
		const toolInvocation = toolSection?.metadata?.toolInvocation as { id?: string; name?: string; arguments?: string } | undefined;
		expect(toolInvocation?.id).toBe(callId);
		expect(toolInvocation?.name).toBe('runSearch');
		expect(toolInvocation?.arguments).toContain('"limit": 3');
	});

	test('returns validation error when all sections deleted', async () => {
		const { service } = await createService();
		const key = { sessionId: 'session', location: ChatLocation.Panel };
		service.prepareRequest(createServiceInit());
		const request = service.getRequest(key)!;
		for (const section of [...request.sections]) {
			service.deleteSection(key, section.id);
		}

		const result = service.getMessagesForSend(key, request.originalMessages);
		expect(result.error?.code).toBe('empty');
	});

	test('cancels pending intercept when chat session is disposed', async () => {
		const { service, telemetry, chatSessions } = await createService();
		const key = { sessionId: 'session', location: ChatLocation.Panel };
		const removedKeys: LiveRequestSessionKey[] = [];
		service.onDidRemoveRequest(removedKey => removedKeys.push(removedKey));
		service.prepareRequest(createServiceInit());

		const decisionPromise = service.waitForInterceptionApproval(key, CancellationToken.None);
		chatSessions.fireDidDispose('session');

		const decision = await decisionPromise;
		expect(decision).toEqual({ action: 'cancel', reason: 'sessionDisposed' });
		expect(service.getRequest(key)).toBeUndefined();
		expect(removedKeys).toEqual([key]);

		const events = telemetry.getEvents().telemetryServiceEvents;
		const hasReason = events.some(evt => {
			const properties = evt.properties as Record<string, unknown> | undefined;
			return evt.eventName === 'liveRequestEditor.promptInterception.outcome' && properties?.['reason'] === 'sessionDisposed';
		});
		expect(hasReason).toBe(true);
	});

	test('records subagent requests in history', async () => {
		const { service } = await createService();
		const emitted: number[] = [];
		service.onDidUpdateSubagentHistory(() => emitted.push(1));
		service.prepareRequest(createServiceInit({ requestId: 'sub-1', isSubagent: true, debugName: 'subagent' }));

		const history = service.getSubagentRequests();
		expect(history).toHaveLength(1);
		expect(history[0].requestId).toBe('sub-1');
		expect(emitted).toHaveLength(1);
	});

	test('trims subagent history and reports telemetry', async () => {
		const { service, telemetry } = await createService();
		for (let i = 0; i < 12; i++) {
			service.prepareRequest(createServiceInit({ requestId: `sub-${i}`, isSubagent: true }));
		}
		const history = service.getSubagentRequests();
		expect(history).toHaveLength(10);
		const events = telemetry.getEvents().telemetryServiceEvents;
		expect(events.some(evt => evt.eventName === 'liveRequestEditor.subagentMonitor.trimmed')).toBe(true);
	});

	test('skips interception for subagent requests', async () => {
		const { service } = await createService();
		const key = { sessionId: 'session', location: ChatLocation.Panel };
		service.prepareRequest(createServiceInit({ isSubagent: true }));

		const decision = await service.waitForInterceptionApproval(key, CancellationToken.None);
		expect(decision).toBeUndefined();
		expect(service.getInterceptionState().pending).toBeUndefined();
	});

	test('clears subagent history', async () => {
		const { service, telemetry } = await createService();
		service.prepareRequest(createServiceInit({ requestId: 'sub-clear', isSubagent: true }));
		service.clearSubagentHistory();
		expect(service.getSubagentRequests()).toHaveLength(0);
		const events = telemetry.getEvents().telemetryServiceEvents;
		expect(events.some(evt => evt.eventName === 'liveRequestEditor.subagentMonitor.cleared')).toBe(true);
	});

	test('removes subagent entries when disposing the session', async () => {
		const { service, chatSessions } = await createService();
		service.prepareRequest(createServiceInit({ isSubagent: true }));
		expect(service.getSubagentRequests()).toHaveLength(1);
		chatSessions.fireDidDispose('session');
		expect(service.getSubagentRequests()).toHaveLength(0);
	});

	test('handleContextChange cancels pending intercepts with provided reason', async () => {
		const { service } = await createService();
		const key = { sessionId: 'session', location: ChatLocation.Panel };
		service.prepareRequest(createServiceInit());
		const decisionPromise = service.waitForInterceptionApproval(key, CancellationToken.None);

		service.handleContextChange({
			key: { sessionId: 'otherSession', location: ChatLocation.Panel },
			reason: 'contextChanged:newRequest'
		});

		const decision = await decisionPromise;
		expect(decision).toEqual({ action: 'cancel', reason: 'contextChanged:newRequest' });
	});

	const contextChangeScenarios = [
		{ label: 'model change', reason: 'contextChanged:model' },
		{ label: 'tool configuration change', reason: 'contextChanged:toolConfig' },
		{ label: 'new chat session creation', reason: 'contextChanged:newSession' },
	];

	for (const scenario of contextChangeScenarios) {
		test(`handleContextChange cancels pending intercept on ${scenario.label}`, async () => {
			const { service, telemetry } = await createService();
			const key = { sessionId: 'session', location: ChatLocation.Panel };
			service.prepareRequest(createServiceInit());
			const decisionPromise = service.waitForInterceptionApproval(key, CancellationToken.None);

			service.handleContextChange({ key, reason: scenario.reason });

			const decision = await decisionPromise;
			expect(decision).toEqual({ action: 'cancel', reason: scenario.reason });

			const events = telemetry.getEvents().telemetryServiceEvents;
			const sawReason = events.some(evt => {
				const properties = evt.properties as Record<string, unknown> | undefined;
				return evt.eventName === 'liveRequestEditor.promptInterception.outcome' && properties?.['reason'] === scenario.reason;
			});
			expect(sawReason).toBe(true);
		});
	}

	test('handleContextChange cancels all pending intercepts when switching sessions', async () => {
		const { service } = await createService();
		const keyA = { sessionId: 'session-a', location: ChatLocation.Panel };
		const keyB = { sessionId: 'session-b', location: ChatLocation.Editor };
		service.prepareRequest(createServiceInit({ sessionId: 'session-a', requestId: 'req-a' }));
		service.prepareRequest(createServiceInit({ sessionId: 'session-b', location: ChatLocation.Editor, requestId: 'req-b' }));

		const decisionAPromise = service.waitForInterceptionApproval(keyA, CancellationToken.None);
		const decisionBPromise = service.waitForInterceptionApproval(keyB, CancellationToken.None);

		service.handleContextChange({
			key: keyB,
			reason: 'contextChanged:sessionSwitch'
		});

		const decisionA = await decisionAPromise;
		const decisionB = await decisionBPromise;
		expect(decisionA).toEqual({ action: 'cancel', reason: 'contextChanged:sessionSwitch' });
		expect(decisionB).toEqual({ action: 'cancel', reason: 'contextChanged:sessionSwitch' });
		expect(service.getInterceptionState().pending).toBeUndefined();
	});

});

function createServiceInit(overrides: Partial<EditableChatRequestInit> = {}): EditableChatRequestInit {
	const defaults: EditableChatRequestInit = {
		sessionId: 'session',
		location: ChatLocation.Panel,
		debugName: 'debug',
		model: 'gpt-test',
		renderResult: createRenderResult('original'),
		requestId: 'req'
	};
	const merged: EditableChatRequestInit = { ...defaults, ...overrides };
	if (!overrides.renderResult) {
		merged.renderResult = defaults.renderResult;
	}
	return merged;
}
