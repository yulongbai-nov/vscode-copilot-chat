/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/vs/base/common/event';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { OptionalChatRequestParams } from '../../../platform/networking/common/fetch';
import { EditableChatRequest, EditableChatRequestInit, LiveRequestEditorMode, LiveRequestOverrideScope, LiveRequestReplayKey, LiveRequestReplaySnapshot, LiveRequestSection, LiveRequestSendResult, LiveRequestSessionKey, LiveRequestTraceSnapshot } from './liveRequestEditorModel';

export type { LiveRequestEditorMode, LiveRequestOverrideScope } from './liveRequestEditorModel';

export const ILiveRequestEditorService = createServiceIdentifier<ILiveRequestEditorService>('ILiveRequestEditorService');

export interface PendingPromptInterceptSummary {
	readonly key: LiveRequestSessionKey;
	readonly requestId: string;
	readonly debugName: string;
	readonly requestedAt: number;
	readonly nonce: number;
}

export interface AutoOverrideSummary {
	readonly enabled: boolean;
	readonly capturing: boolean;
	readonly hasOverrides: boolean;
	readonly scope?: LiveRequestOverrideScope;
	readonly previewLimit: number;
	readonly lastUpdated?: number;
}

export interface AutoOverrideDiffEntry {
	readonly scope: LiveRequestOverrideScope;
	readonly label: string;
	readonly originalContent: string;
	readonly overrideContent: string;
	readonly deleted: boolean;
	readonly updatedAt: number;
}

export interface PromptInterceptionState {
	readonly enabled: boolean;
	readonly pending?: PendingPromptInterceptSummary;
	readonly mode: LiveRequestEditorMode;
	readonly paused: boolean;
	readonly autoOverride?: AutoOverrideSummary;
}

export type PromptInterceptionAction = 'resume' | 'cancel';

export type PromptInterceptionDecision =
	| { action: 'resume'; messages: Raw.ChatMessage[] }
	| { action: 'cancel'; reason?: string };

export interface LiveRequestMetadataSnapshot {
	readonly sessionId: string;
	readonly location: ChatLocation;
	readonly requestId?: string;
	readonly debugName?: string;
	readonly model: string;
	readonly isDirty: boolean;
	readonly createdAt: number;
	readonly lastUpdated: number;
	readonly interceptionState: 'pending' | 'idle';
	readonly tokenCount?: number;
	readonly maxPromptTokens?: number;
}

export interface LiveRequestMetadataEvent {
	readonly key: LiveRequestSessionKey;
	readonly metadata?: LiveRequestMetadataSnapshot;
}

export interface LiveRequestReplayEvent {
	readonly key: LiveRequestReplayKey;
	readonly replay?: LiveRequestReplaySnapshot;
}

export interface ILiveRequestEditorService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<EditableChatRequest>;
	readonly onDidRemoveRequest: Event<LiveRequestSessionKey>;
	readonly onDidUpdateSubagentHistory: Event<void>;
	readonly onDidChangeInterception: Event<PromptInterceptionState>;
	readonly onDidChangeMetadata: Event<LiveRequestMetadataEvent>;
	readonly onDidChangeReplay: Event<LiveRequestReplayEvent>;

	isEnabled(): boolean;
	isInterceptionEnabled(): boolean;
	isReplayEnabled(): boolean;

	prepareRequest(init: EditableChatRequestInit): EditableChatRequest | undefined;

	getRequest(key: LiveRequestSessionKey): EditableChatRequest | undefined;

	updateSectionContent(key: LiveRequestSessionKey, sectionId: string, newContent: string): EditableChatRequest | undefined;

	deleteSection(key: LiveRequestSessionKey, sectionId: string): EditableChatRequest | undefined;

	restoreSection(key: LiveRequestSessionKey, sectionId: string): EditableChatRequest | undefined;

	resetRequest(key: LiveRequestSessionKey): EditableChatRequest | undefined;

	updateTokenCounts(key: LiveRequestSessionKey, tokenCounts: { total?: number; perMessage?: number[] }): EditableChatRequest | undefined;
	applyTraceData(key: LiveRequestSessionKey, trace: LiveRequestTraceSnapshot): EditableChatRequest | undefined;

	updateRequestOptions(key: LiveRequestSessionKey, requestOptions: OptionalChatRequestParams | undefined): EditableChatRequest | undefined;

	getMessagesForSend(key: LiveRequestSessionKey, fallback: Raw.ChatMessage[]): LiveRequestSendResult;

	getInterceptionState(): PromptInterceptionState;

	setMode(mode: LiveRequestEditorMode): Promise<void>;

	getMode(): LiveRequestEditorMode;

	setAutoOverrideScope(scope: LiveRequestOverrideScope): Promise<void>;

	getAutoOverrideScope(): LiveRequestOverrideScope | undefined;

	configureAutoOverridePreviewLimit(limit: number): Promise<void>;

	clearAutoOverrides(scope?: LiveRequestOverrideScope): Promise<void>;

	beginAutoOverrideCapture(key: LiveRequestSessionKey): void;

	getAutoOverrideEntry(scope: LiveRequestOverrideScope, slotIndex: number, key?: LiveRequestSessionKey): AutoOverrideDiffEntry | undefined;

	waitForInterceptionApproval(key: LiveRequestSessionKey, token: CancellationToken): Promise<PromptInterceptionDecision | undefined>;

	resolvePendingIntercept(key: LiveRequestSessionKey, action: PromptInterceptionAction, options?: { reason?: string }): void;

	handleContextChange(event: PromptContextChangeEvent): void;

	recordLoggedRequest(key: LiveRequestSessionKey | undefined, messages: Raw.ChatMessage[]): void;

	getSubagentRequests(): readonly SubagentRequestEntry[];
	clearSubagentHistory(): void;

	getMetadataSnapshot(key: LiveRequestSessionKey): LiveRequestMetadataSnapshot | undefined;

	buildReplayForRequest(key: LiveRequestSessionKey): LiveRequestReplaySnapshot | undefined;
	getReplaySnapshot(key: LiveRequestReplayKey): LiveRequestReplaySnapshot | undefined;
	restorePreviousReplay(key: LiveRequestReplayKey): LiveRequestReplaySnapshot | undefined;
	markReplayForkActive(key: LiveRequestReplayKey, forkSessionId: string): LiveRequestReplaySnapshot | undefined;
	markReplayStale(key: LiveRequestSessionKey, requestId?: string, reason?: string): void;
}

export interface PromptContextChangeEvent {
	readonly key: LiveRequestSessionKey;
	readonly reason?: string;
}

export interface SubagentRequestEntry {
	readonly id: string;
	readonly sessionId: string;
	readonly location: ChatLocation;
	readonly debugName: string;
	readonly model: string;
	readonly requestId: string;
	readonly createdAt: number;
	readonly sections: readonly LiveRequestSection[];
}
