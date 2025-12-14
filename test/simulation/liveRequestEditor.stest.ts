/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { Raw, RenderPromptResult } from '@vscode/prompt-tsx';
import { LiveRequestEditorService } from '../../src/extension/prompt/node/liveRequestEditorService';
import { LiveRequestEditorValidationError } from '../../src/extension/prompt/common/liveRequestEditorModel';
import { ChatLocation } from '../../src/platform/chat/common/commonTypes';
import { ConfigKey } from '../../src/platform/configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../src/platform/configuration/common/defaultsOnlyConfigurationService';
import { InMemoryConfigurationService } from '../../src/platform/configuration/test/common/inMemoryConfigurationService';
import { MockExtensionContext } from '../../src/platform/test/node/extensionContext';
import { SpyingTelemetryService } from '../../src/platform/telemetry/node/spyingTelemetryService';
import { IEndpointProvider } from '../../src/platform/endpoint/common/endpointProvider';
import { IInstantiationService } from '../../src/util/vs/platform/instantiation/common/instantiation';
import { Emitter } from '../../src/util/vs/base/common/event';
import { TestingServiceCollection } from '../../src/platform/test/node/services';
import { ssuite, stest } from '../base/stest';

ssuite({ title: 'Live Request Editor', location: 'context' }, () => {
	const sessionId = 'sim-session';
	const requestId = 'sim-request';

	const createRenderResult = (messages: string[], includeSystem: boolean = true): RenderPromptResult => ({
		hasIgnoredFiles: false,
		tokenCount: messages.length * 10,
		messages: messages.map((text, idx) => ({
			role: includeSystem && idx === 0 ? Raw.ChatRole.System : Raw.ChatRole.User,
			content: [{ type: Raw.ChatCompletionContentPartKind.Text, text }]
		})),
		metadata: {
			get: () => undefined,
			getAll: () => []
		},
		references: [],
		omittedReferences: [],
	});

	const getText = (part: Raw.ChatCompletionContentPart): string | undefined => {
		return part.type === Raw.ChatCompletionContentPartKind.Text ? part.text : undefined;
	};

	const createService = async (): Promise<LiveRequestEditorService> => {
		const defaults = new DefaultsOnlyConfigurationService();
		const config = new InMemoryConfigurationService(defaults);
		await config.setConfig(ConfigKey.Advanced.LivePromptEditorEnabled, true);
		await config.setConfig(ConfigKey.Advanced.LivePromptEditorInterception, true);
		const log = { _serviceBrand: undefined, trace() { }, debug() { }, info() { }, warn() { }, error() { }, show() { } };
		const endpointProvider = {
			getChatEndpoint: async () => ({
				model: 'gpt-sim',
				family: 'gpt-4.1',
				modelMaxPromptTokens: 8192,
				urlOrRequestMetadata: undefined,
				acquireTokenizer: async () => ({ countMessagesTokens: async () => 0 }),
			}),
			getAllChatEndpoints: async () => [],
			getAllCompletionModels: async () => [],
			getEmbeddingsEndpoint: async () => ({}),
		} as unknown as IEndpointProvider;
		const instantiationService = { createInstance: () => ({}) } as unknown as IInstantiationService;
		return new LiveRequestEditorService(config, new SpyingTelemetryService(), new (class {
			public readonly _serviceBrand: undefined;
			private readonly _onDidDispose = new Emitter<string>();
			public readonly onDidDisposeChatSession = this._onDidDispose.event;
		})(), new MockExtensionContext() as any, log, endpointProvider, instantiationService);
	};

	stest({ description: 'edits apply to send result' }, async (_services: TestingServiceCollection) => {
		const service = await createService();

		const renderResult = createRenderResult(['system prompt', 'user prompt']);
		const key = { sessionId, location: ChatLocation.Panel };
		service.prepareRequest({
			sessionId,
			location: ChatLocation.Panel,
			debugName: 'sim-debug',
			model: 'gpt-sim',
			renderResult,
			requestId,
		});

		const request = service.getRequest(key)!;
		service.updateSectionContent(key, request.sections[1].id, 'edited user');

		const send = await service.getMessagesForSend(key, renderResult.messages);
		if (send.error) {
			throw new LiveRequestEditorValidationError(send.error);
		}

		const messages = send.messages!;
		assert.strictEqual(getText(messages[0].content[0]), 'system prompt');
		assert.strictEqual(getText(messages[1].content[0]), 'edited user');
	});

	stest({ description: 'delete all blocks send with validation' }, async (_services: TestingServiceCollection) => {
		const service = await createService();
		const renderResult = createRenderResult(['user prompt'], false);
		const key = { sessionId, location: ChatLocation.Panel };
		service.prepareRequest({
			sessionId,
			location: ChatLocation.Panel,
			debugName: 'sim-debug',
			model: 'gpt-sim',
			renderResult,
			requestId,
		});

		const request = service.getRequest(key)!;
		for (const section of request.sections) {
			service.deleteSection(key, section.id);
		}

		const send = await service.getMessagesForSend(key, renderResult.messages);
		assert.ok(send.error?.code === 'empty');
	});
});
