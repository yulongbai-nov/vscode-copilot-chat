/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITraceData, ITokenizer, Raw, toMode } from '@vscode/prompt-tsx';
import { OptionalChatRequestParams } from '../../../platform/networking/common/fetch';
import { deepClone } from '../../../util/vs/base/common/objects';
import { stringHash } from '../../../util/vs/base/common/hash';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { EditableChatRequest, EditableChatRequestInit, EditableChatRequestMetadata, LiveRequestReplayProjection, LiveRequestReplaySection, LiveRequestSection, LiveRequestSectionKind, LiveRequestTraceSnapshot } from '../common/liveRequestEditorModel';

export const DEFAULT_REPLAY_SECTION_CAP = 30;

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
		chatSessionResource: ctx.chatSessionResource,
		requestOptions: ctx.requestOptions ? deepClone(ctx.requestOptions) : undefined,
		createdAt: Date.now(),
		lastUpdated: Date.now(),
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
		sessionSnapshot: ctx.sessionSnapshot,
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
	const assistantToolCalls = new Map<number, Array<{ id?: string; name?: string; arguments?: string }>>();
	const toolCallsById = new Map<string, { id?: string; name?: string; arguments?: string }>();
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message.role !== Raw.ChatRole.Assistant || !('toolCalls' in message) || !message.toolCalls?.length) {
			continue;
		}
		const entries: Array<{ id?: string; name?: string; arguments?: string }> = [];
		for (const call of message.toolCalls) {
			const entry = {
				id: call.id,
				name: call.function?.name,
				arguments: extractToolArguments(call.function?.arguments)
			};
			entries.push(entry);
			if (call.id) {
				toolCallsById.set(call.id, entry);
			}
		}
		if (entries.length) {
			assistantToolCalls.set(index, entries);
		}
	}

	for (const section of sections) {
		const metadata = section.metadata ?? {};
		if (section.kind === 'assistant') {
			const calls = assistantToolCalls.get(section.sourceMessageIndex);
			if (calls?.length) {
				metadata.toolCalls = calls;
				section.metadata = metadata;
			}
			continue;
		}
		if (section.kind === 'tool' && typeof metadata.toolCallId === 'string') {
			const toolInvocation = toolCallsById.get(metadata.toolCallId);
			if (toolInvocation) {
				metadata.toolInvocation = toolInvocation;
			}
		}
		section.metadata = metadata;
	}
}

export interface BuildReplayProjectionOptions {
	readonly cap?: number;
	readonly requestOptions?: OptionalChatRequestParams;
	readonly trimmed?: boolean;
}

export function buildReplayProjection(sections: LiveRequestSection[], options?: BuildReplayProjectionOptions): LiveRequestReplayProjection | undefined {
	const cap = Math.max(1, options?.cap ?? DEFAULT_REPLAY_SECTION_CAP);
	const requestOptions = options?.requestOptions ? deepClone(options.requestOptions) : undefined;
	const trimmed = options?.trimmed;
	const replaySections: LiveRequestReplaySection[] = [];
	let editedCount = 0;
	let deletedCount = 0;
	let totalSections = 0;

	for (const section of sections) {
		if (section.deleted) {
			deletedCount++;
			continue;
		}
		totalSections++;
		const edited = section.editedContent !== undefined
			|| section.overrideState !== undefined
			|| section.content !== section.originalContent;
		if (edited) {
			editedCount++;
		}
		if (replaySections.length >= cap) {
			continue;
		}
		replaySections.push({
			id: section.id,
			kind: section.kind,
			label: section.label,
			content: section.content,
			message: section.message ? deepClone(section.message) : undefined,
			collapsed: section.collapsed,
			edited,
			sourceMessageIndex: section.sourceMessageIndex,
			tokenCount: section.tokenCount,
			hoverTitle: section.hoverTitle,
			metadata: section.metadata ? { ...section.metadata } : undefined,
		});
	}

	if (!replaySections.length) {
		return undefined;
	}

	return {
		sections: replaySections,
		totalSections,
		overflowCount: Math.max(0, totalSections - replaySections.length),
		editedCount,
		deletedCount,
		trimmed,
		requestOptions,
	};
}

export function computeChatMessagesHash(messages: Raw.ChatMessage[]): number {
	if (!messages.length) {
		return 0;
	}
	try {
		const serialized = JSON.stringify(messages);
		return stringHash(serialized, 0);
	} catch {
		return stringHash(String(messages.length), 0);
	}
}

export function computeReplayProjectionHash(projection: LiveRequestReplayProjection | undefined): number {
	if (!projection) {
		return 0;
	}
	try {
		const serialized = JSON.stringify({
			sections: projection.sections.map(section => ({
				id: section.id,
				kind: section.kind,
				label: section.label,
				content: section.content,
				sourceMessageIndex: section.sourceMessageIndex,
				metadata: section.metadata,
			})),
			totalSections: projection.totalSections,
			overflowCount: projection.overflowCount,
			editedCount: projection.editedCount,
			deletedCount: projection.deletedCount,
			trimmed: projection.trimmed,
			requestOptions: projection.requestOptions,
		});
		return stringHash(serialized, 0);
	} catch {
		return stringHash(String(projection.sections.length), 0);
	}
}

