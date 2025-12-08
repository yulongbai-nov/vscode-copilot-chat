/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Raw, RenderPromptResult } from '@vscode/prompt-tsx';
import { afterEach, beforeEach, expect, suite, test } from 'vitest';
import type { ChatLanguageModelToolReference, ChatPromptReference, ChatRequest, ExtendedChatResponsePart, LanguageModelChat } from 'vscode';
import { IChatMLFetcher, IFetchMLOptions } from '../../../../platform/chat/common/chatMLFetcher';
import { IChatSessionService } from '../../../../platform/chat/common/chatSessionService';
import { toTextPart } from '../../../../platform/chat/common/globalStringUtils';
import { ChatFetchResponseType, ChatResponse, ChatResponses } from '../../../../platform/chat/common/commonTypes';
import { StaticChatMLFetcher } from '../../../../platform/chat/test/common/staticChatMLFetcher';
import { MockEndpoint } from '../../../../platform/endpoint/test/node/mockEndpoint';
import { IResponseDelta } from '../../../../platform/networking/common/fetch';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { ConfigKey } from '../../../../platform/configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../../../platform/configuration/common/defaultsOnlyConfigurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry';
import { SpyingTelemetryService } from '../../../../platform/telemetry/node/spyingTelemetryService';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { NullWorkspaceFileIndex } from '../../../../platform/workspaceChunkSearch/node/nullWorkspaceFileIndex';
import { IWorkspaceFileIndex } from '../../../../platform/workspaceChunkSearch/node/workspaceFileIndex';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { MockExtensionContext } from '../../../../platform/test/node/extensionContext';
import { ChatResponseStreamImpl } from '../../../../util/common/chatResponseStreamImpl';
import { DeferredPromise } from '../../../../util/vs/base/common/async';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { Emitter, Event } from '../../../../util/vs/base/common/event';
import { isObject, isUndefinedOrNull } from '../../../../util/vs/base/common/types';
import { generateUuid } from '../../../../util/vs/base/common/uuid';
import { SyncDescriptor } from '../../../../util/vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { ChatLocation, ChatResponseConfirmationPart, ChatResponseMarkdownPart, LanguageModelTextPart, LanguageModelToolResult } from '../../../../vscodeTypes';
import { ToolCallingLoop } from '../../../intents/node/toolCallingLoop';
import { ToolResultMetadata } from '../../../prompts/node/panel/toolCalling';
import { createExtensionUnitTestingServices, type TestingServiceCollection } from '../../../test/node/services';
import { Conversation, Turn } from '../../common/conversation';
import { IBuildPromptContext } from '../../common/intents';
import { ToolCallRound } from '../../common/toolCallRound';
import { ChatTelemetryBuilder } from '../chatParticipantTelemetry';
import { DefaultIntentRequestHandler } from '../defaultIntentRequestHandler';
import { LiveRequestEditorService } from '../liveRequestEditorService';
import { IIntent, IIntentInvocation, nullRenderPromptResult, promptResultMetadata } from '../intents';
import { ILiveRequestEditorService, LiveRequestEditorMode, LiveRequestMetadataSnapshot, LiveRequestOverrideScope, PromptInterceptionDecision } from '../../common/liveRequestEditorService';
import { EditableChatRequest, EditableChatRequestInit, LiveRequestValidationError } from '../../common/liveRequestEditorModel';

