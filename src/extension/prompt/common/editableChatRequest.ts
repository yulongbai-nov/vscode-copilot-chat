/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw, RenderPromptResult } from '@vscode/prompt-tsx';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { getTextPart, toTextParts } from '../../../platform/chat/common/globalStringUtils';
import { Event, Emitter } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../../util/vs/base/common/uuid';

/**
 * Enumeration of section kinds for the Live Request Editor.
 * Each kind corresponds to a logical segment of the prompt.
 */
export const enum LiveRequestSectionKind {
	System = 'system',
	User = 'user',
	Assistant = 'assistant',
	Context = 'context',
	Tool = 'tool',
	History = 'history',
	Prediction = 'prediction',
	Other = 'other',
}

/**
 * Represents a single section of the editable chat request.
 * Sections are projections used for visualization and editing in the Prompt Inspector UI.
 */
export interface LiveRequestSection {
	/**
	 * Unique identifier for this section.
	 */
	readonly id: string;

	/**
	 * The kind of section (system, user, assistant, context, tool, history, prediction, other).
	 */
	readonly kind: LiveRequestSectionKind;

	/**
	 * Human-readable label for the section (e.g., "System", "User", "Context: file.ts").
	 */
	readonly label: string;

	/**
	 * The content of the section as a string.
	 * This is the raw text content that can be edited.
	 */
	content: string;

	/**
	 * Estimated token count for this section.
	 */
	tokenCount?: number;

	/**
	 * Whether this section is collapsed in the UI.
	 */
	collapsed: boolean;

	/**
	 * Whether this section can be edited.
	 */
	readonly editable: boolean;

	/**
	 * Whether this section can be deleted.
	 */
	readonly deletable: boolean;

	/**
	 * Whether this section has been deleted by the user.
	 */
	deleted: boolean;

	/**
	 * Index of the corresponding message in the Raw.ChatMessage[] array.
	 * Used to map section edits back to the underlying message structure.
	 */
	readonly sourceMessageIndex: number;

	/**
	 * The original content before any edits, used for reset functionality.
	 */
	readonly originalContent: string;
}

/**
 * Metadata about the editable chat request.
 */
export interface EditableChatRequestMetadata {
	/**
	 * Maximum tokens allowed in the prompt.
	 */
	maxPromptTokens?: number;

	/**
	 * Maximum tokens allowed in the response.
	 */
	maxResponseTokens?: number;

	/**
	 * The detected intent for this request.
	 */
	intent?: string;

	/**
	 * The endpoint URL for the request.
	 */
	endpointUrl?: string;
}

/**
 * Represents an editable chat request model.
 * This is the primary data structure used by the Live Chat Request Editor.
 * 
 * The `messages` array is the authoritative source of truth for what will be sent
 * to the LLM via ChatMLFetcher. The `sections` array is a projection used for
 * visualization and editing in the UI.
 */
export class EditableChatRequest extends Disposable {
	/**
	 * Unique identifier for this editable request.
	 */
	readonly id: string;

	/**
	 * Debug name for this request (used in logging).
	 */
	readonly debugName: string;

	/**
	 * The model being used for this request.
	 */
	readonly model: string;

	/**
	 * The location where this chat request originated.
	 */
	readonly location: ChatLocation;

	/**
	 * The session ID of the conversation this request belongs to.
	 */
	readonly sessionId: string;

	/**
	 * The current messages array that will be sent to the LLM.
	 * This is the authoritative source of truth.
	 */
	private _messages: Raw.ChatMessage[];

	/**
	 * The projected sections for UI visualization and editing.
	 */
	private _sections: LiveRequestSection[];

	/**
	 * The original messages before any edits, for reset functionality.
	 */
	private readonly _originalMessages: readonly Raw.ChatMessage[];

	/**
	 * Request metadata (tokens, intent, etc.).
	 */
	readonly metadata: EditableChatRequestMetadata;

	/**
	 * Whether the request has been modified from its original state.
	 */
	private _isDirty = false;

	private readonly _onDidChange = this._register(new Emitter<void>());
	/**
	 * Event fired when the request content changes.
	 */
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidChangeSection = this._register(new Emitter<LiveRequestSection>());
	/**
	 * Event fired when a specific section changes.
	 */
	readonly onDidChangeSection: Event<LiveRequestSection> = this._onDidChangeSection.event;

	constructor(
		debugName: string,
		model: string,
		location: ChatLocation,
		sessionId: string,
		messages: Raw.ChatMessage[],
		sections: LiveRequestSection[],
		metadata: EditableChatRequestMetadata = {},
	) {
		super();
		this.id = generateUuid();
		this.debugName = debugName;
		this.model = model;
		this.location = location;
		this.sessionId = sessionId;
		this._messages = [...messages];
		this._originalMessages = messages.map(m => structuredClone(m));
		this._sections = sections;
		this.metadata = metadata;
	}

