/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw, RenderPromptResult } from '@vscode/prompt-tsx';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { OptionalChatRequestParams } from '../../../platform/networking/common/fetch';

export type LiveRequestSectionKind =
	| 'system'
	| 'user'
	| 'assistant'
	| 'context'
	| 'history'
	| 'tool'
	| 'prediction'
	| 'metadata'
	| 'other';

export interface LiveRequestSection {
	/** Stable identifier for the section to track collapse/edit state. */
	readonly id: string;
	readonly kind: LiveRequestSectionKind;
	readonly label: string;
	message?: Raw.ChatMessage;
	content: string;
	editedContent?: string;
	collapsed: boolean;
	readonly editable: boolean;
	readonly deletable: boolean;
	/** Index of the backing Raw.ChatMessage in the message array. */
	sourceMessageIndex: number;
	tokenCount?: number;
	deleted?: boolean;
	hoverTitle?: string;
	metadata?: Record<string, unknown>;
}

export interface EditableChatRequestMetadata {
	requestId: string;
	tokenCount?: number;
	maxPromptTokens?: number;
	maxResponseTokens?: number;
	intentId?: string;
	endpointUrl?: string;
	modelFamily?: string;
	requestOptions?: OptionalChatRequestParams;
	createdAt: number;
	lastLoggedAt?: number;
	lastLoggedHash?: number;
	lastLoggedMatches?: boolean;
	lastLoggedMismatchReason?: string;
	lastValidationErrorCode?: LiveRequestValidationError['code'];
}

export interface LiveRequestSessionKey {
	sessionId: string;
	location: ChatLocation;
}

export interface EditableChatRequest {
	readonly id: string;
	readonly sessionId: string;
	readonly location: ChatLocation;
	readonly debugName: string;
	readonly model: string;
	readonly isSubagent?: boolean;
	messages: Raw.ChatMessage[];
	sections: LiveRequestSection[];
	readonly originalMessages: Raw.ChatMessage[];
	metadata: EditableChatRequestMetadata;
	isDirty: boolean;
}

export interface EditableChatRequestInit {
	sessionId: string;
	location: ChatLocation;
	debugName: string;
	model: string;
	renderResult: RenderPromptResult;
	requestId: string;
	intentId?: string;
	endpointUrl?: string;
	modelFamily?: string;
	requestOptions?: OptionalChatRequestParams;
	isSubagent?: boolean;
	maxPromptTokens?: number;
	tokenCounts?: {
		total?: number;
		perMessage?: number[];
	};
}

export type LiveRequestValidationErrorCode = 'empty';

export interface LiveRequestValidationError {
	code: LiveRequestValidationErrorCode;
	details?: string;
}

export interface LiveRequestSendResult {
	messages: Raw.ChatMessage[];
	error?: LiveRequestValidationError;
}

export class LiveRequestEditorValidationError extends Error {
	constructor(public readonly validationError: LiveRequestValidationError) {
		super(validationError.code);
		this.name = 'LiveRequestEditorValidationError';
	}
}
