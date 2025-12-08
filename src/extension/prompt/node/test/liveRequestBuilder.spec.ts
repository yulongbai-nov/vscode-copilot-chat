/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITokenizer, ITraceData, OutputMode, Raw } from '@vscode/prompt-tsx';
import { describe, expect, test } from 'vitest';
import { buildTraceSnapshotFromHtmlTrace } from '../liveRequestBuilder';

function createMessage(role: Raw.ChatRole, text: string): Raw.ChatMessage {
	const base: Raw.ChatMessage = {
		role,
		content: [{
			type: Raw.ChatCompletionContentPartKind.Text,
			text
		}],
		toolCallId: role === Raw.ChatRole.Tool ? 'call' : ''
	};
	return base;
}

function createTraceMessage(name: string, role: Raw.ChatRole, text: string) {
	return {
		name,
		children: [] as unknown[],
		toChatMessage: () => createMessage(role, text)
	};
}

const tokenizer: ITokenizer = {
	mode: OutputMode.Raw,
	async countMessageTokens(message: any) {
		const content = Array.isArray(message?.content) ? message.content : [];
		return content.reduce((sum: number, part: any) => sum + (typeof part?.text === 'string' ? part.text.length : 0), 0);
	},
	async tokenLength(part: any) {
		return typeof part?.text === 'string' ? part.text.length : 1;
	}
};

const renderTree = (container: unknown) => ({ budget: 100, container: container as any, removed: 0 });

describe('buildTraceSnapshotFromHtmlTrace', () => {
	test('merges system messages and returns token counts', async () => {
		const systemA = createTraceMessage('sysA', Raw.ChatRole.System, 'alpha');
		const systemB = createTraceMessage('sysB', Raw.ChatRole.System, 'beta');
		const user = createTraceMessage('user', Raw.ChatRole.User, 'hi');
		const container = { name: 'root', children: [systemA, systemB, user] };
		const traceData: ITraceData = {
			budget: 100,
			renderedTree: renderTree(container),
			tokenizer,
			renderTree: async () => renderTree(container)
		};

		const snapshot = await buildTraceSnapshotFromHtmlTrace([
			createMessage(Raw.ChatRole.System, 'alpha\nbeta'),
			createMessage(Raw.ChatRole.User, 'hi')
		], traceData);

		expect(snapshot?.totalTokens).toBe(12);
		expect(snapshot?.perMessage.map(entry => entry.tokenCount)).toEqual([10, 2]);
		expect(snapshot?.perMessage[0].tracePath).toEqual(['root', 'sysA', 'sysB']);
		expect(snapshot?.perMessage[1].tracePath).toEqual(['root', 'user']);
	});

	test('returns undefined when trace data cannot align', async () => {
		const system = createTraceMessage('sys', Raw.ChatRole.System, 'alpha');
		const container = { name: 'root', children: [system] };
		const traceData: ITraceData = {
			budget: 100,
			renderedTree: renderTree(container),
			tokenizer,
			renderTree: async () => renderTree(container)
		};

		const snapshot = await buildTraceSnapshotFromHtmlTrace([
			createMessage(Raw.ChatRole.System, 'alpha'),
			createMessage(Raw.ChatRole.User, 'extra')
		], traceData);

		expect(snapshot).toBeUndefined();
	});
});
