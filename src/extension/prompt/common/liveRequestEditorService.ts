/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/vs/base/common/event';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { EditableChatRequest, EditableChatRequestInit, LiveRequestSection, LiveRequestSendResult, LiveRequestSessionKey } from './liveRequestEditorModel';

export const ILiveRequestEditorService = createServiceIdentifier<ILiveRequestEditorService>('ILiveRequestEditorService');

export interface PendingPromptInterceptSummary {
	readonly key: LiveRequestSessionKey;
	readonly requestId: string;
	readonly debugName: string;
	readonly requestedAt: number;
	readonly nonce: number;
}

export interface PromptInterceptionState {
	readonly enabled: boolean;
	readonly pending?: PendingPromptInterceptSummary;
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

export interface ILiveRequestEditorService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<EditableChatRequest>;
	readonly onDidRemoveRequest: Event<LiveRequestSessionKey>;
	readonly onDidUpdateSubagentHistory: Event<void>;
	readonly onDidChangeInterception: Event<PromptInterceptionState>;
	readonly onDidChangeMetadata: Event<LiveRequestMetadataEvent>;

	isEnabled(): boolean;
	isInterceptionEnabled(): boolean;

	prepareRequest(init: EditableChatRequestInit): EditableChatRequest | undefined;

	getRequest(key: LiveRequestSessionKey): EditableChatRequest | undefined;

	updateSectionContent(key: LiveRequestSessionKey, sectionId: string, newContent: string): EditableChatRequest | undefined;

	deleteSection(key: LiveRequestSessionKey, sectionId: string): EditableChatRequest | undefined;

	restoreSection(key: LiveRequestSessionKey, sectionId: string): EditableChatRequest | undefined;

	resetRequest(key: LiveRequestSessionKey): EditableChatRequest | undefined;

	updateTokenCounts(key: LiveRequestSessionKey, tokenCounts: { total?: number; perMessage?: number[] }): EditableChatRequest | undefined;

	getMessagesForSend(key: LiveRequestSessionKey, fallback: Raw.ChatMessage[]): LiveRequestSendResult;

	getInterceptionState(): PromptInterceptionState;

	waitForInterceptionApproval(key: LiveRequestSessionKey, token: CancellationToken): Promise<PromptInterceptionDecision | undefined>;

	resolvePendingIntercept(key: LiveRequestSessionKey, action: PromptInterceptionAction, options?: { reason?: string }): void;

	handleContextChange(event: PromptContextChangeEvent): void;

	recordLoggedRequest(key: LiveRequestSessionKey | undefined, messages: Raw.ChatMessage[]): void;

	getSubagentRequests(): readonly SubagentRequestEntry[];
	clearSubagentHistory(): void;

	getMetadataSnapshot(key: LiveRequestSessionKey): LiveRequestMetadataSnapshot | undefined;
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
