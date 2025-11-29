/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw, RenderPromptResult } from '@vscode/prompt-tsx';
import { describe, expect, test } from 'vitest';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { ConfigKey } from '../../../../platform/configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../../../platform/configuration/common/defaultsOnlyConfigurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { SpyingTelemetryService } from '../../../../platform/telemetry/node/spyingTelemetryService';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
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

async function createService() {
	const defaults = new DefaultsOnlyConfigurationService();
	const config = new InMemoryConfigurationService(defaults);
	await config.setConfig(ConfigKey.Advanced.LivePromptEditorEnabled, true);
	await config.setConfig(ConfigKey.Advanced.LivePromptEditorInterception, true);
	const telemetry = new SpyingTelemetryService();
	const service = new LiveRequestEditorService(config, telemetry);
	return { service, telemetry };
}

describe('LiveRequestEditorService interception', () => {
	test('resolves resume with edited messages', async () => {
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

		const request = service.getRequest(key)!;
		const firstSection = request.sections[0];
		service.updateSectionContent(key, firstSection.id, 'edited');
		const editedMessages = service.getMessagesForSend(key, request.originalMessages);
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
});
