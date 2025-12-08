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
import { OptionalChatRequestParams } from '../../../../platform/networking/common/fetch';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { MockExtensionContext } from '../../../../platform/test/node/extensionContext';
import { SpyingTelemetryService } from '../../../../platform/telemetry/node/spyingTelemetryService';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { Emitter } from '../../../../util/vs/base/common/event';
import { EditableChatRequestInit, LiveRequestSessionKey, LiveRequestTraceSnapshot } from '../../common/liveRequestEditorModel';
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

function createRenderResultWithMessages(texts: string[]): RenderPromptResult {
	return {
		...nullRenderPromptResult(),
		messages: texts.map((text, index) => ({
			role: index === 0 ? Raw.ChatRole.System : Raw.ChatRole.User,
			content: [{
				type: Raw.ChatCompletionContentPartKind.Text,
				text
			}]
		}))
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

async function createService(extensionContext: IVSCodeExtensionContext = new MockExtensionContext() as unknown as IVSCodeExtensionContext) {
	const defaults = new DefaultsOnlyConfigurationService();
	const config = new InMemoryConfigurationService(defaults);
	await config.setConfig(ConfigKey.Advanced.LivePromptEditorEnabled, true);
	await config.setConfig(ConfigKey.Advanced.LivePromptEditorInterception, true);
	const telemetry = new SpyingTelemetryService();
	const chatSessions = new TestChatSessionService();
	const service = new LiveRequestEditorService(config, telemetry, chatSessions, extensionContext);
	return { service, telemetry, chatSessions, extensionContext, config };
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

	test('updateSectionContent updates messages and dirty flag', async () => {
		const { service } = await createService();
		const init = createServiceInit({ renderResult: createRenderResult('original text') });
		const key = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);
		const request = service.getRequest(key)!;
		const section = request.sections[0];

		service.updateSectionContent(key, section.id, 'edited text');
		const updated = service.getRequest(key)!;
		const updatedSection = updated.sections[0];
		expect(updatedSection.editedContent).toBe('edited text');
		expect(updated.messages[0].content[0].text).toBe('edited text');
		expect(updated.isDirty).toBe(true);
	});

	test('delete and restore section toggles projection and dirtiness', async () => {
		const { service } = await createService();
		const init = createServiceInit({ renderResult: createRenderResultWithMessages(['system', 'user']) });
		const key = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);
		const request = service.getRequest(key)!;
		const target = request.sections[1];

		service.deleteSection(key, target.id);
		const afterDelete = service.getRequest(key)!;
		expect(afterDelete.sections.find(s => s.id === target.id)?.deleted).toBe(true);
		expect(afterDelete.messages).toHaveLength(1);
		expect(afterDelete.isDirty).toBe(true);

		service.restoreSection(key, target.id);
		const afterRestore = service.getRequest(key)!;
		expect(afterRestore.sections.find(s => s.id === target.id)?.deleted).toBeFalsy();
		expect(afterRestore.messages).toHaveLength(2);
		expect(afterRestore.isDirty).toBe(false);
	});

	test('resetRequest restores original content and clears edits/deletes', async () => {
		const { service } = await createService();
		const init = createServiceInit({ renderResult: createRenderResultWithMessages(['system', 'user']) });
		const key = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);
		const request = service.getRequest(key)!;
		const first = request.sections[0];
		const second = request.sections[1];

		service.updateSectionContent(key, first.id, 'edited');
		service.deleteSection(key, second.id);

		service.resetRequest(key);
		const reset = service.getRequest(key)!;
		expect(reset.sections.map(s => s.content)).toEqual(['system', 'user']);
		expect(reset.sections.every(s => !s.deleted)).toBe(true);
		expect(reset.sections.every(s => s.editedContent === undefined)).toBe(true);
		expect(reset.isDirty).toBe(false);
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

	test('updateRequestOptions stores cloned payloads and emits change notifications', async () => {
		const { service } = await createService();
		const key = { sessionId: 'session', location: ChatLocation.Panel };
		service.prepareRequest(createServiceInit());
		let didFire = false;
		service.onDidChange(request => {
			if (request.sessionId === key.sessionId && request.location === key.location) {
				didFire = true;
			}
		});

		const options: OptionalChatRequestParams = { temperature: 0.2, top_p: 0.9, n: 1, tools: [] };
		service.updateRequestOptions(key, options);

		const stored = service.getRequest(key)?.metadata.requestOptions;
		expect(stored).toEqual(options);
		expect(stored).not.toBe(options);
		expect(didFire).toBe(true);
	});

	test('updateRequestOptions clears previously stored options', async () => {
		const { service } = await createService();
		const key = { sessionId: 'session', location: ChatLocation.Panel };
		service.prepareRequest(createServiceInit());

		service.updateRequestOptions(key, { temperature: 0.3 });
		expect(service.getRequest(key)?.metadata.requestOptions).toBeDefined();

		service.updateRequestOptions(key, undefined);
		expect(service.getRequest(key)?.metadata.requestOptions).toBeUndefined();
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

	test('auto override captures and reapplies edits for the session scope', async () => {
		const { service } = await createService();
		await service.setMode('autoOverride');
		const init = createServiceInit();
		service.prepareRequest(init);
		const key: LiveRequestSessionKey = { sessionId: init.sessionId, location: init.location };
		const decisionPromise = service.waitForInterceptionApproval(key, CancellationToken.None);
		const request = service.getRequest(key)!;
		const section = request.sections[0];
		service.updateSectionContent(key, section.id, 'modified by override');
		service.resolvePendingIntercept(key, 'resume');
		await decisionPromise;

		const followUp = createServiceInit({ sessionId: init.sessionId, requestId: 'req-2' });
		service.prepareRequest(followUp);
		const nextRequest = service.getRequest(key)!;
		expect(nextRequest.sections[0].content).toBe('modified by override');
		expect(nextRequest.sections[0].overrideState?.scope).toBe('session');
	});

	test('workspace auto overrides persist across service instances', async () => {
		const extensionContext = new MockExtensionContext() as unknown as IVSCodeExtensionContext;
		const first = await createService(extensionContext);
		await first.service.setMode('autoOverride');
		await first.service.setAutoOverrideScope('workspace');
		const initialInit = createServiceInit({ sessionId: 'workspace-session' });
		first.service.prepareRequest(initialInit);
		const key: LiveRequestSessionKey = { sessionId: initialInit.sessionId, location: initialInit.location };
		const decisionPromise = first.service.waitForInterceptionApproval(key, CancellationToken.None);
		const initialRequest = first.service.getRequest(key)!;
		first.service.updateSectionContent(key, initialRequest.sections[0].id, 'workspace override');
		first.service.resolvePendingIntercept(key, 'resume');
		await decisionPromise;

		const followUpInit = createServiceInit({ sessionId: 'another-session', requestId: 'req-follow' });
		first.service.prepareRequest(followUpInit);
		const followKey: LiveRequestSessionKey = { sessionId: followUpInit.sessionId, location: followUpInit.location };
		const followRequest = first.service.getRequest(followKey)!;
		expect(followRequest.sections[0].content).toBe('workspace override');
		expect(followRequest.sections[0].overrideState?.scope).toBe('workspace');

		const second = await createService(extensionContext);
		const rehydratedInit = createServiceInit({ sessionId: 'rehydrated-session', requestId: 'req-rehydrated' });
		second.service.prepareRequest(rehydratedInit);
		const rehydratedKey: LiveRequestSessionKey = { sessionId: rehydratedInit.sessionId, location: rehydratedInit.location };
		const rehydratedRequest = second.service.getRequest(rehydratedKey)!;
		expect(rehydratedRequest.sections[0].content).toBe('workspace override');
		expect(rehydratedRequest.sections[0].overrideState?.scope).toBe('workspace');
	});

	test('applyTraceData updates tokens and trace path metadata', async () => {
		const { service } = await createService();
		const renderResult: RenderPromptResult = {
			...nullRenderPromptResult(),
			messages: [
				{
					role: Raw.ChatRole.System,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'first' }]
				},
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'second' }]
				}
			]
		};
		const init = createServiceInit({ renderResult });
		const key: LiveRequestSessionKey = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);

		const snapshot: LiveRequestTraceSnapshot = {
			totalTokens: 42,
			perMessage: [
				{ tokenCount: 10, tracePath: ['root', 'system'] },
				{ tokenCount: 32, tracePath: ['root', 'user'] }
			]
		};

		const updated = service.applyTraceData(key, snapshot)!;
		expect(updated.metadata.tokenCount).toBe(42);
		expect(updated.sections[0].tokenCount).toBe(10);
		expect(updated.sections[0].hoverTitle).toBe('root › system');
		expect(updated.sections[0].metadata?.tracePath).toEqual(['root', 'system']);
		expect(updated.sections[1].tokenCount).toBe(32);
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