	/**
	 * Gets the current messages array (authoritative source of truth).
	 */
	get messages(): readonly Raw.ChatMessage[] {
		return this._messages;
	}

	/**
	 * Gets the sections for UI visualization.
	 */
	get sections(): readonly LiveRequestSection[] {
		return this._sections;
	}

	/**
	 * Gets the original messages before any edits.
	 */
	get originalMessages(): readonly Raw.ChatMessage[] {
		return this._originalMessages;
	}

	/**
	 * Whether the request has been modified from its original state.
	 */
	get isDirty(): boolean {
		return this._isDirty;
	}

	/**
	 * Gets only the active (non-deleted) messages for sending to the LLM.
	 * Returns all original messages only if no sections have been set up.
	 * If all sections are deleted, returns an empty array.
	 */
	getActiveMessages(): Raw.ChatMessage[] {
		// If no sections exist, return all messages as-is
		if (this._sections.length === 0) {
			return [...this._messages];
		}

		const activeMessages: Raw.ChatMessage[] = [];
		for (const section of this._sections) {
			if (!section.deleted && section.sourceMessageIndex >= 0 && section.sourceMessageIndex < this._messages.length) {
				activeMessages.push(this._messages[section.sourceMessageIndex]);
			}
		}
		return activeMessages;
	}

	/**
	 * Updates the content of a section and syncs changes to the underlying messages.
	 * @param sectionId The ID of the section to update
	 * @param newContent The new content for the section
	 */
	updateSectionContent(sectionId: string, newContent: string): void {
		const section = this._sections.find(s => s.id === sectionId);
		if (!section || !section.editable) {
			return;
		}

		section.content = newContent;
		this._syncSectionToMessage(section);
		this._isDirty = true;
		this._onDidChangeSection.fire(section);
		this._onDidChange.fire();
	}

	/**
	 * Marks a section as deleted.
	 * @param sectionId The ID of the section to delete
	 */
	deleteSection(sectionId: string): void {
		const section = this._sections.find(s => s.id === sectionId);
		if (!section || !section.deletable) {
			return;
		}

		section.deleted = true;
		this._isDirty = true;
		this._onDidChangeSection.fire(section);
		this._onDidChange.fire();
	}

	/**
	 * Restores a deleted section.
	 * @param sectionId The ID of the section to restore
	 */
	restoreSection(sectionId: string): void {
		const section = this._sections.find(s => s.id === sectionId);
		if (!section || !section.deleted) {
			return;
		}

		section.deleted = false;
		this._isDirty = this._checkIfDirty();
		this._onDidChangeSection.fire(section);
		this._onDidChange.fire();
	}

	/**
	 * Toggles the collapsed state of a section.
	 * @param sectionId The ID of the section to toggle
	 */
	toggleSectionCollapsed(sectionId: string): void {
		const section = this._sections.find(s => s.id === sectionId);
		if (!section) {
			return;
		}

		section.collapsed = !section.collapsed;
		this._onDidChangeSection.fire(section);
	}

	/**
	 * Resets the entire request to its original state.
	 */
	reset(): void {
		this._messages = this._originalMessages.map(m => structuredClone(m));
		for (const section of this._sections) {
			section.content = section.originalContent;
			section.deleted = false;
			section.collapsed = false;
		}
		this._isDirty = false;
		this._onDidChange.fire();
	}

	/**
	 * Resets a single section to its original content.
	 * @param sectionId The ID of the section to reset
	 */
	resetSection(sectionId: string): void {
		const section = this._sections.find(s => s.id === sectionId);
		if (!section) {
			return;
		}

		section.content = section.originalContent;
		section.deleted = false;
		this._syncSectionToMessage(section);
		this._isDirty = this._checkIfDirty();
		this._onDidChangeSection.fire(section);
		this._onDidChange.fire();
	}

	/**
	 * Checks if the request can be sent (has valid content).
	 */
	canSend(): { valid: boolean; error?: string } {
		const activeMessages = this.getActiveMessages();
		if (activeMessages.length === 0) {
			return { valid: false, error: 'Cannot send an empty request. Please restore at least one section.' };
		}

		// Check for at least one non-empty message
		const hasContent = activeMessages.some(msg => {
			const textContent = getTextPart(msg.content);
			return textContent.trim().length > 0;
		});

		if (!hasContent) {
			return { valid: false, error: 'Cannot send a request with no content. Please add content to at least one section.' };
		}

		return { valid: true };
	}

