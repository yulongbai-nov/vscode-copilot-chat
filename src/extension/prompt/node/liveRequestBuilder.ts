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
	const sections = createSectionsFromMessages(clonedMessages, ctx.tokenCounts?.perMessage);
	const metadata: EditableChatRequestMetadata = {
		requestId: ctx.requestId,
		tokenCount: ctx.tokenCounts?.total ?? ctx.renderResult.tokenCount,
		maxPromptTokens: ctx.maxPromptTokens,
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
		isSubagent: ctx.isSubagent,
		messages: clonedMessages,
		sections,
		originalMessages,
		metadata,
		isDirty: false,
	};
}

export function createSectionsFromMessages(messages: Raw.ChatMessage[], tokenCounts?: number[]): LiveRequestSection[] {
	const sections = messages.map((message, index) => createSection(message, index, tokenCounts?.[index]));
	annotateToolSections(messages, sections);
	return sections;
}

function createSection(message: Raw.ChatMessage, index: number, tokenCount?: number): LiveRequestSection {
	const kind = inferKind(message);
	const label = buildLabel(kind, message, index);
	const content = renderMessageContent(message);
	const editable = kind !== 'metadata';
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
		originalContent: content,
		collapsed: kind === 'history',
		editable,
		deletable,
		sourceMessageIndex: index,
		metadata,
		tokenCount,
	};
}

function annotateToolSections(messages: Raw.ChatMessage[], sections: LiveRequestSection[]): void {
	const toolCallMap = new Map<string, { id: string; name?: string; args?: string }>();
	for (const message of messages) {
		if (message.role === Raw.ChatRole.Assistant && 'toolCalls' in message && message.toolCalls?.length) {
			for (const call of message.toolCalls) {
				const name = call.function?.name;
				const args = extractToolArguments(call.function?.arguments);
				toolCallMap.set(call.id, { id: call.id, name, args });
			}
		}
	}

	for (const section of sections) {
		if (section.kind !== 'tool') {
			continue;
		}
		const metadata = section.metadata ?? {};
		const toolCallId = typeof metadata.toolCallId === 'string' ? metadata.toolCallId : undefined;
		const lookup = toolCallId ? toolCallMap.get(toolCallId) : undefined;
		if (!lookup && !metadata.name) {
			continue;
		}
		metadata.toolInvocation = {
			id: lookup?.id ?? toolCallId,
			name: lookup?.name ?? (typeof metadata.name === 'string' ? metadata.name : undefined),
			arguments: lookup?.args
		};
		section.metadata = metadata;
	}
}

function extractToolArguments(raw: unknown): string | undefined {
	if (raw === undefined || raw === null) {
		return undefined;
	}
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (!trimmed.length) {
			return undefined;
		}
		try {
			return JSON.stringify(JSON.parse(trimmed), null, 2);
		} catch {
			return trimmed;
		}
	}
	if (typeof raw === 'object') {
		try {
			return JSON.stringify(raw, null, 2);
		} catch {
			return JSON.stringify(raw);
		}
	}
	return String(raw);
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
		const kind = part.type;
		switch (kind) {
			case Raw.ChatCompletionContentPartKind.Text:
				return part.text;
			case Raw.ChatCompletionContentPartKind.Image:
				return part.imageUrl
					? `![image](${part.imageUrl.url})`
					: '![image](about:blank)';
			case Raw.ChatCompletionContentPartKind.CacheBreakpoint:
				return formatCacheBreakpoint(part);
			case Raw.ChatCompletionContentPartKind.Opaque:
				return formatOpaquePart(part);
			default: {
				const fallbackText = (part as { text?: string }).text;
				return fallbackText ?? `\`[${describePartType(kind)} content]\``;
			}
		}
	});
	return parts.join('\n\n').trim();
}

function formatCacheBreakpoint(part: Raw.ChatCompletionContentPartCacheBreakpoint): string {
	const typeAttr = part.cacheType ? ` type="${escapeAttribute(part.cacheType)}"` : '';
	return `<cacheBreakpoint${typeAttr} />`;
}

function formatOpaquePart(part: Raw.ChatCompletionContentPartOpaque): string {
	const value = part.value;
	if (value === null || value === undefined) {
		return '<opaquePart />';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return `<opaquePart value="${escapeAttribute(String(value))}" />`;
	}
	if (Array.isArray(value)) {
		return `<opaquePart items="${escapeAttribute(value.length.toString())}" />`;
	}
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const type = pickStringField(record, ['type', 'kind', 'category']);
		const id = pickStringField(record, ['id', 'referenceId', 'attachmentId']);
		const label = pickStringField(record, ['label', 'name', 'title']);
		const attributes: string[] = [];
		if (type) {
			attributes.push(`type="${escapeAttribute(type)}"`);
		}
		if (id) {
			attributes.push(`id="${escapeAttribute(id)}"`);
		}
		if (label) {
			attributes.push(`label="${escapeAttribute(label)}"`);
		}
		if (attributes.length > 0) {
			return `<opaquePart ${attributes.join(' ')} />`;
		}
		const preview = JSON.stringify(value);
		const truncated = preview.length > 160 ? `${preview.slice(0, 160)}…` : preview;
		return `\`[opaque ${truncated}]\``;
	}
	return `<opaquePart value="${escapeAttribute(String(value))}" />`;
}

function pickStringField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const candidate = record[key];
		if (typeof candidate === 'string' && candidate.length) {
			return candidate;
		}
	}
	return undefined;
}

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;');
}

function describePartType(type: number): string {
	switch (type) {
		case Raw.ChatCompletionContentPartKind.Text:
			return 'text';
		case Raw.ChatCompletionContentPartKind.Image:
			return 'image';
		case Raw.ChatCompletionContentPartKind.Opaque:
			return 'opaque';
		case Raw.ChatCompletionContentPartKind.CacheBreakpoint:
			return 'cacheBreakpoint';
		default:
			return 'unknown';
	}
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