interface TraceMessageDetails {
	raw: Raw.ChatMessage;
	tracePath?: string[];
	tokenCount?: number;
}

export async function buildTraceSnapshotFromHtmlTrace(messages: Raw.ChatMessage[], traceData?: ITraceData): Promise<LiveRequestTraceSnapshot | undefined> {
	if (!traceData?.renderedTree?.container || !traceData.tokenizer) {
		return undefined;
	}
	const tracedMessages = await collectTraceMessages(traceData);
	if (!tracedMessages.length) {
		return undefined;
	}
	const collapsed = await collapseSystemTraceMessages(tracedMessages, traceData.tokenizer);
	if (collapsed.length !== messages.length) {
		return undefined;
	}
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].role !== collapsed[i].raw.role) {
			return undefined;
		}
	}

	const perMessage = collapsed.map(msg => ({
		tokenCount: msg.tokenCount,
		tracePath: msg.tracePath?.length ? msg.tracePath : undefined
	}));
	const totalTokens = collapsed.every(msg => typeof msg.tokenCount === 'number')
		? collapsed.reduce((sum, msg) => sum + (msg.tokenCount ?? 0), 0)
		: undefined;

	return { totalTokens, perMessage };
}

async function collectTraceMessages(traceData: ITraceData): Promise<TraceMessageDetails[]> {
	const result: TraceMessageDetails[] = [];
	const walk = async (node: unknown, path: string[]): Promise<void> => {
		if (!node || typeof node !== 'object') {
			return;
		}
		const name = (node as { name?: unknown }).name;
		const nextPath = appendName(path, name);
		const toChatMessage = (node as { toChatMessage?: unknown }).toChatMessage;
		if (typeof toChatMessage === 'function') {
			const raw = deepClone((toChatMessage as () => Raw.ChatMessage)());
			const tokenCount = await countTokensWithFallback(traceData.tokenizer, raw);
			result.push({ raw, tracePath: nextPath, tokenCount });
			return;
		}
		const children = (node as { children?: unknown }).children;
		if (Array.isArray(children)) {
			for (const child of children) {
				await walk(child, nextPath);
			}
		}
	};
	await walk(traceData.renderedTree.container, []);
	return result;
}

async function collapseSystemTraceMessages(messages: TraceMessageDetails[], tokenizer: ITokenizer): Promise<TraceMessageDetails[]> {
	const collapsed: TraceMessageDetails[] = [];
	for (const message of messages) {
		const previous = collapsed.at(-1);
		if (previous && previous.raw.role === Raw.ChatRole.System && message.raw.role === Raw.ChatRole.System) {
			mergeSystemMessages(previous.raw, message.raw);
			previous.tracePath = mergePaths(previous.tracePath, message.tracePath);
			previous.tokenCount = await countTokensWithFallback(tokenizer, previous.raw);
		} else {
			collapsed.push({
				raw: deepClone(message.raw),
				tracePath: message.tracePath ? [...message.tracePath] : undefined,
				tokenCount: await countTokensWithFallback(tokenizer, message.raw)
			});
		}
	}
	return collapsed;
}

function appendName(path: string[], candidate: unknown): string[] {
	if (typeof candidate === 'string' && candidate.trim().length) {
		return [...path, candidate];
	}
	return path;
}

function mergePaths(first?: string[], second?: string[]): string[] | undefined {
	if (!first?.length) {
		return second?.length ? [...second] : undefined;
	}
	if (!second?.length) {
		return [...first];
	}
	const merged = [...first];
	for (const entry of second) {
		if (!merged.includes(entry)) {
			merged.push(entry);
		}
	}
	return merged;
}

function mergeSystemMessages(target: Raw.ChatMessage, addition: Raw.ChatMessage): void {
	const lastContent = target.content.at(-1);
	const nextContent = addition.content.at(0);
	if (lastContent && nextContent && lastContent.type === Raw.ChatCompletionContentPartKind.Text && nextContent.type === Raw.ChatCompletionContentPartKind.Text) {
		lastContent.text = lastContent.text.trimEnd() + '\n' + nextContent.text;
		target.content = target.content.concat(addition.content.slice(1));
	} else {
		target.content = target.content.concat([{ type: Raw.ChatCompletionContentPartKind.Text, text: '\n' }], addition.content);
	}
}

async function countTokensWithFallback(tokenizer: ITokenizer, message: Raw.ChatMessage): Promise<number | undefined> {
	try {
		return await tokenizer.countMessageTokens(toMode(tokenizer.mode, message));
	} catch {
		try {
			return await tokenizer.countMessageTokens(message as unknown as Parameters<ITokenizer['countMessageTokens']>[0]);
		} catch {
			return undefined;
		}
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

export function renderMessageContent(message: Raw.ChatMessage): string {
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
