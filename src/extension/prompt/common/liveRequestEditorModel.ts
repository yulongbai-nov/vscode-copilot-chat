/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITraceData, Raw, RenderPromptResult } from '@vscode/prompt-tsx';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { OptionalChatRequestParams } from '../../../platform/networking/common/fetch';
import { IBuildPromptContext } from './intents';

export type LiveRequestEditorMode = 'off' | 'interceptOnce' | 'interceptAlways' | 'autoOverride';

export type LiveRequestOverrideScope = 'session' | 'workspace' | 'global';

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
	readonly originalContent: string;
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
	overrideState?: LiveRequestSectionOverrideState;
}

export interface LiveRequestSectionOverrideState {
	readonly scope: LiveRequestOverrideScope;
	readonly slotIndex: number;
	readonly updatedAt: number;
}

export interface EditableChatRequestMetadata {
	requestId: string;
	tokenCount?: number;
	maxPromptTokens?: number;
	maxResponseTokens?: number;
	intentId?: string;
	endpointUrl?: string;
	modelFamily?: string;
	/**
	 * When the intercepted request originated from a chat session editor backed by a
	 * {@link vscode.ChatSessionItem}, this stores the session item resource URI so
	 * the Live Request Editor can "Open in chat" for the same session.
	 */
	chatSessionResource?: string;
	requestOptions?: OptionalChatRequestParams;
	createdAt: number;
	lastUpdated?: number;
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

export type LiveRequestReplayState = 'idle' | 'building' | 'ready' | 'forkActive' | 'stale';

export interface LiveRequestReplayKey extends LiveRequestSessionKey {
	requestId: string;
}

export interface LiveRequestReplaySection {
	readonly id: string;
	readonly kind: LiveRequestSectionKind;
	readonly label: string;
	readonly content: string;
	readonly message?: Raw.ChatMessage;
	readonly collapsed: boolean;
	readonly edited: boolean;
	readonly sourceMessageIndex: number;
	readonly tokenCount?: number;
	readonly hoverTitle?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface LiveRequestReplayProjection {
	readonly sections: LiveRequestReplaySection[];
	readonly totalSections: number;
	readonly overflowCount: number;
	readonly editedCount: number;
	readonly deletedCount: number;
	readonly trimmed?: boolean;
	readonly requestOptions?: OptionalChatRequestParams;
}

export interface LiveRequestReplaySnapshot {
	readonly key: LiveRequestReplayKey;
	readonly state: LiveRequestReplayState;
	readonly version: number;
	readonly updatedAt: number;
	readonly payload: Raw.ChatMessage[];
	readonly payloadHash: number;
	readonly projection?: LiveRequestReplayProjection;
	readonly projectionHash?: number;
	readonly parentSessionId: string;
	readonly parentTurnId: string;
	readonly debugName?: string;
	readonly model?: string;
	readonly intentId?: string;
	readonly requestCreatedAt?: number;
	readonly requestLastUpdated?: number;
	readonly lastLoggedHash?: number;
	readonly lastLoggedMatches?: boolean;
	readonly forkSessionId?: string;
	readonly staleReason?: string;
	readonly restoreOfVersion?: number;
}

export type EditTargetKind =
	| 'messageField'
	| 'contentText'
	| 'toolArguments'
	| 'requestOption';

export interface EditOpId {
	requestId: string;
	version: number;
}

export interface EditOp {
	id: EditOpId;
	targetKind: EditTargetKind;
	targetPath: string;
	oldValue: unknown;
	newValue: unknown;
}

export interface EditHistory {
	undoStack: EditOp[];
	redoStack: EditOp[];
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
	editHistory?: EditHistory;
	sessionSnapshot?: LiveRequestSessionSnapshot;
}

export interface EditableChatRequestInit {
	sessionId: string;
	location: ChatLocation;
	debugName: string;
	model: string;
	renderResult: RenderPromptResult;
	traceData?: ITraceData;
	requestId: string;
	intentId?: string;
	endpointUrl?: string;
	modelFamily?: string;
	chatSessionResource?: string;
	requestOptions?: OptionalChatRequestParams;
	isSubagent?: boolean;
	maxPromptTokens?: number;
	tokenCounts?: {
		total?: number;
		perMessage?: number[];
	};
	/**
	 * Optional session snapshot to allow re-rendering the prompt from
	 * normalized chat state instead of only using the flattened messages.
	 * This should not be persisted across reloads.
	 */
	sessionSnapshot?: LiveRequestSessionSnapshot;
}

export interface LiveRequestTraceSection {
	readonly tokenCount?: number;
	readonly tracePath?: string[];
}

export interface LiveRequestTraceSnapshot {
	readonly totalTokens?: number;
	readonly perMessage: LiveRequestTraceSection[];
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

/**
 * Minimal session snapshot that can be used to re-render the prompt.
 * Keep this JSON-friendly and avoid storing heavy/host-bound objects
 * in persisted caches.
 */
export interface LiveRequestSessionSnapshot {
	readonly promptContext: IBuildPromptContext;
	readonly requestOptions?: OptionalChatRequestParams;
	readonly endpointModel: string;
	readonly endpointFamily?: string;
	readonly endpointUrl?: string;
}

/**
 * A JSON-friendly representation of prompt context suitable for storing in the
 * Live Request Editor snapshot. Avoids heavy/host-bound objects (Conversation,
 * streams, etc.) and uses plain data.
 */
export interface LiveRequestContextSnapshot {
	readonly requestId?: string;
	readonly query: string;
	readonly history: unknown;
	readonly chatVariables: unknown;
	readonly workingSet?: unknown;
	readonly tools?: unknown;
	readonly toolCallRounds?: unknown;
	readonly toolCallResults?: unknown;
	readonly toolGrouping?: unknown;
	readonly editedFileEvents?: unknown;
	readonly isContinuation?: boolean;
	readonly modeInstructions?: unknown;
}

export class LiveRequestEditorValidationError extends Error {
	constructor(public readonly validationError: LiveRequestValidationError) {
		super(validationError.code);
		this.name = 'LiveRequestEditorValidationError';
	}
}