suite('defaultIntentRequestHandler', () => {
	let accessor: ITestingServicesAccessor;
	let response: ExtendedChatResponsePart[];
	let chatResponse: (string | IResponseDelta[])[] = [];
	let promptResult: RenderPromptResult | RenderPromptResult[];
	let telemetry: SpyingTelemetryService;
	let endpoint: IChatEndpoint;
	let turnIdCounter = 0;
	let builtPrompts: IBuildPromptContext[] = [];
	const sessionId = 'some-session-id';

	const getTurnId = () => `turn-id-${turnIdCounter}`;

	function setupServices(customize?: (services: TestingServiceCollection, defaultLiveRequestEditorService: TestLiveRequestEditorService) => ILiveRequestEditorService | void) {
		accessor?.dispose();
		const services = createExtensionUnitTestingServices();
		telemetry = new SpyingTelemetryService();
		services.define(ITelemetryService, telemetry);
		services.define(IChatMLFetcher, new StaticChatMLFetcher(chatResponse));
		services.define(IWorkspaceFileIndex, new SyncDescriptor(NullWorkspaceFileIndex));
		const defaultLiveRequestEditorService = new TestLiveRequestEditorService();
		defaultLiveRequestEditorService.enabled = false;
		defaultLiveRequestEditorService.interceptionEnabled = false;
		const override = customize?.(services, defaultLiveRequestEditorService);
		services.define(ILiveRequestEditorService, override ?? defaultLiveRequestEditorService);
		accessor = services.createTestingAccessor();
		endpoint = accessor.get(IInstantiationService).createInstance(MockEndpoint, undefined);
	}

	function resetState(customize?: (services: TestingServiceCollection, defaultLiveRequestEditorService: TestLiveRequestEditorService) => ILiveRequestEditorService | void) {
		response = [];
		chatResponse = [];
		builtPrompts = [];
		promptResult = nullRenderPromptResult();
		turnIdCounter = 0;
		(ToolCallingLoop as any).NextToolCallId = 0;
		(ToolCallRound as any).generateID = () => 'static-id';
		setupServices(customize);
	}

	beforeEach(async () => {
		resetState();
	});

	afterEach(() => {
		accessor.dispose();
	});

	const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

	function getDerandomizedTelemetry() {
		const evts = telemetry.getEvents();
		return cloneAndChangeWithKey(evts, (e, key) => {
			if (typeof e === 'string' && uuidRegex.test(e)) {
				return 'some-uuid';
			} else if (typeof e === 'number' && typeof key === 'string' && key.startsWith('timeTo')) {
				return '<duration>';
			}
		});
	}

	class TestIntent implements IIntent {
		id = 'test';
		description = 'test intent';
		locations = [ChatLocation.Panel];
		invoke(): Promise<IIntentInvocation> {
			return Promise.resolve(new TestIntentInvocation(this, this.locations[0], endpoint));
		}
	}

	class TestIntentInvocation implements IIntentInvocation {
		public readonly context: IBuildPromptContext[] = [];

		constructor(
			readonly intent: IIntent,
			readonly location: ChatLocation,
			readonly endpoint: IChatEndpoint,
		) { }

		async buildPrompt(context: IBuildPromptContext): Promise<RenderPromptResult> {
			builtPrompts.push(context);
			if (Array.isArray(promptResult)) {
				const next = promptResult.shift();
				if (!next) {
					throw new Error('ran out of prompts');
				}
				return next;
			}

			return promptResult;
		}
	}

	class TestChatRequest implements ChatRequest {
		toolInvocationToken!: never;
		acceptedConfirmationData?: any[] | undefined;
		rejectedConfirmationData?: any[] | undefined;
		attempt = 1;
		enableCommandDetection = false;
		isParticipantDetected = false;
		location = ChatLocation.Panel;
		location2 = undefined;
		prompt = 'hello world!';
		command: string | undefined;
		references: readonly ChatPromptReference[] = [];
		toolReferences: readonly ChatLanguageModelToolReference[] = [];
		model: LanguageModelChat = { family: '' } as any;
		tools = new Map();
		id = generateUuid();
		sessionId = generateUuid();
		isSubagent = false;
	}

	class TestLiveRequestEditorService implements ILiveRequestEditorService {
		declare readonly _serviceBrand: undefined;
		onDidChange = Event.None;
		onDidRemoveRequest = Event.None;
		onDidUpdateSubagentHistory = Event.None;
		onDidChangeInterception = Event.None;
		onDidChangeMetadata = Event.None;

		public enabled = true;
		public interceptionEnabled = true;
		public mode: LiveRequestEditorMode = 'off';
		public overrideScope: LiveRequestOverrideScope | undefined;
		public previewLimit = 3;
		public isInterceptionEnabledCalls = 0;
		public waitCount = 0;
		public resumeCalls = 0;
		public cancelCalls = 0;
		public lastResolved?: PromptInterceptionDecision;
		private _messages: Raw.ChatMessage[] = [];
		private _deferred?: DeferredPromise<PromptInterceptionDecision>;
		public validationError?: LiveRequestValidationError;
		public prepareRequestCalls: EditableChatRequestInit[] = [];

		isEnabled(): boolean { return this.enabled; }
		isInterceptionEnabled(): boolean {
			this.isInterceptionEnabledCalls++;
			return this.enabled && this.interceptionEnabled;
		}
		getInterceptionState() {
			return {
				enabled: this.isInterceptionEnabled(),
				pending: undefined,
				mode: this.mode,
				paused: false,
				autoOverride: {
					enabled: true,
					capturing: false,
					hasOverrides: false,
					scope: this.overrideScope,
					previewLimit: this.previewLimit,
				}
			};
		}

		async setMode(mode: LiveRequestEditorMode): Promise<void> {
			this.mode = mode;
		}

		getMode(): LiveRequestEditorMode {
			return this.mode;
		}

		async setAutoOverrideScope(scope: LiveRequestOverrideScope): Promise<void> {
			this.overrideScope = scope;
		}

		getAutoOverrideScope(): LiveRequestOverrideScope | undefined {
			return this.overrideScope;
		}

		async configureAutoOverridePreviewLimit(limit: number): Promise<void> {
			this.previewLimit = limit;
		}

		async clearAutoOverrides(): Promise<void> {
			// no-op
		}

		beginAutoOverrideCapture(): void {
			// no-op
		}

		getAutoOverrideEntry(): undefined {
			return undefined;
		}

		updateRequestOptions(): EditableChatRequest | undefined {
			return undefined;
		}

		prepareRequest(init: EditableChatRequestInit): EditableChatRequest | undefined {
			this.prepareRequestCalls.push(init);
			return undefined;
		}
		getRequest(): EditableChatRequest | undefined { return undefined; }
		updateSectionContent(): EditableChatRequest | undefined { return undefined; }
		deleteSection(): EditableChatRequest | undefined { return undefined; }
		restoreSection(): EditableChatRequest | undefined { return undefined; }
		resetRequest(): EditableChatRequest | undefined { return undefined; }
		updateTokenCounts(): EditableChatRequest | undefined { return undefined; }
		applyTraceData(): EditableChatRequest | undefined { return undefined; }

		getMessagesForSend(_key: any, fallback: Raw.ChatMessage[]) {
			const messages = this._messages.length ? this._messages : fallback;
			return { messages, error: this.validationError };
		}

		waitForInterceptionApproval(): Promise<PromptInterceptionDecision | undefined> {
			if (!this.isInterceptionEnabled()) {
				return Promise.resolve(undefined);
			}
			this.waitCount++;
			this._deferred = new DeferredPromise<PromptInterceptionDecision>();
			return this._deferred.p;
		}

		handleContextChange(): void {
			// no-op
		}

		setValidationError(error: LiveRequestValidationError | undefined): void {
			this.validationError = error;
		}

		resolvePendingIntercept(_key: any, action: 'resume' | 'cancel', options?: { reason?: string }): void {
			if (action === 'resume') {
				this.resume(this._messages);
			} else {
				this.cancel(options?.reason);
			}
		}

		setMessages(messages: Raw.ChatMessage[]): void {
			this._messages = messages;
		}

		resume(messages: Raw.ChatMessage[]): void {
			if (!this._deferred) {
				return;
			}
			this.resumeCalls++;
			this.lastResolved = { action: 'resume', messages };
			this._deferred.complete(this.lastResolved);
			this._deferred = undefined;
		}

		cancel(reason?: string): void {
			if (!this._deferred) {
				return;
			}
			this.cancelCalls++;
			this.lastResolved = { action: 'cancel', reason };
			this._deferred.complete(this.lastResolved);
			this._deferred = undefined;
		}

		recordLoggedRequest(): void {
			// no-op for tests
		}
		getSubagentRequests(): readonly [] {
			return [];
		}
		clearSubagentHistory(): void {
			// no-op
		}
	getMetadataSnapshot(): LiveRequestMetadataSnapshot | undefined {
			return undefined;
		}
	}

	class RecordingChatMLFetcher implements IChatMLFetcher {
		_serviceBrand: undefined;
		onDidMakeChatMLRequest = Event.None;
		public readonly requests: IFetchMLOptions[] = [];

		constructor(private readonly value: string = 'ok') { }

		async fetchOne(options: IFetchMLOptions): Promise<ChatResponse> {
			this.requests.push(options);
			options.finishedCb?.('', 0, { text: this.value });
			return {
				type: ChatFetchResponseType.Success,
				requestId: '',
				serverRequestId: '',
				usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
				value: this.value,
				resolvedModel: ''
			};
		}

		async fetchMany(options: IFetchMLOptions): Promise<ChatResponses> {
			this.requests.push(options);
			return {
				type: ChatFetchResponseType.Success,
				requestId: '',
				serverRequestId: '',
				usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
				value: [this.value],
				resolvedModel: ''
			};
		}
	}

	class IntegrationChatSessionService implements IChatSessionService {
		declare readonly _serviceBrand: undefined;
		private readonly _onDidDispose = new Emitter<string>();
		readonly onDidDisposeChatSession = this._onDidDispose.event;
		dispose(): void {
			this._onDidDispose.dispose();
		}
	}

	async function createLiveRequestEditorServiceForIntegration(): Promise<{ service: LiveRequestEditorService; chatSessions: IntegrationChatSessionService }> {
		const defaults = new DefaultsOnlyConfigurationService();
		const config = new InMemoryConfigurationService(defaults);
		await config.setConfig(ConfigKey.Advanced.LivePromptEditorEnabled, true);
		await config.setConfig(ConfigKey.Advanced.LivePromptEditorInterception, true);
		const telemetry = new SpyingTelemetryService();
		const chatSessions = new IntegrationChatSessionService();
		const extensionContext = new MockExtensionContext() as unknown as IVSCodeExtensionContext;
		const service = new LiveRequestEditorService(config, telemetry, chatSessions, extensionContext);
		return { service, chatSessions };
	}

	const responseStream = new ChatResponseStreamImpl(p => response.push(p), () => { });
	const maxToolCallIterations = 3;

	const makeHandler = ({
		request = new TestChatRequest(),
		turns = []
	}: { request?: ChatRequest; turns?: Turn[] } = {}) => {
		turns.push(new Turn(
			getTurnId(),
			{ type: 'user', message: request.prompt },
			undefined,
		));

		const instaService = accessor.get(IInstantiationService);
		return instaService.createInstance(
			DefaultIntentRequestHandler,
			new TestIntent(),
			new Conversation(sessionId, turns),
			request,
			responseStream,
			CancellationToken.None,
			undefined,
			ChatLocation.Panel,
			instaService.createInstance(ChatTelemetryBuilder, Date.now(), sessionId, undefined, turns.length > 1, request),
			{ maxToolCallIterations },
			Event.None,
		);
	};

	async function waitForCondition(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
		const start = Date.now();
		while (!predicate()) {
			if (Date.now() - start > timeoutMs) {
				throw new Error('Condition not met in time');
			}
			await new Promise(resolve => setTimeout(resolve, 10));
		}
	}

	test('avoids requests when handler return is null', async () => {
		const handler = makeHandler();
		const result = await handler.getResult();
		expect(result).to.deep.equal({});
		expect(getDerandomizedTelemetry()).toMatchSnapshot();
	});

	test('makes a successful request with a single turn', async () => {
		const handler = makeHandler();
		chatResponse[0] = 'some response here :)';
		promptResult = {
			...nullRenderPromptResult(),
			messages: [{ role: Raw.ChatRole.User, content: [toTextPart('hello world!')] }],
		};

		const result = await handler.getResult();
		expect(result).toMatchSnapshot();
		// Wait for event loop to finish as we often fire off telemetry without properly awaiting it as it doesn't matter when it is sent
		await new Promise(setImmediate);
		expect(getDerandomizedTelemetry()).toMatchSnapshot();
	});

	test('makes a tool call turn', async () => {
		const handler = makeHandler();
		chatResponse[0] = [{
			text: 'some response here :)',
			copilotToolCalls: [{
				arguments: 'some args here',
				name: 'my_func',
				id: 'tool_call_id',
			}],
		}];
		chatResponse[1] = 'response to tool call';

		const toolResult = new LanguageModelToolResult([new LanguageModelTextPart('tool-result')]);

		promptResult = {
			...nullRenderPromptResult(),
			messages: [{ role: Raw.ChatRole.User, content: [toTextPart('hello world!')] }],
			metadata: promptResultMetadata([new ToolResultMetadata('tool_call_id__vscode-0', toolResult)])
		};

		const result = await handler.getResult();
		expect(result).toMatchSnapshot();
		// Wait for event loop to finish as we often fire off telemetry without properly awaiting it as it doesn't matter when it is sent
		await new Promise(setImmediate);
		expect(getDerandomizedTelemetry()).toMatchSnapshot();

		expect(builtPrompts).toHaveLength(2);
		expect(builtPrompts[1].toolCallResults).toEqual({ 'tool_call_id__vscode-0': toolResult });
		expect(builtPrompts[1].toolCallRounds).toMatchObject([
			{
				toolCalls: [{ arguments: 'some args here', name: 'my_func', id: 'tool_call_id__vscode-0' }],
				toolInputRetry: 0,
				response: 'some response here :)',
			},
			{
				toolCalls: [],
				toolInputRetry: 0,
				response: 'response to tool call',
			},
		]);
	});

	test('pauses send until prompt interception resumes', async () => {
		const interceptService = new TestLiveRequestEditorService();
		interceptService.enabled = true;
		interceptService.interceptionEnabled = true;
		resetState(() => interceptService);
		expect(accessor.get(ILiveRequestEditorService)).to.equal(interceptService);
		expect(interceptService.isInterceptionEnabled()).to.equal(true);
		chatResponse[0] = 'intercepted response';
		const editedMessages: Raw.ChatMessage[] = [{ role: Raw.ChatRole.User, content: [toTextPart('edited prompt')] }];
		promptResult = {
			...nullRenderPromptResult(),
			messages: [{ role: Raw.ChatRole.User, content: [toTextPart('original prompt')] }],
		};

		const handler = makeHandler();
		const resultPromise = handler.getResult();
		await waitForCondition(() => interceptService.waitCount === 1);

		interceptService.setMessages(editedMessages);
		interceptService.resume(editedMessages);

		const result = await resultPromise;
		expect(result).toMatchSnapshot();
		expect(interceptService.waitCount).to.equal(1);
		expect(interceptService.resumeCalls).to.equal(1);
	});

	test('cancels pending request when prompt interception cancels', async () => {
		const interceptService = new TestLiveRequestEditorService();
		interceptService.enabled = true;
		interceptService.interceptionEnabled = true;
		resetState(() => interceptService);
		expect(accessor.get(ILiveRequestEditorService)).to.equal(interceptService);
		expect(interceptService.isInterceptionEnabled()).to.equal(true);

		promptResult = {
			...nullRenderPromptResult(),
			messages: [{ role: Raw.ChatRole.User, content: [toTextPart('cancel me')] }],
		};

		const handler = makeHandler();
		const resultPromise = handler.getResult();
		await waitForCondition(() => interceptService.waitCount === 1);
		interceptService.cancel('user');
		const result = await resultPromise;
		expect(result).to.deep.equal({});
		const userVisibleResponses = response.filter(part => {
			if ((part as any).kind === 'markdown') {
				const content = (part as any).content;
				if (typeof content === 'string' && content.includes('<debug-note>')) {
					return false;
				}
				if (content && typeof (content as any).value === 'string' && (content as any).value.includes('<debug-note>')) {
					return false;
				}
			}
			return true;
		});
		expect(userVisibleResponses.length).to.be.greaterThan(0);
		expect(userVisibleResponses[0]).toMatchSnapshot();
		expect(interceptService.cancelCalls).to.equal(1);
	});

	test('does not intercept subagent requests', async () => {
		const interceptService = new TestLiveRequestEditorService();
		interceptService.enabled = true;
		interceptService.interceptionEnabled = true;
		resetState(() => interceptService);

		const subagentRequest = new TestChatRequest();
		subagentRequest.isSubagent = true;
		chatResponse[0] = 'subagent response';
		promptResult = {
			...nullRenderPromptResult(),
			messages: [{ role: Raw.ChatRole.User, content: [toTextPart('auto flow')] }],
		};

		const handler = makeHandler({ request: subagentRequest });
		const result = await handler.getResult();
		expect(result).toMatchSnapshot();
		expect(interceptService.waitCount).to.equal(0);
		expect(interceptService.prepareRequestCalls).to.have.length(1);
		expect(interceptService.prepareRequestCalls[0].isSubagent).to.equal(true);
	});

	test('subagent requests integrate with LiveRequestEditorService without interception', async () => {
		const { service, chatSessions } = await createLiveRequestEditorServiceForIntegration();
		resetState(() => service);

		const subagentRequest = new TestChatRequest();
		subagentRequest.isSubagent = true;
		chatResponse[0] = 'integrated subagent response';
		promptResult = {
			...nullRenderPromptResult(),
			messages: [{ role: Raw.ChatRole.User, content: [toTextPart('auto flow integration')] }],
		};

		try {
			const handler = makeHandler({ request: subagentRequest });
			const result = await handler.getResult();
			expect(result).toMatchSnapshot();

			const history = service.getSubagentRequests();
			expect(history.length).to.equal(1);
			expect(history[0].debugName).to.equal('tool/runSubagent');
			expect(service.getInterceptionState().pending).to.be.undefined;
		} finally {
			service.dispose();
			chatSessions.dispose();
		}
	});

	test('live request editor request options include sampling defaults', async () => {
		const interceptService = new TestLiveRequestEditorService();
		interceptService.enabled = true;
		interceptService.interceptionEnabled = false;
		resetState(() => interceptService);

		const handler = makeHandler();
		await handler.getResult();

		expect(interceptService.prepareRequestCalls).to.have.length(1);
		const requestOptions = interceptService.prepareRequestCalls[0].requestOptions;
		expect(requestOptions).to.be.ok;
		expect(requestOptions?.n).to.equal(1);
		expect(requestOptions?.top_p).to.equal(1);
		expect(requestOptions?.temperature).to.equal(0.2);
	});

	test('surfaces validation errors when prompt edits remove all sections', async () => {
		const editorService = new TestLiveRequestEditorService();
		editorService.enabled = true;
		editorService.setValidationError({ code: 'empty' });
		resetState(() => editorService);

		promptResult = {
			...nullRenderPromptResult(),
			messages: [{ role: Raw.ChatRole.User, content: [toTextPart('remove everything')] }],
		};

		const handler = makeHandler();
		const result = await handler.getResult();
		expect(result).to.deep.equal({});
		const last = response.at(-1) as ChatResponseMarkdownPart;
		expect(last.value.value).to.contain('Prompt cannot be sent because all sections were removed.');
	});

	test('uses edited messages for send when interception is off', async () => {
		const recordingFetcher = new RecordingChatMLFetcher('edited-response');
		const editorService = new TestLiveRequestEditorService();
		editorService.enabled = true;
		editorService.interceptionEnabled = false;
		editorService.setMessages([{ role: Raw.ChatRole.User, content: [toTextPart('edited user')] }]);

		resetState((services) => {
			services.define(IChatMLFetcher, recordingFetcher);
			return editorService;
		});

		promptResult = {
			...nullRenderPromptResult(),
			messages: [{ role: Raw.ChatRole.User, content: [toTextPart('original prompt')] }],
		};

		const handler = makeHandler();
		await handler.getResult();

		expect(recordingFetcher.requests).to.have.length(1);
		const sent = recordingFetcher.requests[0].messages;
		const sentContent = sent[0].content[0] as Raw.ChatCompletionContentPart;
		expect(sentContent.type).to.equal(Raw.ChatCompletionContentPartKind.Text);
		expect(sentContent.type === Raw.ChatCompletionContentPartKind.Text ? sentContent.text : undefined).to.equal('edited user');
	});

	function fillWithToolCalls(insertN = 20) {
		promptResult = [];
		for (let i = 0; i < insertN; i++) {
			chatResponse[i] = [{
				text: `response number ${i}`,
				copilotToolCalls: [{
					arguments: 'some args here',
					name: 'my_func',
					id: `tool_call_id_${i}`,
				}],
			}];
			const toolResult = new LanguageModelToolResult([new LanguageModelTextPart(`tool-result-${i}`)]);
			promptResult[i] = {
				...nullRenderPromptResult(),
				messages: [{ role: Raw.ChatRole.User, content: [toTextPart('hello world!')] }],
				metadata: promptResultMetadata([new ToolResultMetadata(`tool_call_id_${i}__vscode-${i}`, toolResult)])
			};
		}
	}

	function setupMultiturnToolCalls(turns: number, roundsPerTurn: number) {
		// Matches the counter in ToolCallingLoop
		let toolCallCounter = 0;
		promptResult = [];
		const setupOneRound = (startIdx: number) => {
			const endIdx = startIdx + roundsPerTurn;
			for (let i = startIdx; i < endIdx; i++) {
				const isLast = i === endIdx - 1;
				chatResponse[i] = [{
					text: `response number ${i}`,
					copilotToolCalls: isLast ?
						undefined :
						[{
							arguments: 'some args here',
							name: 'my_func',
							id: `tool_call_id_${toolCallCounter++}`,
						}],
				}];

				// ToolResultMetadata is reported by the prompt for all tool calls, in history or called this round
				const promptMetadata: ToolResultMetadata[] = [];
				for (let toolResultIdx = 0; toolResultIdx <= toolCallCounter; toolResultIdx++) {
					// For each request in a round, all the previous and current ToolResultMetadata are reported
					const toolResult = new LanguageModelToolResult([new LanguageModelTextPart(`tool-result-${toolResultIdx}`)]);
					promptMetadata.push(new ToolResultMetadata(`tool_call_id_${toolResultIdx}__vscode-${toolResultIdx}`, toolResult));
				}
				(promptResult as RenderPromptResult[])[i] = {
					...nullRenderPromptResult(),
					messages: [{ role: Raw.ChatRole.User, content: [toTextPart('hello world!')] }],
					metadata: promptResultMetadata(promptMetadata)
				};
			}
		};

		for (let i = 0; i < turns; i++) {
			setupOneRound(i * roundsPerTurn);
		}
	}

	test('confirms on max tool call iterations, and continues to iterate', async () => {
		const handler = makeHandler();
		fillWithToolCalls();
		const result1 = await handler.getResult();
		expect(result1).toMatchSnapshot();

		const last = response.at(-1);
		expect(last).toBeInstanceOf(ChatResponseConfirmationPart);

		const request = new TestChatRequest();
		request.acceptedConfirmationData = [(last as ChatResponseConfirmationPart).data];
		const handler2 = makeHandler({ request });
		expect(await handler2.getResult()).toMatchSnapshot();

		expect(response).toMatchSnapshot();
		// Wait for event loop to finish as we often fire off telemetry without properly awaiting it as it doesn't matter when it is sent
		await new Promise(setImmediate);
		expect(getDerandomizedTelemetry()).toMatchSnapshot();
	});

	test('ChatResult metadata after multiple turns only has tool results from current turn', async () => {
		const request = new TestChatRequest();
		const handler = makeHandler();
		setupMultiturnToolCalls(2, maxToolCallIterations);
		const result1 = await handler.getResult();
		expect(result1.metadata).toMatchSnapshot();

		const turn1 = new Turn(generateUuid(), { message: request.prompt, type: 'user' }, undefined);
		const handler2 = makeHandler({ request, turns: [turn1] });
		const result2 = await handler2.getResult();
		expect(result2.metadata).toMatchSnapshot();
	});

	test('aborts on max tool call iterations', async () => {
		fillWithToolCalls();
		const handler = makeHandler();
		await handler.getResult();

		const last = response.at(-1);
		expect(last).toBeInstanceOf(ChatResponseConfirmationPart);

		const request = new TestChatRequest();
		request.acceptedConfirmationData = [(last as ChatResponseConfirmationPart).data];
		request.prompt = (last as ChatResponseConfirmationPart).buttons![1];
		const handler2 = makeHandler({ request });
		await handler2.getResult();

		expect(response.at(-1)).toMatchInlineSnapshot(`
			ChatResponseMarkdownPart {
			  "value": MarkdownString {},
			}
		`);
	});
});


function cloneAndChangeWithKey(obj: any, changer: (orig: any, key?: string | number) => any): any {
	return _cloneAndChangeWithKey(obj, changer, new Set(), undefined);
}

function _cloneAndChangeWithKey(obj: any, changer: (orig: any, key?: string | number) => any, seen: Set<any>, key: string | number | undefined): any {
	if (isUndefinedOrNull(obj)) {
		return obj;
	}

	const changed = changer(obj, key);
	if (typeof changed !== 'undefined') {
		return changed;
	}

	if (Array.isArray(obj)) {
		const r1: any[] = [];
		for (const [i, e] of obj.entries()) {
			r1.push(_cloneAndChangeWithKey(e, changer, seen, i));
		}
		return r1;
	}

	if (isObject(obj)) {
		if (seen.has(obj)) {
			throw new Error('Cannot clone recursive data-structure');
		}
		seen.add(obj);
		const r2 = {};
		for (const i2 in obj) {
			if (Object.prototype.hasOwnProperty.call(obj, i2)) {
				(r2 as any)[i2] = _cloneAndChangeWithKey(obj[i2], changer, seen, i2);
			}
		}
		seen.delete(obj);
		return r2;
	}

	return obj;
}
