/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, test, expect, vi } from 'vitest';
import { LiveRequestEditorService } from '../liveRequestEditorService';
import { IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry';
import { IChatSessionService } from '../../../../platform/chat/common/chatSessionService';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../../platform/log/common/logService';
import { IEndpointProvider } from '../../../../platform/endpoint/common/endpointProvider';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { Raw } from '@vscode/prompt-tsx';
import { LiveRequestSessionKey } from '../../common/liveRequestEditorModel';

const noopConfig = { getConfig: () => true, onDidChangeConfiguration: () => ({ dispose() { } }) } as unknown as IConfigurationService;
const noopTelemetry = {} as ITelemetryService;
const noopChatSession = { onDidDisposeChatSession: () => ({ dispose() { } }) } as unknown as IChatSessionService;
const noopCtx = { workspaceState: { update: async () => undefined, get: () => undefined }, globalState: { update: async () => undefined, get: () => undefined } } as unknown as IVSCodeExtensionContext;
const noopLog = { error: () => { }, debug: () => { }, info: () => { }, warn: () => { } } as unknown as ILogService;
const noopEndpointProvider = {
	getChatEndpoint: async () => ({
		model: 'dummy',
		family: 'gpt-4.1',
		modelMaxPromptTokens: 8192,
		cloneWithTokenOverride: () => ({})
	})
} as unknown as IEndpointProvider;
const noopInstantiationService = { createInstance: () => ({}) } as unknown as IInstantiationService;

function makeRequest(key: LiveRequestSessionKey) {
	const service = new LiveRequestEditorService(
		noopConfig,
		noopTelemetry,
		noopChatSession,
		noopCtx,
		noopLog,
		noopEndpointProvider,
		noopInstantiationService,
	);
	service.prepareRequest({
		sessionId: key.sessionId,
		location: key.location,
		debugName: 'test',
		model: 'dummy',
		renderResult: {
			messages: [{ role: Raw.ChatRole.User, content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'orig' }] }],
			tokenCount: 0,
			references: [],
			metadata: { get: () => undefined, getAll: () => undefined } as any,
			hasIgnoredFiles: false,
			omittedReferences: [],
		},
		requestId: 'req',
		endpointUrl: 'http://example',
	});
	return service;
}

describe('LiveRequestEditorService.regenerateFromSnapshot', () => {
	test('does nothing when no snapshot', async () => {
		const key = { sessionId: 's', location: 1 } as LiveRequestSessionKey;
		const service = makeRequest(key);
		const ok = await service.regenerateFromSnapshot(key, undefined);
		expect(ok).toBe(false);
	});

	test('applies rendered messages when snapshot present', async () => {
		const key = { sessionId: 's', location: 1 } as LiveRequestSessionKey;
		const service = makeRequest(key);
		const req = service.getRequest(key)!;
		req.sessionSnapshot = {
			promptContext: { requestId: 'req', query: 'q', history: [], chatVariables: {} } as any,
			endpointModel: 'dummy',
		};
		// Spy on renderFromSnapshot
		const rendered: Raw.ChatMessage[] = [{ role: Raw.ChatRole.User, content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'new' }] }];
		// @ts-expect-error private
		service.renderFromSnapshot = vi.fn().mockResolvedValue(rendered);
		const ok = await service.regenerateFromSnapshot(key, undefined);
		expect(ok).toBe(true);
		expect(service.getRequest(key)!.messages[0].content[0]).toMatchObject({ text: 'new' });
	});
});