	/**
	 * Syncs a section's content back to the underlying message.
	 */
	private _syncSectionToMessage(section: LiveRequestSection): void {
		if (section.sourceMessageIndex < 0 || section.sourceMessageIndex >= this._messages.length) {
			return;
		}

		const message = this._messages[section.sourceMessageIndex];
		// Update the message content by replacing it with a new text parts array
		message.content = toTextParts(section.content);
	}

	/**
	 * Checks if the request is dirty by comparing current state to original.
	 */
	private _checkIfDirty(): boolean {
		for (const section of this._sections) {
			if (section.deleted || section.content !== section.originalContent) {
				return true;
			}
		}
		return false;
	}
}

/**
 * Creates LiveRequestSection objects from Raw.ChatMessage array.
 */
export function createSectionsFromMessages(messages: readonly Raw.ChatMessage[]): LiveRequestSection[] {
	const sections: LiveRequestSection[] = [];

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		const kind = mapRoleToSectionKind(message.role);
		const label = getLabelForSection(kind, message, i);
		const content = getContentAsString(message);

		sections.push({
			id: generateUuid(),
			kind,
			label,
			content,
			collapsed: false,
			editable: kind !== LiveRequestSectionKind.System, // System prompts are read-only by default
			deletable: kind !== LiveRequestSectionKind.System, // System prompts cannot be deleted
			deleted: false,
			sourceMessageIndex: i,
			originalContent: content,
		});
	}

	return sections;
}

/**
 * Maps a Raw.ChatRole to a LiveRequestSectionKind.
 */
function mapRoleToSectionKind(role: Raw.ChatRole): LiveRequestSectionKind {
	switch (role) {
		case Raw.ChatRole.System:
			return LiveRequestSectionKind.System;
		case Raw.ChatRole.User:
			return LiveRequestSectionKind.User;
		case Raw.ChatRole.Assistant:
			return LiveRequestSectionKind.Assistant;
		case Raw.ChatRole.Tool:
			return LiveRequestSectionKind.Tool;
		default:
			return LiveRequestSectionKind.Other;
	}
}

/**
 * Gets a human-readable label for a section.
 */
function getLabelForSection(kind: LiveRequestSectionKind, message: Raw.ChatMessage, index: number): string {
	switch (kind) {
		case LiveRequestSectionKind.System:
			return 'System';
		case LiveRequestSectionKind.User:
			return 'User';
		case LiveRequestSectionKind.Assistant:
			return 'Assistant';
		case LiveRequestSectionKind.Tool:
			return `Tool${message.name ? `: ${message.name}` : ''}`;
		case LiveRequestSectionKind.Context:
			return 'Context';
		case LiveRequestSectionKind.History:
			return 'History';
		case LiveRequestSectionKind.Prediction:
			return 'Prediction';
		default:
			return `Message ${index + 1}`;
	}
}

/**
 * Extracts the content of a message as a plain string.
 */
function getContentAsString(message: Raw.ChatMessage): string {
	return getTextPart(message.content);
}

/**
 * Builder class for creating EditableChatRequest from RenderPromptResult.
 */
export class EditableChatRequestBuilder {

	/**
	 * Creates an EditableChatRequest from a RenderPromptResult.
	 * @param debugName Debug name for logging
	 * @param model The model being used
	 * @param location The chat location
	 * @param sessionId The conversation session ID
	 * @param renderResult The result from PromptRenderer
	 * @param metadata Optional additional metadata
	 */
	static fromRenderPromptResult(
		debugName: string,
		model: string,
		location: ChatLocation,
		sessionId: string,
		renderResult: RenderPromptResult,
		metadata?: EditableChatRequestMetadata,
	): EditableChatRequest {
		const messages = renderResult.messages;
		const sections = createSectionsFromMessages(messages);

		// Add approximate token counts if available.
		// Note: This is an approximation that distributes the total token count evenly.
		// For precise per-section token counting, consider using the tokenizer directly
		// on each section's content when needed.
		if (renderResult.tokenCount !== undefined && sections.length > 0) {
			const avgTokensPerSection = Math.floor(renderResult.tokenCount / sections.length);
			for (const section of sections) {
				section.tokenCount = avgTokensPerSection;
			}
		}

		return new EditableChatRequest(
			debugName,
			model,
			location,
			sessionId,
			[...messages],
			sections,
			{
				maxPromptTokens: metadata?.maxPromptTokens,
				maxResponseTokens: metadata?.maxResponseTokens,
				intent: metadata?.intent,
				endpointUrl: metadata?.endpointUrl,
			},
		);
	}
}
