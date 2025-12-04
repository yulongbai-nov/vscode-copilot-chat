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
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { IChatSessionService } from '../../../platform/chat/common/chatSessionService';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { OptionalChatRequestParams } from '../../../platform/networking/common/fetch';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { EditableChatRequest, EditableChatRequestInit, LiveRequestSection, LiveRequestSectionKind, LiveRequestSendResult, LiveRequestSessionKey, LiveRequestValidationError } from '../common/liveRequestEditorModel';
import { AutoOverrideDiffEntry, AutoOverrideSummary, ILiveRequestEditorService, LiveRequestEditorMode, LiveRequestMetadataEvent, LiveRequestMetadataSnapshot, LiveRequestOverrideScope, PendingPromptInterceptSummary, PromptContextChangeEvent, PromptInterceptionAction, PromptInterceptionDecision, PromptInterceptionState, SubagentRequestEntry } from '../common/liveRequestEditorService';
import { createSectionsFromMessages, buildEditableChatRequest } from './liveRequestBuilder';

const SUBAGENT_HISTORY_LIMIT = 10;
const WORKSPACE_AUTO_OVERRIDE_KEY = 'github.copilot.liveRequestEditor.autoOverride.workspace';
const GLOBAL_AUTO_OVERRIDE_KEY = 'github.copilot.liveRequestEditor.autoOverride.global';

interface StoredAutoOverrideEntry {
	slotIndex: number;
	kind: LiveRequestSectionKind;
	label: string;
	originalContent: string;
	overrideContent: string;
	deleted: boolean;
	updatedAt: number;
	scope: LiveRequestOverrideScope;
}

interface AutoOverrideSet {
	scope: LiveRequestOverrideScope;
	entries: StoredAutoOverrideEntry[];
	updatedAt: number;
}

interface AutoOverrideStoragePayload {
	readonly entries: SerializedAutoOverrideEntry[];
	readonly updatedAt: number;
}

interface SerializedAutoOverrideEntry {
	readonly slotIndex: number;
	readonly kind: LiveRequestSectionKind;
	readonly label: string;
	readonly originalContent: string;
	readonly overrideContent: string;
	readonly deleted: boolean;
	readonly updatedAt: number;
}

