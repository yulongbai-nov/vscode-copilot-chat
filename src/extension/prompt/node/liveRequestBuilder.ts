/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { OptionalChatRequestParams } from '../../../platform/networking/common/fetch';
import { deepClone } from '../../../util/vs/base/common/objects';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { EditableChatRequest, EditableChatRequestInit, EditableChatRequestMetadata, LiveRequestSection, LiveRequestSectionKind } from '../common/liveRequestEditorModel';

export function buildEditableChatRequest(ctx: EditableChatRequestInit): EditableChatRequest {
	const clonedMessages = ctx.renderResult.messages.map(message => deepClone(message));
	const originalMessages = deepClone(clonedMessages);
	const sections = createSectionsFromMessages(clonedMessages);
	const metadata: EditableChatRequestMetadata = {
		requestId: ctx.requestId,
		tokenCount: ctx.renderResult.tokenCount,
		maxResponseTokens: extractResponseTokenLimit(ctx.requestOptions),
		intentId: ctx.intentId,
		endpointUrl: ctx.endpointUrl,
		modelFamily: ctx.modelFamily,
		requestOptions: ctx.requestOptions ? deepClone(ctx.requestOptions) : undefined,
		createdAt: Date.now(),
	};

	return {
		id: generateUuid(),
		sessionId: ctx.sessionId,
		location: ctx.location,
		debugName: ctx.debugName,
		model: ctx.model,
		messages: clonedMessages,
		sections,
		originalMessages,
		metadata,
		isDirty: false,
	};
}

export function createSectionsFromMessages(messages: Raw.ChatMessage[]): LiveRequestSection[] {
	return messages.map((message, index) => createSection(message, index));
}

function createSection(message: Raw.ChatMessage, index: number): LiveRequestSection {
	const kind = inferKind(message);
	const label = buildLabel(kind, message, index);
	const content = renderMessageContent(message);
	const editable = kind !== 'system' && kind !== 'metadata';
	const deletable = kind !== 'system' && kind !== 'metadata';

	const metadata: Record<string, unknown> = {};
	if ('name' in message && message.name) {
		metadata.name = message.name;
	}
	if ('toolCallId' in message && message.toolCallId) {
		metadata.toolCallId = message.toolCallId;
	}
	if ('toolCalls' in message && message.toolCalls?.length) {
		metadata.toolCalls = message.toolCalls.map(call => ({ id: call.id, name: call.function.name }));
	}

	return {
		id: `${kind}-${index}`,
		kind,
		label,
		message,
		content,
		collapsed: kind === 'history',
		editable,
		deletable,
		sourceMessageIndex: index,
		metadata,
	};
}

function inferKind(message: Raw.ChatMessage): LiveRequestSectionKind {
	switch (message.role) {
		case Raw.ChatRole.System:
			return 'system';
		case Raw.ChatRole.Assistant:
			return 'assistant';
		case Raw.ChatRole.Tool:
			return 'tool';
		case Raw.ChatRole.User: {
			const name = 'name' in message ? message.name?.toLowerCase() : undefined;
			if (name?.includes('history')) {
				return 'history';
			}
			if (name?.includes('context')) {
				return 'context';
			}
			if (name?.includes('prediction')) {
				return 'prediction';
			}
			return 'user';
		}
		default:
			return 'other';
	}
}

function buildLabel(kind: LiveRequestSectionKind, message: Raw.ChatMessage, index: number): string {
	const baseLabel = capitalizeFirstLetter(kind);
	if ('name' in message && message.name) {
		return `${baseLabel}: ${message.name}`;
	}
	return `${baseLabel} #${index + 1}`;
}

function renderMessageContent(message: Raw.ChatMessage): string {
	const parts = message.content.map(part => {
		if (part.type === Raw.ChatCompletionContentPartKind.Text) {
			return part.text;
		}
		if (part.type === Raw.ChatCompletionContentPartKind.Image) {
			return part.imageUrl
				? `![image](${part.imageUrl.url})`
				: '![image](about:blank)';
		}

		const fallbackText = (part as { text?: string }).text;
		return fallbackText ?? `\`[${part.type} content]\``;
	});
	return parts.join('\n\n').trim();
}

function extractResponseTokenLimit(options?: OptionalChatRequestParams): number | undefined {
	if (!options) {
		return undefined;
	}
	const extended = options as Partial<{ max_output_tokens: number; max_completion_tokens: number }>;
	return options.max_tokens ?? extended.max_output_tokens ?? extended.max_completion_tokens;
}

function capitalizeFirstLetter(value: string): string {
	if (!value.length) {
		return value;
	}
	return value.charAt(0).toUpperCase() + value.slice(1);
}
