/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { DeferredPromise } from '../../../util/vs/base/common/async';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { deepClone, equals } from '../../../util/vs/base/common/objects';
import { stringHash } from '../../../util/vs/base/common/hash';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { EditableChatRequest, EditableChatRequestInit, LiveRequestSectionKind, LiveRequestSendResult, LiveRequestSessionKey, LiveRequestValidationError } from '../common/liveRequestEditorModel';
import { ILiveRequestEditorService, PendingPromptInterceptSummary, PromptInterceptionAction, PromptInterceptionDecision, PromptInterceptionState } from '../common/liveRequestEditorService';
import { createSectionsFromMessages, buildEditableChatRequest } from './liveRequestBuilder';

export class LiveRequestEditorService extends Disposable implements ILiveRequestEditorService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<EditableChatRequest>());
	public readonly onDidChange: Event<EditableChatRequest> = this._onDidChange.event;
	private readonly _onDidChangeInterception = this._register(new Emitter<PromptInterceptionState>());
	public readonly onDidChangeInterception: Event<PromptInterceptionState> = this._onDidChangeInterception.event;

	private readonly _requests = new Map<string, EditableChatRequest>();
	private _enabled: boolean;
	private _interceptionEnabled: boolean;
	private readonly _pendingIntercepts = new Map<string, PendingIntercept>();
	private _interceptNonce = 0;
	private _interceptionState: PromptInterceptionState;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();
		this._enabled = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorEnabled);
		this._interceptionEnabled = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorInterception);
		this._interceptionState = { enabled: this.isInterceptionEnabled() };
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ConfigKey.Advanced.LivePromptEditorEnabled.fullyQualifiedId)) {
				this._enabled = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorEnabled);
				if (!this._enabled) {
					this._requests.clear();
					this.cancelAllIntercepts('editorDisabled');
				}
				this.emitInterceptionState();
			}
			if (e.affectsConfiguration(ConfigKey.Advanced.LivePromptEditorInterception.fullyQualifiedId)) {
				this._interceptionEnabled = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorInterception);
				if (!this.isInterceptionEnabled()) {
					this.cancelAllIntercepts('modeDisabled');
				}
				this.emitInterceptionState();
			}
		}));
		this.emitInterceptionState();
	}

	isEnabled(): boolean {
		return this._enabled;
	}

	isInterceptionEnabled(): boolean {
		return this._enabled && !!this._interceptionEnabled;
	}

	prepareRequest(init: EditableChatRequestInit): EditableChatRequest | undefined {
		if (!this._enabled) {
			this._requests.delete(this.toKey(init.sessionId, init.location));
			return undefined;
		}
		const request = buildEditableChatRequest(init);
		this._requests.set(this.toKey(init.sessionId, init.location), request);
		this._onDidChange.fire(request);
		return request;
	}

	getRequest(key: LiveRequestSessionKey): EditableChatRequest | undefined {
		return this._requests.get(this.toKey(key.sessionId, key.location));
	}

	updateSectionContent(key: LiveRequestSessionKey, sectionId: string, newContent: string): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			const section = request.sections.find(s => s.id === sectionId);
			if (!section || !section.editable) {
				return false;
			}
			section.content = newContent;
			section.editedContent = newContent;
			section.deleted = false;
			return true;
		}, true);
	}

	deleteSection(key: LiveRequestSessionKey, sectionId: string): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			const section = request.sections.find(s => s.id === sectionId);
			if (!section || !section.deletable) {
				return false;
			}
			if (section.deleted) {
				return false;
			}
			section.deleted = true;
			return true;
		}, true);
	}

	restoreSection(key: LiveRequestSessionKey, sectionId: string): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			const section = request.sections.find(s => s.id === sectionId);
			if (!section) {
				return false;
			}
			if (!section.deleted) {
				return false;
			}
			section.deleted = false;
			return true;
		}, true);
	}

	resetRequest(key: LiveRequestSessionKey): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			request.messages = deepClone(request.originalMessages);
			request.sections = createSectionsFromMessages(request.messages);
			request.isDirty = false;
			return true;
		}, false);
	}

	updateTokenCounts(key: LiveRequestSessionKey, tokenCounts: { total?: number; perMessage?: number[] }): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			let didChange = false;
			if (typeof tokenCounts.total === 'number' && tokenCounts.total >= 0) {
				request.metadata.tokenCount = tokenCounts.total;
				didChange = true;
			}
			if (tokenCounts.perMessage && tokenCounts.perMessage.length) {
				for (const section of request.sections) {
					const value = tokenCounts.perMessage[section.sourceMessageIndex];
					if (typeof value === 'number') {
						section.tokenCount = value;
						didChange = true;
					}
				}
			}
			return didChange;
		}, false);
	}

	getMessagesForSend(key: LiveRequestSessionKey, fallback: Raw.ChatMessage[]): LiveRequestSendResult {
		if (!this._enabled) {
			return { messages: fallback };
		}
		const request = this.getRequest(key);
		if (!request) {
			return { messages: fallback };
		}
		this.recomputeMessages(request);
		const validationError = this.validateRequestForSend(request);
		request.metadata.lastValidationErrorCode = validationError?.code;
		const messages = request.messages.length ? request.messages : fallback;
		return {
			messages,
			error: validationError
		};
	}

	getInterceptionState(): PromptInterceptionState {
		return this._interceptionState;
	}

	async waitForInterceptionApproval(key: LiveRequestSessionKey, token: CancellationToken): Promise<PromptInterceptionDecision | undefined> {
		if (!this.isInterceptionEnabled()) {
			return undefined;
		}
		const request = this.getRequest(key);
		if (!request) {
			return undefined;
		}

		const pendingKey = this.toKey(key.sessionId, key.location);
		const existing = this._pendingIntercepts.get(pendingKey);
		if (existing) {
			this._pendingIntercepts.delete(pendingKey);
			if (!existing.deferred.isSettled) {
				void existing.deferred.complete({ action: 'cancel', reason: 'superseded' });
			}
			this._logInterceptionOutcome('cancel', 'superseded', existing.key);
		}

		const deferred = new DeferredPromise<PromptInterceptionDecision>();
		const pending: PendingIntercept = {
			key,
			requestId: request.metadata.requestId,
			debugName: request.debugName,
			requestedAt: Date.now(),
			nonce: ++this._interceptNonce,
			deferred,
			fallbackMessages: request.messages.map(message => deepClone(message)),
		};

		this._pendingIntercepts.set(pendingKey, pending);
		this.emitInterceptionState();

		const cancellationListener = token.onCancellationRequested(() => {
			this.resolvePendingIntercept(key, 'cancel', { reason: 'token' });
		});

		try {
			return await deferred.p;
		} finally {
			cancellationListener.dispose();
		}
	}

	resolvePendingIntercept(key: LiveRequestSessionKey, action: PromptInterceptionAction, options?: { reason?: string }): void {
		const pendingKey = this.toKey(key.sessionId, key.location);
		const pending = this._pendingIntercepts.get(pendingKey);
		if (!pending) {
			return;
		}
		this._pendingIntercepts.delete(pendingKey);

		let outcomeReason = options?.reason;
		let loggedAction: PromptInterceptionAction = action;
		if (!pending.deferred.isSettled) {
			if (action === 'resume') {
				const request = this.getRequest(key);
				const result = request ? this.getMessagesForSend(key, request.messages) : { messages: pending.fallbackMessages };
				if (result.error) {
					loggedAction = 'cancel';
					outcomeReason = 'invalid';
					void pending.deferred.complete({ action: 'cancel', reason: 'invalid' });
				} else {
					void pending.deferred.complete({ action: 'resume', messages: result.messages });
				}
			} else {
				void pending.deferred.complete({ action: 'cancel', reason: options?.reason });
			}
		}

		if (loggedAction === 'resume' && !outcomeReason) {
			outcomeReason = 'user';
		}

		this._logInterceptionOutcome(loggedAction, outcomeReason, pending.key);
		this.emitInterceptionState();
	}

	recordLoggedRequest(key: LiveRequestSessionKey | undefined, messages: Raw.ChatMessage[]): void {
		if (!this._enabled || !key) {
			return;
		}
		const request = this.getRequest(key);
		if (!request) {
			return;
		}
		this.recomputeMessages(request);
		const expectedHash = this.computeMessagesHash(request.messages);
		const loggedHash = this.computeMessagesHash(messages);
		request.metadata.lastLoggedAt = Date.now();
		request.metadata.lastLoggedHash = loggedHash;
		request.metadata.lastLoggedMatches = expectedHash === loggedHash;
		request.metadata.lastLoggedMismatchReason = request.metadata.lastLoggedMatches ? undefined : 'messages';
		if (!request.metadata.lastLoggedMatches) {
			this._telemetryService.sendGHTelemetryEvent('liveRequestEditor.requestParityMismatch', {
				location: ChatLocation.toString(request.location),
				intentId: request.metadata.intentId ?? 'unknown',
				model: request.model,
				debugName: request.debugName,
			});
		}
		this._onDidChange.fire(request);
	}

	private withRequest(
		key: LiveRequestSessionKey,
		mutator: (request: EditableChatRequest) => boolean,
		recompute: boolean,
	): EditableChatRequest | undefined {
		if (!this._enabled) {
			return undefined;
		}
		const request = this.getRequest(key);
		if (!request) {
			return undefined;
		}
		const didMutate = mutator(request);
		if (!didMutate) {
			return request;
		}
		if (recompute) {
			this.recomputeMessages(request);
		} else {
			request.isDirty = !equals(request.messages, request.originalMessages);
		}
		this._onDidChange.fire(request);
		return request;
	}

	private recomputeMessages(request: EditableChatRequest): void {
		const updatedMessages: Raw.ChatMessage[] = [];
		let isDirty = false;
		let expectedIndex = 0;

		for (const section of request.sections) {
			if (section.deleted) {
				if (!isDirty) {
					isDirty = true;
				}
				continue;
			}

			const originalMessage = request.originalMessages[section.sourceMessageIndex];
			let message: Raw.ChatMessage;
			if (originalMessage) {
				message = deepClone(originalMessage);
			} else {
				message = this.createMessageShell(section.kind);
				isDirty = true;
			}

			if (section.editedContent !== undefined) {
				message.content = [{
					type: Raw.ChatCompletionContentPartKind.Text,
					text: section.editedContent
				}];
				isDirty = true;
			}

			section.message = message;
			updatedMessages.push(message);
			if (section.sourceMessageIndex !== expectedIndex) {
				isDirty = true;
			}
			expectedIndex++;
		}

		if (!isDirty && updatedMessages.length !== request.originalMessages.length) {
			isDirty = true;
		}

		request.messages = updatedMessages;
		request.isDirty = isDirty || !equals(updatedMessages, request.originalMessages);
	}

	private validateRequestForSend(request: EditableChatRequest): LiveRequestValidationError | undefined {
		if (!request.messages.length) {
			return { code: 'empty' };
		}
		return undefined;
	}

	private computeMessagesHash(messages: Raw.ChatMessage[]): number {
		if (!messages.length) {
			return 0;
		}
		try {
			const serialized = JSON.stringify(messages);
			return stringHash(serialized, 0);
		} catch {
			// fall back to length-based hash if serialization fails unexpectedly
			return stringHash(String(messages.length), 0);
		}
	}

	private createMessageShell(kind: LiveRequestSectionKind): Raw.ChatMessage {
		const role = kindToRole(kind);
		if (role === Raw.ChatRole.Tool) {
			return {
				role,
				toolCallId: '',
				content: [{
					type: Raw.ChatCompletionContentPartKind.Text,
					text: ''
				}]
			};
		}

		return {
			role,
			content: [{
				type: Raw.ChatCompletionContentPartKind.Text,
				text: ''
			}]
		};
	}

	private toKey(sessionId: string, location: number): string {
		return `${sessionId}::${location}`;
	}

	private _logInterceptionOutcome(action: PromptInterceptionAction, reason: string | undefined, key: LiveRequestSessionKey): void {
		const locationLabel = ChatLocation.toStringShorter(key.location);
		this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.promptInterception.outcome', {
			action,
			reason: reason ?? 'unspecified',
			location: locationLabel,
		});
	}

	private cancelAllIntercepts(reason: string): void {
		if (!this._pendingIntercepts.size) {
			this.emitInterceptionState();
			return;
		}
		for (const [key, pending] of this._pendingIntercepts) {
			this._pendingIntercepts.delete(key);
			if (!pending.deferred.isSettled) {
				void pending.deferred.complete({ action: 'cancel', reason });
			}
			this._logInterceptionOutcome('cancel', reason, pending.key);
		}
		this.emitInterceptionState();
	}

	private emitInterceptionState(): void {
		const enabled = this.isInterceptionEnabled();
		let pendingSummary: PendingPromptInterceptSummary | undefined;
		if (enabled && this._pendingIntercepts.size) {
			let latest: PendingIntercept | undefined;
			for (const pending of this._pendingIntercepts.values()) {
				if (!latest || pending.requestedAt >= latest.requestedAt) {
					latest = pending;
				}
			}
			if (latest) {
				pendingSummary = {
					key: latest.key,
					requestId: latest.requestId,
					debugName: latest.debugName,
					requestedAt: latest.requestedAt,
					nonce: latest.nonce,
				};
			}
		}

		const nextState: PromptInterceptionState = pendingSummary ? { enabled, pending: pendingSummary } : { enabled };
		this._interceptionState = nextState;
		this._onDidChangeInterception.fire(this._interceptionState);
	}
}

interface PendingIntercept {
	readonly key: LiveRequestSessionKey;
	readonly requestId: string;
	readonly debugName: string;
	readonly requestedAt: number;
	readonly nonce: number;
	readonly deferred: DeferredPromise<PromptInterceptionDecision>;
	readonly fallbackMessages: Raw.ChatMessage[];
}

function kindToRole(kind: LiveRequestSectionKind): Raw.ChatRole {
	switch (kind) {
		case 'system':
			return Raw.ChatRole.System;
		case 'assistant':
			return Raw.ChatRole.Assistant;
		case 'tool':
			return Raw.ChatRole.Tool;
		default:
			return Raw.ChatRole.User;
	}
}