export class LiveRequestEditorService extends Disposable implements ILiveRequestEditorService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<EditableChatRequest>());
	public readonly onDidChange: Event<EditableChatRequest> = this._onDidChange.event;
	private readonly _onDidRemoveRequest = this._register(new Emitter<LiveRequestSessionKey>());
	public readonly onDidRemoveRequest: Event<LiveRequestSessionKey> = this._onDidRemoveRequest.event;
	private readonly _onDidUpdateSubagentHistory = this._register(new Emitter<void>());
	public readonly onDidUpdateSubagentHistory: Event<void> = this._onDidUpdateSubagentHistory.event;
	private readonly _onDidChangeInterception = this._register(new Emitter<PromptInterceptionState>());
	public readonly onDidChangeInterception: Event<PromptInterceptionState> = this._onDidChangeInterception.event;
	private readonly _onDidChangeMetadata = this._register(new Emitter<LiveRequestMetadataEvent>());
	public readonly onDidChangeMetadata: Event<LiveRequestMetadataEvent> = this._onDidChangeMetadata.event;

	private readonly _requests = new Map<string, EditableChatRequest>();
	private readonly _subagentHistory: SubagentRequestEntry[] = [];
	private _enabled: boolean;
	private _mode: LiveRequestEditorMode;
	private _modeUpdateFromConfig = false;
	private _modeBeforeInterceptOnce: LiveRequestEditorMode = 'off';
	private _autoOverrideFeatureEnabled: boolean;
	private _autoOverridePreviewLimit: number;
	private _autoOverrideScopePreference: LiveRequestOverrideScope | undefined;
	private _autoOverrideCapturing = false;
	private _autoOverrideHasOverrides = false;
	private _autoOverrideLastUpdated: number | undefined;
	private readonly _sessionAutoOverrides = new Map<string, AutoOverrideSet>();
	private _workspaceAutoOverride?: AutoOverrideSet;
	private _globalAutoOverride?: AutoOverrideSet;
	private readonly _pendingIntercepts = new Map<string, PendingIntercept>();
	private _interceptNonce = 0;
	private _interceptionState: PromptInterceptionState;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IChatSessionService private readonly _chatSessionService: IChatSessionService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
	) {
		super();
		this._enabled = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorEnabled);
		this._mode = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorInterception) ? 'interceptAlways' : 'off';
		this._autoOverrideFeatureEnabled = this._configurationService.getConfig(ConfigKey.LiveRequestEditorAutoOverrideEnabled);
		this._autoOverridePreviewLimit = this.clampPreviewLimit(this._configurationService.getConfig(ConfigKey.LiveRequestEditorAutoOverridePreviewLimit));
		this._autoOverrideScopePreference = this._configurationService.getConfig(ConfigKey.LiveRequestEditorAutoOverrideScopePreference);
		this._workspaceAutoOverride = this.loadPersistedOverride('workspace');
		this._globalAutoOverride = this.loadPersistedOverride('global');
		this.refreshAutoOverrideFlags();
		this._interceptionState = {
			enabled: this.isInterceptionEnabled(),
			mode: this._mode,
			paused: false,
			autoOverride: this.buildAutoOverrideSummary()
		};
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ConfigKey.Advanced.LivePromptEditorEnabled.fullyQualifiedId)) {
				this._enabled = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorEnabled);
				if (!this._enabled) {
					this.removeAllRequests();
					this.cancelAllIntercepts('editorDisabled');
				}
				this.emitInterceptionState();
			}
			if (e.affectsConfiguration(ConfigKey.Advanced.LivePromptEditorInterception.fullyQualifiedId)) {
				const next = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorInterception) ? 'interceptAlways' : 'off';
				if (!this._modeUpdateFromConfig) {
					this._mode = next;
					if (next === 'off') {
						this._autoOverrideCapturing = false;
						this._autoOverrideHasOverrides = false;
						this._autoOverrideLastUpdated = undefined;
						this.cancelAllIntercepts('modeDisabled');
					}
					this.emitInterceptionState();
				}
			}
			if (e.affectsConfiguration(ConfigKey.LiveRequestEditorAutoOverrideEnabled.fullyQualifiedId)) {
				this._autoOverrideFeatureEnabled = this._configurationService.getConfig(ConfigKey.LiveRequestEditorAutoOverrideEnabled);
				if (!this._autoOverrideFeatureEnabled) {
					this._autoOverrideCapturing = false;
				} else if (this._mode === 'autoOverride') {
					this._autoOverrideCapturing = true;
				}
				this.emitInterceptionState();
			}
			if (e.affectsConfiguration(ConfigKey.LiveRequestEditorAutoOverridePreviewLimit.fullyQualifiedId)) {
				this._autoOverridePreviewLimit = this.clampPreviewLimit(this._configurationService.getConfig(ConfigKey.LiveRequestEditorAutoOverridePreviewLimit));
				this.emitInterceptionState();
			}
			if (e.affectsConfiguration(ConfigKey.LiveRequestEditorAutoOverrideScopePreference.fullyQualifiedId)) {
				this._autoOverrideScopePreference = this._configurationService.getConfig(ConfigKey.LiveRequestEditorAutoOverrideScopePreference);
				this.emitInterceptionState();
			}
		}));
		this._register(this._chatSessionService.onDidDisposeChatSession(sessionId => {
			this._handleSessionDisposed(sessionId);
		}));
		this.emitInterceptionState();
	}

	isEnabled(): boolean {
		return this._enabled;
	}

	isInterceptionEnabled(): boolean {
		if (!this._enabled) {
			return false;
		}
		switch (this._mode) {
			case 'interceptAlways':
			case 'interceptOnce':
				return true;
			case 'autoOverride':
				return this._autoOverrideFeatureEnabled && this._autoOverrideCapturing;
			default:
				return false;
		}
	}

	prepareRequest(init: EditableChatRequestInit): EditableChatRequest | undefined {
		if (!this._enabled) {
			this.removeRequest(init.sessionId, init.location);
			return undefined;
		}
		const request = buildEditableChatRequest(init);
		this.applyAutoOverridesForRequest(request);
		this._requests.set(this.toKey(init.sessionId, init.location), request);
		this._onDidChange.fire(request);
		this.emitMetadataForRequest(request);
		if (request.isSubagent) {
			this.recordSubagentRequest(request);
		}
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

	updateRequestOptions(key: LiveRequestSessionKey, requestOptions: OptionalChatRequestParams | undefined): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			const next = requestOptions ? deepClone(requestOptions) : undefined;
			if (equals(request.metadata.requestOptions, next)) {
				return false;
			}
			request.metadata.requestOptions = next;
			return true;
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
		const validationChanged = this.updateValidationMetadata(request, validationError);
		const messages = request.messages.length ? request.messages : fallback;
		if (validationChanged) {
			this._onDidChange.fire(request);
			this.emitMetadataForRequest(request);
		}
		return {
			messages,
			error: validationError
		};
	}

	getInterceptionState(): PromptInterceptionState {
		return this._interceptionState;
	}

	async setMode(mode: LiveRequestEditorMode): Promise<void> {
		if (this._mode === mode) {
			return;
		}
		const previousMode = this._mode;
		this._mode = mode;
		if (mode === 'interceptOnce') {
			this._modeBeforeInterceptOnce = previousMode === 'interceptOnce' ? 'off' : previousMode;
		}
		this._autoOverrideCapturing = mode === 'autoOverride'
			&& this._autoOverrideFeatureEnabled
			&& !this._autoOverrideHasOverrides;
		const shouldPersist = mode === 'interceptAlways';
		const previouslyPersisted = previousMode === 'interceptAlways';
		if (shouldPersist) {
			await this.updateInterceptionSetting(true);
		} else if (previouslyPersisted) {
			await this.updateInterceptionSetting(false);
		}
		if (!this.isInterceptionEnabled()) {
			this.cancelAllIntercepts('modeDisabled');
		}
		this.emitInterceptionState();
	}

	getMode(): LiveRequestEditorMode {
		return this._mode;
	}

	async setAutoOverrideScope(scope: LiveRequestOverrideScope): Promise<void> {
		if (this._autoOverrideScopePreference === scope) {
			return;
		}
		this._autoOverrideScopePreference = scope;
		await this._configurationService.setConfig(ConfigKey.LiveRequestEditorAutoOverrideScopePreference, scope);
		this.emitInterceptionState();
	}

	getAutoOverrideScope(): LiveRequestOverrideScope | undefined {
		return this._autoOverrideScopePreference;
	}

	async configureAutoOverridePreviewLimit(limit: number): Promise<void> {
		const sanitized = this.clampPreviewLimit(limit);
		if (sanitized === this._autoOverridePreviewLimit) {
			return;
		}
		this._autoOverridePreviewLimit = sanitized;
		await this._configurationService.setConfig(ConfigKey.LiveRequestEditorAutoOverridePreviewLimit, sanitized);
		this.emitInterceptionState();
	}

	async clearAutoOverrides(scope?: LiveRequestOverrideScope): Promise<void> {
		let changed = false;
		let clearedSession = false;
		let clearedWorkspace = false;
		let clearedGlobal = false;
		if (!scope || scope === 'session') {
			if (this._sessionAutoOverrides.size) {
				this._sessionAutoOverrides.clear();
				changed = true;
				clearedSession = true;
			}
		}
		if (!scope || scope === 'workspace') {
			if (this._workspaceAutoOverride) {
				this._workspaceAutoOverride = undefined;
				changed = true;
				clearedWorkspace = true;
				void this._extensionContext.workspaceState.update(WORKSPACE_AUTO_OVERRIDE_KEY, undefined);
			}
		}
		if (!scope || scope === 'global') {
			if (this._globalAutoOverride) {
				this._globalAutoOverride = undefined;
				changed = true;
				clearedGlobal = true;
				void this._extensionContext.globalState.update(GLOBAL_AUTO_OVERRIDE_KEY, undefined);
			}
		}
		if (!changed) {
			return;
		}
		this.refreshAutoOverrideFlags();
		if (this._mode === 'autoOverride' && this._autoOverrideFeatureEnabled) {
			this._autoOverrideCapturing = !this._autoOverrideHasOverrides;
		}
		if (clearedSession) {
			this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.autoOverride.cleared', { scope: 'session' });
		}
		if (clearedWorkspace) {
			this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.autoOverride.cleared', { scope: 'workspace' });
		}
		if (clearedGlobal) {
			this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.autoOverride.cleared', { scope: 'global' });
		}
		this.emitInterceptionState();
	}

	beginAutoOverrideCapture(_key: LiveRequestSessionKey): void {
		if (this._mode !== 'autoOverride' || !this._autoOverrideFeatureEnabled) {
			return;
		}
		this._autoOverrideCapturing = true;
		this.emitInterceptionState();
	}

	getAutoOverrideEntry(scope: LiveRequestOverrideScope, slotIndex: number, key?: LiveRequestSessionKey): AutoOverrideDiffEntry | undefined {
		let target: AutoOverrideSet | undefined;
		if (scope === 'session') {
			if (!key) {
				return undefined;
			}
			target = this._sessionAutoOverrides.get(this.toKey(key.sessionId, key.location));
		} else if (scope === 'workspace') {
			target = this._workspaceAutoOverride;
		} else {
			target = this._globalAutoOverride;
		}
		if (!target) {
			return undefined;
		}
		const entry = target.entries.find(e => e.slotIndex === slotIndex);
		if (!entry) {
			return undefined;
		}
		this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.autoOverride.diff', {
			scope: entry.scope,
		});
		return {
			scope: entry.scope,
			label: entry.label,
			originalContent: entry.originalContent,
			overrideContent: entry.overrideContent,
			deleted: entry.deleted,
			updatedAt: entry.updatedAt,
		};
	}

	async waitForInterceptionApproval(key: LiveRequestSessionKey, token: CancellationToken): Promise<PromptInterceptionDecision | undefined> {
		if (!this.isInterceptionEnabled()) {
			return undefined;
		}
		const request = this.getRequest(key);
		if (!request || request.isSubagent) {
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
				if (this._mode === 'autoOverride' && this._autoOverrideCapturing) {
					this.captureAutoOverrideForRequest(key);
				}
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
		if (this._mode === 'interceptOnce') {
			this._mode = this._modeBeforeInterceptOnce;
		}
		this.emitInterceptionState();
	}

	handleContextChange(event: PromptContextChangeEvent): void {
		if (!this._pendingIntercepts.size || !this.isInterceptionEnabled()) {
			return;
		}
		const reason = event.reason ?? 'contextChanged';
		const pendingIntercepts = Array.from(this._pendingIntercepts.values());
		for (const pending of pendingIntercepts) {
			this.resolvePendingIntercept(pending.key, 'cancel', { reason });
		}
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
		this.emitMetadataForRequest(request);
	}

	getSubagentRequests(): readonly SubagentRequestEntry[] {
		return [...this._subagentHistory];
	}

	clearSubagentHistory(): void {
		if (!this._subagentHistory.length) {
			return;
		}
		this._subagentHistory.length = 0;
		this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.subagentMonitor.cleared', {});
		this._onDidUpdateSubagentHistory.fire();
	}

	getMetadataSnapshot(key: LiveRequestSessionKey): LiveRequestMetadataSnapshot | undefined {
		if (!this._enabled) {
			return undefined;
		}
		const request = this.getRequest(key);
		return request ? this.buildMetadataSnapshot(request) : undefined;
	}

	private clampPreviewLimit(value: number | undefined): number {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return 3;
		}
		const clamped = Math.floor(value);
		if (clamped < 1) {
			return 1;
		}
		if (clamped > 10) {
			return 10;
		}
		return clamped;
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
		const validationError = this.validateRequestForSend(request);
		this.updateValidationMetadata(request, validationError);
		this._onDidChange.fire(request);
		this.emitMetadataForRequest(request);
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

	private updateValidationMetadata(request: EditableChatRequest, validationError: LiveRequestValidationError | undefined): boolean {
		const previous = request.metadata.lastValidationErrorCode;
		request.metadata.lastValidationErrorCode = validationError?.code;
		return previous !== request.metadata.lastValidationErrorCode;
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

	private removeRequest(sessionId: string, location: ChatLocation): void {
		this.removeRequestByCompositeKey(this.toKey(sessionId, location));
	}

	private removeRequestByCompositeKey(compositeKey: string): void {
		const existing = this._requests.get(compositeKey);
		if (!existing) {
			return;
		}
		this._requests.delete(compositeKey);
		this._onDidRemoveRequest.fire({ sessionId: existing.sessionId, location: existing.location });
		this.emitMetadataCleared({ sessionId: existing.sessionId, location: existing.location });
		if (existing.isSubagent) {
			this.removeSubagentEntriesForRequest(existing.id);
		}
	}

	private removeAllRequests(): void {
		if (!this._requests.size) {
			return;
		}
		for (const key of Array.from(this._requests.keys())) {
			this.removeRequestByCompositeKey(key);
		}
	}

	private _handleSessionDisposed(sessionId: string): void {
		for (const [key, request] of Array.from(this._requests.entries())) {
			if (request.sessionId === sessionId) {
				this.removeRequestByCompositeKey(key);
			}
		}
		const didTrim = this.removeSubagentEntriesBySession(sessionId);
		if (didTrim) {
			this._onDidUpdateSubagentHistory.fire();
		}
		for (const pending of Array.from(this._pendingIntercepts.values())) {
			if (pending.key.sessionId === sessionId) {
				this.resolvePendingIntercept(pending.key, 'cancel', { reason: 'sessionDisposed' });
			}
		}
		const sessionPrefix = `${sessionId}::`;
		let removedOverrides = false;
		for (const compositeKey of Array.from(this._sessionAutoOverrides.keys())) {
			if (compositeKey.startsWith(sessionPrefix)) {
				this._sessionAutoOverrides.delete(compositeKey);
				removedOverrides = true;
			}
		}
		if (removedOverrides) {
			this.refreshAutoOverrideFlags();
		}
	}

	private emitInterceptionState(): void {
		const enabled = this.isInterceptionEnabled();
		const previousPendingKey = this._interceptionState?.pending?.key;
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

		const nextState: PromptInterceptionState = {
			enabled,
			pending: pendingSummary,
			mode: this._mode,
			paused: false,
			autoOverride: this.buildAutoOverrideSummary()
		};
		this._interceptionState = nextState;
		this._onDidChangeInterception.fire(this._interceptionState);

		if (previousPendingKey && !this.keysEqual(previousPendingKey, pendingSummary?.key)) {
			this.emitMetadataForKey(previousPendingKey);
		}
		if (pendingSummary) {
			this.emitMetadataForKey(pendingSummary.key);
		}
	}

	private buildAutoOverrideSummary(): AutoOverrideSummary {
		return {
			enabled: this._autoOverrideFeatureEnabled,
			capturing: this._autoOverrideCapturing,
			hasOverrides: this._autoOverrideHasOverrides,
			scope: this._autoOverrideScopePreference,
			previewLimit: this._autoOverridePreviewLimit,
			lastUpdated: this._autoOverrideLastUpdated,
		};
	}

	private async updateInterceptionSetting(enabled: boolean): Promise<void> {
		const current = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorInterception);
		if (current === enabled) {
			return;
		}
		this._modeUpdateFromConfig = true;
		try {
			await this._configurationService.setConfig(ConfigKey.Advanced.LivePromptEditorInterception, enabled);
		} finally {
			this._modeUpdateFromConfig = false;
		}
	}

	private recordSubagentRequest(request: EditableChatRequest): void {
		const entry: SubagentRequestEntry = {
			id: request.id,
			sessionId: request.sessionId,
			location: request.location,
			debugName: request.debugName,
			model: request.model,
			requestId: request.metadata.requestId,
			createdAt: request.metadata.createdAt ?? Date.now(),
			sections: request.sections.map(section => this.cloneSection(section)),
		};
		this._subagentHistory.unshift(entry);
		if (this._subagentHistory.length > SUBAGENT_HISTORY_LIMIT) {
			const removed = this._subagentHistory.length - SUBAGENT_HISTORY_LIMIT;
			this._subagentHistory.length = SUBAGENT_HISTORY_LIMIT;
			this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.subagentMonitor.trimmed', { removed: String(removed) });
		}
		this._onDidUpdateSubagentHistory.fire();
	}

	private cloneSection(section: LiveRequestSection): LiveRequestSection {
		return {
			...section,
			message: section.message ? deepClone(section.message) : undefined,
			metadata: section.metadata ? { ...section.metadata } : undefined,
		};
	}

	private removeSubagentEntriesForRequest(requestId: string): void {
		const before = this._subagentHistory.length;
		for (let i = this._subagentHistory.length - 1; i >= 0; i--) {
			if (this._subagentHistory[i].id === requestId) {
				this._subagentHistory.splice(i, 1);
			}
		}
		if (before !== this._subagentHistory.length) {
			this._onDidUpdateSubagentHistory.fire();
		}
	}

	private removeSubagentEntriesBySession(sessionId: string): boolean {
		const before = this._subagentHistory.length;
		for (let i = this._subagentHistory.length - 1; i >= 0; i--) {
			if (this._subagentHistory[i].sessionId === sessionId) {
				this._subagentHistory.splice(i, 1);
			}
		}
		return before !== this._subagentHistory.length;
	}

	private emitMetadataForRequest(request: EditableChatRequest): void {
		this._onDidChangeMetadata.fire({
			key: { sessionId: request.sessionId, location: request.location },
			metadata: this.buildMetadataSnapshot(request)
		});
	}

	private emitMetadataCleared(key: LiveRequestSessionKey): void {
		this._onDidChangeMetadata.fire({ key, metadata: undefined });
	}

	private emitMetadataForKey(key: LiveRequestSessionKey): void {
		const request = this.getRequest(key);
		if (request) {
			this.emitMetadataForRequest(request);
		} else {
			this.emitMetadataCleared(key);
		}
	}

	private buildMetadataSnapshot(request: EditableChatRequest): LiveRequestMetadataSnapshot {
		const tokenCount = this.getTokenCountForRequest(request);
		const maxPromptTokens = request.metadata.maxPromptTokens;
		return {
			sessionId: request.sessionId,
			location: request.location,
			requestId: request.metadata.requestId,
			debugName: request.debugName,
			model: request.model,
			isDirty: request.isDirty,
			createdAt: request.metadata.createdAt,
			lastUpdated: Date.now(),
			interceptionState: this._pendingIntercepts.has(this.toKey(request.sessionId, request.location)) ? 'pending' : 'idle',
			tokenCount,
			maxPromptTokens
		};
	}

	private getTokenCountForRequest(request: EditableChatRequest): number | undefined {
		if (typeof request.metadata.tokenCount === 'number' && !Number.isNaN(request.metadata.tokenCount)) {
			return request.metadata.tokenCount;
		}
		const summed = this.sumSectionTokenCounts(request.sections);
		return summed > 0 ? summed : undefined;
	}

	private sumSectionTokenCounts(sections: LiveRequestSection[]): number {
		let total = 0;
		for (const section of sections) {
			if (typeof section.tokenCount === 'number' && section.tokenCount > 0) {
				total += section.tokenCount;
			}
		}
		return total;
	}

	private loadPersistedOverride(scope: LiveRequestOverrideScope): AutoOverrideSet | undefined {
		const key = scope === 'workspace' ? WORKSPACE_AUTO_OVERRIDE_KEY : GLOBAL_AUTO_OVERRIDE_KEY;
		const memento = scope === 'workspace' ? this._extensionContext.workspaceState : this._extensionContext.globalState;
		const payload = memento.get<AutoOverrideStoragePayload | undefined>(key);
		if (!payload || !Array.isArray(payload.entries) || !payload.entries.length) {
			return undefined;
		}
		return {
			scope,
			updatedAt: payload.updatedAt ?? Date.now(),
			entries: payload.entries.map(entry => ({
				slotIndex: entry.slotIndex,
				kind: entry.kind,
				label: entry.label,
				originalContent: entry.originalContent,
				overrideContent: entry.overrideContent,
				deleted: entry.deleted,
				updatedAt: entry.updatedAt,
				scope,
			}))
		};
	}

	private serializeAutoOverrideSet(set: AutoOverrideSet): AutoOverrideStoragePayload {
		return {
			updatedAt: set.updatedAt,
			entries: set.entries.map(entry => ({
				slotIndex: entry.slotIndex,
				kind: entry.kind,
				label: entry.label,
				originalContent: entry.originalContent,
				overrideContent: entry.overrideContent,
				deleted: entry.deleted,
				updatedAt: entry.updatedAt,
			}))
		};
	}

	private refreshAutoOverrideFlags(): void {
		let hasOverrides = false;
		let latest: number | undefined;
		const consider = (set: AutoOverrideSet | undefined): void => {
			if (!set || !set.entries.length) {
				return;
			}
			hasOverrides = true;
			latest = latest === undefined ? set.updatedAt : Math.max(latest, set.updatedAt);
		};
		consider(this._globalAutoOverride);
		consider(this._workspaceAutoOverride);
		for (const set of this._sessionAutoOverrides.values()) {
			consider(set);
		}
		this._autoOverrideHasOverrides = hasOverrides;
		this._autoOverrideLastUpdated = hasOverrides ? latest : undefined;
	}

	private applyAutoOverridesForRequest(request: EditableChatRequest): void {
		if (request.isSubagent) {
			return;
		}
		for (const section of request.sections) {
			section.overrideState = undefined;
		}
		const overrideSets = this.getAutoOverrideSetsForRequest(request);
		if (!overrideSets.length) {
			return;
		}
		const appliedSlots = new Set<number>();
		let didMutate = false;
		for (const set of overrideSets) {
			for (const entry of set.entries) {
				if (appliedSlots.has(entry.slotIndex)) {
					continue;
				}
				const section = request.sections[entry.slotIndex];
				if (!section) {
					continue;
				}
				if (section.kind !== entry.kind) {
					continue;
				}
				appliedSlots.add(entry.slotIndex);
				section.overrideState = {
					scope: set.scope,
					slotIndex: entry.slotIndex,
					updatedAt: entry.updatedAt,
				};
				if (entry.deleted) {
					if (!section.deleted) {
						section.deleted = true;
						didMutate = true;
					}
					section.content = '';
					section.editedContent = '';
					continue;
				}
				if (section.content !== entry.overrideContent) {
					section.content = entry.overrideContent;
					section.editedContent = entry.overrideContent;
					didMutate = true;
				}
				section.deleted = false;
			}
		}
		if (didMutate) {
			this.recomputeMessages(request);
		}
	}

	private getAutoOverrideSetsForRequest(request: EditableChatRequest): AutoOverrideSet[] {
		const sets: AutoOverrideSet[] = [];
		if (this._globalAutoOverride?.entries.length) {
			sets.push(this._globalAutoOverride);
		}
		if (this._workspaceAutoOverride?.entries.length) {
			sets.push(this._workspaceAutoOverride);
		}
		const sessionSet = this._sessionAutoOverrides.get(this.toKey(request.sessionId, request.location));
		if (sessionSet?.entries.length) {
			sets.push(sessionSet);
		}
		return sets;
	}

	private captureAutoOverrideForRequest(key: LiveRequestSessionKey): void {
		const request = this.getRequest(key);
		if (!request) {
			return;
		}
		const limit = Math.max(1, this._autoOverridePreviewLimit);
		const timestamp = Date.now();
		const entries: StoredAutoOverrideEntry[] = [];
		for (const section of request.sections.slice(0, limit)) {
			const original = section.originalContent ?? '';
			const current = section.deleted ? '' : (section.content ?? '');
			const deleted = !!section.deleted && !!original.length;
			if (!deleted && original === current) {
				continue;
			}
			if (deleted || original !== current) {
				entries.push({
					slotIndex: section.sourceMessageIndex,
					kind: section.kind,
					label: section.label,
					originalContent: original,
					overrideContent: current,
					deleted,
					updatedAt: timestamp,
					scope: this._autoOverrideScopePreference ?? 'session',
				});
			}
		}
		const scope = this._autoOverrideScopePreference ?? 'session';
		this.persistAutoOverrideEntries(scope, key, entries, timestamp);
		this._autoOverrideCapturing = false;
		this.emitInterceptionState();
	}

	private persistAutoOverrideEntries(scope: LiveRequestOverrideScope, key: LiveRequestSessionKey, entries: StoredAutoOverrideEntry[], updatedAt: number): void {
		const sessionCompositeKey = this.toKey(key.sessionId, key.location);
		if (!entries.length) {
			if (scope === 'session') {
				this._sessionAutoOverrides.delete(sessionCompositeKey);
			} else if (scope === 'workspace') {
				this._workspaceAutoOverride = undefined;
				void this._extensionContext.workspaceState.update(WORKSPACE_AUTO_OVERRIDE_KEY, undefined);
			} else {
				this._globalAutoOverride = undefined;
				void this._extensionContext.globalState.update(GLOBAL_AUTO_OVERRIDE_KEY, undefined);
			}
			this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.autoOverride.cleared', { scope });
			this.refreshAutoOverrideFlags();
			return;
		}

		const normalizedEntries = entries.map(entry => ({ ...entry, scope }));
		const set: AutoOverrideSet = { scope, entries: normalizedEntries, updatedAt };
		if (scope === 'session') {
			this._sessionAutoOverrides.set(sessionCompositeKey, set);
		} else if (scope === 'workspace') {
			this._workspaceAutoOverride = set;
			void this._extensionContext.workspaceState.update(WORKSPACE_AUTO_OVERRIDE_KEY, this.serializeAutoOverrideSet(set));
		} else {
			this._globalAutoOverride = set;
			void this._extensionContext.globalState.update(GLOBAL_AUTO_OVERRIDE_KEY, this.serializeAutoOverrideSet(set));
		}
		this.refreshAutoOverrideFlags();
		this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.autoOverride.saved', {
			scope,
			entries: String(entries.length),
			previewLimit: String(this._autoOverridePreviewLimit),
		});
	}

	private keysEqual(a: LiveRequestSessionKey | undefined, b: LiveRequestSessionKey | undefined): boolean {
		return !!a && !!b && a.sessionId === b.sessionId && a.location === b.location;
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
