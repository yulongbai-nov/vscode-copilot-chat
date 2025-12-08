/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITokenizer, ITraceData, OutputMode, Raw } from '@vscode/prompt-tsx';
import { describe, expect, test } from 'vitest';
import { LiveRequestSection, LiveRequestSectionKind } from '../../common/liveRequestEditorModel';
import { buildReplayProjection, buildTraceSnapshotFromHtmlTrace, computeChatMessagesHash, computeReplayProjectionHash } from '../liveRequestBuilder';

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

describe('buildReplayProjection', () => {
	test('captures edits, deletions, and respects cap', () => {
		const system = createMessage(Raw.ChatRole.System, 'sys');
		const user = createMessage(Raw.ChatRole.User, 'first');
		const assistant = createMessage(Raw.ChatRole.Assistant, 'second');
		const sections = buildSections([system, user, assistant]);
		sections[0].editedContent = 'sys edited';
		sections[0].content = 'sys edited';
		sections[1].editedContent = 'first edited';
		sections[1].content = 'first edited';
		sections[2].deleted = true;

		const projection = buildReplayProjection(sections, { cap: 1, requestOptions: { temperature: 0.2 }, trimmed: true })!;
		expect(projection.sections).toHaveLength(1);
		expect(projection.sections[0].edited).toBe(true);
		expect(projection.totalSections).toBe(2);
		expect(projection.overflowCount).toBe(1);
		expect(projection.editedCount).toBe(2);
		expect(projection.deletedCount).toBe(1);
		expect(projection.trimmed).toBe(true);
		expect(projection.requestOptions?.temperature).toBe(0.2);
	});

	test('returns undefined when all sections deleted', () => {
		const sections = buildSections([createMessage(Raw.ChatRole.User, 'only')]);
		sections[0].deleted = true;
		const projection = buildReplayProjection(sections);
		expect(projection).toBeUndefined();
	});

	test('hash helpers produce stable values', () => {
		const sections = buildSections([createMessage(Raw.ChatRole.User, 'hash')]);
		const projection = buildReplayProjection(sections)!;
		const projectionHash = computeReplayProjectionHash(projection);
		expect(typeof projectionHash).toBe('number');
		const payloadHash = computeChatMessagesHash([sections[0].message!]);
		expect(typeof payloadHash).toBe('number');
	});
});

function buildSections(messages: Raw.ChatMessage[]): LiveRequestSection[] {
	return messages.map((message, index) => ({
		id: `id-${index}`,
		kind: inferKind(message),
		label: `label-${index}`,
		message: { ...message, content: [...message.content] },
		content: (message.content[0] as Raw.ChatCompletionContentPartText).text,
		originalContent: (message.content[0] as Raw.ChatCompletionContentPartText).text,
		collapsed: false,
		editable: true,
		deletable: true,
		sourceMessageIndex: index,
	}));
}

function inferKind(message: Raw.ChatMessage): LiveRequestSectionKind {
	if (message.role === Raw.ChatRole.System) {
		return 'system';
	}
	if (message.role === Raw.ChatRole.Assistant) {
		return 'assistant';
	}
	if (message.role === Raw.ChatRole.Tool) {
		return 'tool';
	}
	return 'user';
}
