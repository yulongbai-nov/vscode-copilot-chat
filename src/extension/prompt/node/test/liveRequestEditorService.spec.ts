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

function createRenderResultWithMessages(texts: string[], extraMessages: Raw.ChatMessage[] = []): RenderPromptResult {
	const baseMessages: Raw.ChatMessage[] = texts.map((text, index) => ({
		role: index === 0 ? Raw.ChatRole.System : Raw.ChatRole.User,
		content: [{
			type: Raw.ChatCompletionContentPartKind.Text,
			text
		}]
	}));
	return {
		...nullRenderPromptResult(),
		messages: [...baseMessages, ...extraMessages]
	};
}

function getText(part: Raw.ChatCompletionContentPart): string | undefined {
	return part.type === Raw.ChatCompletionContentPartKind.Text ? part.text : undefined;
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
	await config.setConfig(ConfigKey.LiveRequestEditorTimelineReplayEnabled, true);
	const telemetry = new SpyingTelemetryService();
	const chatSessions = new TestChatSessionService();
	const log = { _serviceBrand: undefined, trace() { }, debug() { }, info() { }, warn() { }, error() { }, show() { } };
	const service = new LiveRequestEditorService(config, telemetry, chatSessions, extensionContext, log);
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
		expect(getText(updated.messages[0].content[0])).toBe('edited text');
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

	test('getMessagesForSend builds payload after deletes and edits', async () => {
		const { service } = await createService();
		const init = createServiceInit({ renderResult: createRenderResultWithMessages(['sys', 'user1', 'user2']) });
		const key = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);

		const request = service.getRequest(key)!;
		service.deleteSection(key, request.sections[1].id); // remove user1
		service.updateSectionContent(key, request.sections[2].id, 'edited user2');

		const sendResult = service.getMessagesForSend(key, request.originalMessages);
		expect(sendResult.error).toBeUndefined();
		expect(sendResult.messages).toHaveLength(2);
		expect(sendResult.messages[0].role).toBe(Raw.ChatRole.System);
		expect(getText(sendResult.messages[0].content[0])).toBe('sys');
		expect(sendResult.messages[1].role).toBe(Raw.ChatRole.User);
		expect(getText(sendResult.messages[1].content[0])).toBe('edited user2');

		const mutatedRequest = service.getRequest(key)!;
		expect(mutatedRequest.isDirty).toBe(true);
		expect(mutatedRequest.messages).toHaveLength(2);
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

		const eventCountBeforeDispose = events.length;
		chatSessions.fireDidDispose(init.sessionId);
		// Requests are retained across session disposal for debugging/persistence, so
		// disposing a chat session should not clear the metadata snapshot.
		expect(events.length).toBe(eventCountBeforeDispose);
		expect(events[events.length - 1]?.metadata?.sessionId).toBe(init.sessionId);
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
		expect(service.getRequest(key)).toBeDefined();
		expect(removedKeys).toEqual([]);

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
		await second.service.setMode('autoOverride');
		const rehydratedInit = createServiceInit({ sessionId: 'rehydrated-session', requestId: 'req-rehydrated' });
		second.service.prepareRequest(rehydratedInit);
		const rehydratedKey: LiveRequestSessionKey = { sessionId: rehydratedInit.sessionId, location: rehydratedInit.location };
		const rehydratedRequest = second.service.getRequest(rehydratedKey)!;
		expect(rehydratedRequest.sections[0].content).toBe('workspace override');
		expect(rehydratedRequest.sections[0].overrideState?.scope).toBe('workspace');
	});

	test('request cache persists across service instances', async () => {
		const extensionContext = new MockExtensionContext() as unknown as IVSCodeExtensionContext;
		const first = await createService(extensionContext);
		const init = createServiceInit({ sessionId: 'persist-session', requestId: 'req-1', renderResult: createRenderResult('original text') });
		const key: LiveRequestSessionKey = { sessionId: init.sessionId, location: init.location };

		first.service.prepareRequest(init);
		const request = first.service.getRequest(key)!;
		first.service.updateSectionContent(key, request.sections[0].id, 'edited text');

		await (first.service as any).persistRequestCache();

		const second = await createService(extensionContext);
		const restored = second.service.getRequest(key)!;
		expect(getText(restored.messages[0].content[0])).toBe('edited text');
		expect(restored.isDirty).toBe(true);
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

	test('buildReplayForRequest builds projection with edits and deletions', async () => {
		const { service } = await createService();
		const requestOptions: OptionalChatRequestParams = { temperature: 0.3 };
		const init = createServiceInit({
			renderResult: createRenderResultWithMessages(['system', 'first', 'second']),
			requestOptions
		});
		const key: LiveRequestSessionKey = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);
		const request = service.getRequest(key)!;
		service.updateSectionContent(key, request.sections[1].id, 'first edited');
		service.deleteSection(key, request.sections[2].id);

		const replay = service.buildReplayForRequest(key)!;
		expect(replay.state).toBe('ready');
		expect(replay.version).toBe(1);
		expect(replay.payload).toHaveLength(2);
		expect(getText(replay.payload[1].content[0])).toBe('first edited');
		expect(replay.projection?.sections).toHaveLength(2);
		expect(replay.projection?.editedCount).toBe(1);
		expect(replay.projection?.deletedCount).toBe(1);
		expect(replay.projection?.overflowCount).toBe(0);
		expect(replay.projection?.requestOptions).toEqual(requestOptions);
		if (replay.projection?.requestOptions) {
			replay.projection.requestOptions.temperature = 0.9;
		}
		expect(request.metadata.requestOptions?.temperature).toBe(0.3);
	});

	test('edited sections preserve non-text content parts in replay payload', async () => {
		const { service } = await createService();
		// Build a render result that includes a user message with text + image_url parts.
		const imageMessage: Raw.ChatMessage = {
			role: Raw.ChatRole.User,
			// Use a loosely-typed image_url part so renderReplayMessageText
			// can recognize it without requiring full OpenAI schema fields.
			content: [
				{ type: Raw.ChatCompletionContentPartKind.Text, text: 'describe this image' },
				{ type: 'image_url' } as any,
			]
		};
		const init = createServiceInit({
			renderResult: createRenderResultWithMessages(['system'], [imageMessage])
		});
		const key: LiveRequestSessionKey = { sessionId: init.sessionId, location: init.location };

		service.prepareRequest(init);
		const request = service.getRequest(key)!;
		// Edit the user section; this should update the text but keep the image part.
		const userSection = request.sections.find(s => s.kind === 'user')!;
		service.updateSectionContent(key, userSection.id, 'updated description');

		const replay = service.buildReplayForRequest(key)!;
		const userPayload = replay.payload[1];
		expect(userPayload.role).toBe(Raw.ChatRole.User);
		expect(Array.isArray(userPayload.content)).toBe(true);
		// First part is the updated text.
		expect(getText(userPayload.content![0])).toBe('updated description');
		// Non-text parts (e.g. image_url) are preserved.
		const hasImagePart = (userPayload.content ?? []).some(
			part => (part as any).type === 'image_url' || (part as any).image_url
		);
		expect(hasImagePart).toBe(true);
	});

	test('edited multi-text-part messages collapse text and preserve interleaved non-text parts (legacy section editing)', async () => {
		const { service } = await createService();
		const imageMessage: Raw.ChatMessage = {
			role: Raw.ChatRole.User,
			content: [
				{ type: Raw.ChatCompletionContentPartKind.Text, text: 'aaa' },
				{
					type: Raw.ChatCompletionContentPartKind.Image,
					imageUrl: { url: 'https://example.com/image.png' }
				},
				{ type: Raw.ChatCompletionContentPartKind.Text, text: 'bbb' },
			]
		};
		const init = createServiceInit({
			renderResult: createRenderResultWithMessages(['system'], [imageMessage])
		});
		const key: LiveRequestSessionKey = { sessionId: init.sessionId, location: init.location };

		service.prepareRequest(init);
		const request = service.getRequest(key)!;
		const userSection = request.sections.find(s => s.kind === 'user')!;

		// Legacy section-level editing collapses all text into a single Text part
		// while preserving non-text parts (e.g. images).
		const updatedText = 'updated aggregate text';
		service.updateSectionContent(key, userSection.id, updatedText);

		const replay = service.buildReplayForRequest(key)!;
		const userPayload = replay.payload[1];
		expect(userPayload.role).toBe(Raw.ChatRole.User);
		expect(Array.isArray(userPayload.content)).toBe(true);
		// One Text part (aggregate) + one Image part.
		expect(userPayload.content).toHaveLength(2);

		const firstText = getText(userPayload.content![0])!;
		const imagePart = userPayload.content![1] as Raw.ChatCompletionContentPart;

		expect(firstText).toBe(updatedText);
		expect(imagePart.type).toBe(Raw.ChatCompletionContentPartKind.Image);
		expect((imagePart as Raw.ChatCompletionContentPartImage).imageUrl.url).toBe('https://example.com/image.png');
	});

	test('replay replace keeps restore buffer and increments version', async () => {
		const { service } = await createService();
		const init = createServiceInit({ renderResult: createRenderResultWithMessages(['system', 'first']) });
		const key: LiveRequestSessionKey = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);

		const first = service.buildReplayForRequest(key)!;
		expect(first.version).toBe(1);

		const request = service.getRequest(key)!;
		service.updateSectionContent(key, request.sections[1].id, 'second');
		const second = service.buildReplayForRequest(key)!;
		expect(second.version).toBe(2);
		expect(getText(second.payload[1].content[0])).toBe('second');

		const restored = service.restorePreviousReplay({ ...key, requestId: init.requestId })!;
		expect(restored.version).toBeGreaterThan(second.version);
		expect(restored.restoreOfVersion).toBe(second.version);
		expect(getText(restored.payload[1].content[0])).toBe('first');
	});

	test('markReplayStale marks snapshot stale and clears restore buffer', async () => {
		const { service } = await createService();
		const init = createServiceInit({ renderResult: createRenderResultWithMessages(['system', 'user']) });
		const key: LiveRequestSessionKey = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);
		service.buildReplayForRequest(key);

		service.markReplayStale(key, init.requestId, 'contextChanged:model');
		const stale = service.getReplaySnapshot({ ...key, requestId: init.requestId })!;
		expect(stale.state).toBe('stale');
		expect(stale.staleReason).toBe('contextChanged:model');
		expect(service.restorePreviousReplay({ ...key, requestId: init.requestId })).toBeUndefined();
	});

	test('markReplayForkActive moves replay into forkActive state', async () => {
		const { service } = await createService();
		const init = createServiceInit();
		const key: LiveRequestSessionKey = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);
		const ready = service.buildReplayForRequest(key)!;

		const forked = service.markReplayForkActive({ ...key, requestId: init.requestId }, 'fork-session');
		expect(forked?.state).toBe('forkActive');
		expect(forked?.forkSessionId).toBe('fork-session');
		expect((forked?.version ?? 0) > ready.version).toBe(true);
	});

	describe('LiveRequestEditorService leaf edits', () => {
		test('updateLeafByPath edits only the targeted text part and preserves non-text parts', async () => {
			const { service } = await createService();
			const renderResult: RenderPromptResult = {
				...nullRenderPromptResult(),
				messages: [{
					role: Raw.ChatRole.User,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'first' },
						{ type: Raw.ChatCompletionContentPartKind.Image, imageUrl: { url: 'https://example.com/image.png' } },
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'second' },
					]
				} as Raw.ChatMessage]
			};
			const init = createServiceInit({ renderResult });
			const key = { sessionId: init.sessionId, location: init.location };
			service.prepareRequest(init);

			service.updateLeafByPath(key, 'messages[0].content[2].text', 'edited');

			const request = service.getRequest(key)!;
			expect(request.messages).toHaveLength(1);
			expect(getText(request.messages[0].content[0])).toBe('first');
			expect((request.messages[0].content[1] as any).type).toBe(Raw.ChatCompletionContentPartKind.Image);
			expect((request.messages[0].content[1] as any).imageUrl?.url).toBe('https://example.com/image.png');
			expect(getText(request.messages[0].content[2])).toBe('edited');

			// Section projection updates so capture + replay can observe the edit.
			expect(request.sections[0].content).toContain('edited');
		});

		test('updateLeafByPath edits tool call arguments only', async () => {
			const { service } = await createService();
			const renderResult: RenderPromptResult = {
				...nullRenderPromptResult(),
				messages: [{
					role: Raw.ChatRole.Assistant,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: '' }],
					toolCalls: [{
						id: 'call-1',
						type: 'function',
						function: { name: 'readFile', arguments: '{"path":"a.txt"}' }
					}]
				} as Raw.ChatMessage]
			};
			const init = createServiceInit({ renderResult });
			const key = { sessionId: init.sessionId, location: init.location };
			service.prepareRequest(init);

			service.updateLeafByPath(key, 'messages[0].toolCalls[0].function.arguments', '{"path":"b.txt"}');

			const request = service.getRequest(key)!;
			const call = (request.messages[0] as any).toolCalls?.[0];
			expect(call?.id).toBe('call-1');
			expect(call?.function?.name).toBe('readFile');
			expect(call?.function?.arguments).toBe('{"path":"b.txt"}');
		});

		test('undoLastEdit and redoLastEdit revert leaf edits', async () => {
			const { service } = await createService();
			const init = createServiceInit({ renderResult: createRenderResult('hello') });
			const key = { sessionId: init.sessionId, location: init.location };
			service.prepareRequest(init);

			service.updateLeafByPath(key, 'messages[0].content[0].text', 'edited');
			expect(getText(service.getRequest(key)!.messages[0].content[0])).toBe('edited');

			service.undoLastEdit(key);
			expect(getText(service.getRequest(key)!.messages[0].content[0])).toBe('hello');

			service.redoLastEdit(key);
			expect(getText(service.getRequest(key)!.messages[0].content[0])).toBe('edited');
		});
	});

	test('buildReplayForRequest respects replay flag', async () => {
		const { service, config } = await createService();
		const init = createServiceInit();
		const key: LiveRequestSessionKey = { sessionId: init.sessionId, location: init.location };
		service.prepareRequest(init);
		await config.setConfig(ConfigKey.LiveRequestEditorTimelineReplayEnabled, false);
		expect(service.isReplayEnabled()).toBe(false);
		const replay = service.buildReplayForRequest(key);
		expect(replay).toBeUndefined();
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
