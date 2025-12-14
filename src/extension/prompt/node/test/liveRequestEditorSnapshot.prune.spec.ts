/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, test, expect } from 'vitest';
import { LiveRequestEditorService } from '../liveRequestEditorService';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { IChatSessionService } from '../../../platform/chat/common/chatSessionService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IBuildPromptContext } from '../common/intents';

// Simple stubs to satisfy the constructor; methods are unused in the pruner test.
const noopConfig = { getConfig: () => false, onDidChangeConfiguration: () => ({ dispose() { } }) } as unknown as IConfigurationService;
const noopTelemetry = {} as ITelemetryService;
const noopChatSession = { onDidDisposeChatSession: () => ({ dispose() { } }) } as unknown as IChatSessionService;
const noopCtx = { workspaceState: { update: async () => undefined, get: () => undefined }, globalState: { update: async () => undefined, get: () => undefined } } as unknown as IVSCodeExtensionContext;
const noopLog = { error: () => { }, debug: () => { }, info: () => { }, warn: () => { } } as unknown as ILogService;
const noopEndpointProvider = {} as IEndpointProvider;
const noopInstantiationService = {} as IInstantiationService;

describe('LiveRequestEditorService.prunePromptContext', () => {
	test('prunes non-serializable fields and keeps primitives', () => {
		const service = new LiveRequestEditorService(
			noopConfig,
			noopTelemetry,
			noopChatSession,
			noopCtx,
			noopLog,
			noopEndpointProvider,
			noopInstantiationService,
		);

		const context: IBuildPromptContext = {
			requestId: 'req-123',
			query: 'hello',
			history: [{ id: 'turn1' }, { id: 'turn2' }],
			chatVariables: { foo: 'bar' } as any,
			workingSet: undefined,
			tools: { toolReferences: [], toolInvocationToken: {} as any, availableTools: [] },
			toolCallRounds: [{ id: 'round1', toolCalls: [] }] as any,
			toolCallResults: { abc: { content: 'result' } as any },
			toolGrouping: undefined,
			editedFileEvents: undefined,
			conversation: {} as any,
			request: {} as any,
			stream: {} as any,
			isContinuation: true,
		};

		const snapshot = service.prunePromptContext(context);
		expect(snapshot.requestId).toBe('req-123');
		expect(snapshot.query).toBe('hello');
		expect(snapshot.history).toEqual([{ id: 'turn1' }, { id: 'turn2' }]);
		expect(snapshot.chatVariables).toEqual({ foo: 'bar' });
		// Ensure host-bound fields are not serialized
		// @ts-expect-error
		expect(snapshot.conversation).toBeUndefined();
		// @ts-expect-error
		expect(snapshot.request).toBeUndefined();
		// @ts-expect-error
		expect(snapshot.stream).toBeUndefined();
	});
});
