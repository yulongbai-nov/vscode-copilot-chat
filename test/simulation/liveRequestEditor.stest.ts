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

	const createService = async (): Promise<{ service: LiveRequestEditorService; telemetry: SpyingTelemetryService }> => {
		const defaults = new DefaultsOnlyConfigurationService();
		const config = new InMemoryConfigurationService(defaults);
		await config.setConfig(ConfigKey.Advanced.LivePromptEditorEnabled, true);
		await config.setConfig(ConfigKey.Advanced.LivePromptEditorInterception, true);
		const telemetry = new SpyingTelemetryService();
		const service = new LiveRequestEditorService(config, telemetry, new (class {
			public readonly _serviceBrand: undefined;
			private readonly _onDidDispose = new Emitter<string>();
			public readonly onDidDisposeChatSession = this._onDidDispose.event;
		})(), new MockExtensionContext() as any);
		return { service, telemetry };
	};

	stest({ description: 'edits apply to send result' }, async (_services: TestingServiceCollection) => {
		const { service } = await createService();

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

		const send = service.getMessagesForSend(key, renderResult.messages);
		if (send.error) {
			throw new LiveRequestEditorValidationError(send.error);
		}

		const messages = send.messages!;
		assert.strictEqual(getText(messages[0].content[0]), 'system prompt');
		assert.strictEqual(getText(messages[1].content[0]), 'edited user');
	});

	stest({ description: 'delete all blocks send with validation' }, async (_services: TestingServiceCollection) => {
		const { service } = await createService();
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

		const send = service.getMessagesForSend(key, renderResult.messages);
		assert.ok(send.error?.code === 'empty');
	});

	stest({ description: 'parity mismatch emits telemetry and snapshot flags' }, async (_services: TestingServiceCollection) => {
		const { service, telemetry } = await createService();
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
		const mutated: Raw.ChatMessage[] = request.messages.map((message, index) => {
			if (index === 1) {
				return {
					...message,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'mutated' }] as Raw.ChatCompletionContentPart[]
				} as Raw.ChatMessage;
			}
			return { ...message };
		});

		service.recordLoggedRequest(key, mutated);
		const snapshot = service.getMetadataSnapshot(key)!;
		assert.strictEqual(snapshot.parityStatus, 'mismatch');
		assert.ok(typeof snapshot.payloadHash === 'number');
		assert.ok(typeof snapshot.lastLoggedHash === 'number');

		const events = telemetry.getEvents().telemetryServiceEvents;
		const mismatch = events.find(evt => evt.eventName === 'liveRequestEditor.requestParityMismatch');
		assert.ok(mismatch, 'expected telemetry for parity mismatch');
	});

	stest({ description: 'payload hash and version bump on edits' }, async (_services: TestingServiceCollection) => {
		const { service } = await createService();
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

		const initial = service.getRequest(key)!;
		const initialHash = initial.metadata.payloadHash;
		const initialVersion = initial.metadata.version;
		const second = initial.sections[1];
		service.updateSectionContent(key, second.id, 'edited user');
		const updated = service.getRequest(key)!;
		assert.ok((updated.metadata.payloadHash ?? 0) !== (initialHash ?? -1));
		assert.strictEqual(updated.metadata.version, (initialVersion ?? 1) + 1);
	});
});
