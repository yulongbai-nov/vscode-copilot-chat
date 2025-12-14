/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { DeferredPromise, RunOnceScheduler } from '../../../util/vs/base/common/async';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { deepClone, equals } from '../../../util/vs/base/common/objects';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { IChatSessionService } from '../../../platform/chat/common/chatSessionService';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { OptionalChatRequestParams } from '../../../platform/networking/common/fetch';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { EditableChatRequest, EditableChatRequestInit, EditHistory, EditOp, EditTargetKind, LiveRequestContextSnapshot, LiveRequestReplayKey, LiveRequestReplayProjection, LiveRequestReplaySnapshot, LiveRequestReplayState, LiveRequestSection, LiveRequestSectionKind, LiveRequestSendResult, LiveRequestSessionKey, LiveRequestTraceSnapshot, LiveRequestValidationError } from '../common/liveRequestEditorModel';
import { AutoOverrideDiffEntry, AutoOverrideSummary, ILiveRequestEditorService, LiveRequestEditorMode, LiveRequestMetadataEvent, LiveRequestMetadataSnapshot, LiveRequestOverrideScope, LiveRequestReplayEvent, PendingPromptInterceptSummary, PromptContextChangeEvent, PromptInterceptionAction, PromptInterceptionDecision, PromptInterceptionState, SubagentRequestEntry } from '../common/liveRequestEditorService';
import { DEFAULT_REPLAY_SECTION_CAP, buildEditableChatRequest, buildReplayProjection, computeChatMessagesHash, computeReplayProjectionHash, createSectionsFromMessages, renderMessageContent } from './liveRequestBuilder';
import { IBuildPromptContext } from '../common/intents';
import { AgentPrompt } from '../../prompts/node/agent/agentPrompt';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { renderPromptElement } from '../../prompts/node/base/promptRenderer';

const SUBAGENT_HISTORY_LIMIT = 10;
const WORKSPACE_AUTO_OVERRIDE_KEY = 'github.copilot.liveRequestEditor.autoOverride.workspace';
const GLOBAL_AUTO_OVERRIDE_KEY = 'github.copilot.liveRequestEditor.autoOverride.global';
const WORKSPACE_REQUEST_CACHE_KEY = 'github.copilot.liveRequestEditor.requestCache.v1';
const MAX_PERSISTED_REQUESTS = 50;

interface PersistedRequestCacheV1 {
	readonly version: 1;
	readonly updatedAt: number;
	readonly requests: EditableChatRequest[];
}

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

interface ReplayEntry {
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
	readonly sourceUpdatedAt?: number;
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
	private readonly _onDidChangeReplay = this._register(new Emitter<LiveRequestReplayEvent>());
	public readonly onDidChangeReplay: Event<LiveRequestReplayEvent> = this._onDidChangeReplay.event;

	private readonly _requests = new Map<string, EditableChatRequest>();
	private readonly _subagentHistory: SubagentRequestEntry[] = [];
	private readonly _replays = new Map<string, ReplayEntry>();
	private readonly _replayRestoreBuffer = new Map<string, ReplayEntry>();
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
	private _timelineReplayEnabled: boolean;
	private readonly _persistRequestsScheduler: RunOnceScheduler;
	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IChatSessionService private readonly _chatSessionService: IChatSessionService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@ILogService private readonly _logService: ILogService,
		@IEndpointProvider private readonly _endpointProvider: IEndpointProvider,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this._enabled = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorEnabled);
		this._mode = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorInterception) ? 'interceptAlways' : 'off';
		this._autoOverrideFeatureEnabled = this._configurationService.getConfig(ConfigKey.LiveRequestEditorAutoOverrideEnabled);
		this._autoOverridePreviewLimit = this.clampPreviewLimit(this._configurationService.getConfig(ConfigKey.LiveRequestEditorAutoOverridePreviewLimit));
		this._autoOverrideScopePreference = this._configurationService.getConfig(ConfigKey.LiveRequestEditorAutoOverrideScopePreference);
		this._timelineReplayEnabled = this._configurationService.getConfig(ConfigKey.LiveRequestEditorTimelineReplayEnabled);
		this._workspaceAutoOverride = this.loadPersistedOverride('workspace');
		this._globalAutoOverride = this.loadPersistedOverride('global');
		this.refreshAutoOverrideFlags();
		this._interceptionState = {
			enabled: this.isInterceptionEnabled(),
			mode: this._mode,
			paused: false,
			autoOverride: this.buildAutoOverrideSummary()
		};
		this._persistRequestsScheduler = this._register(new RunOnceScheduler(() => {
			void this.persistRequestCache();
		}, 750));
		this.restoreRequestCache();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ConfigKey.Advanced.LivePromptEditorEnabled.fullyQualifiedId)) {
				this._enabled = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorEnabled);
				if (!this._enabled) {
					this.removeAllRequests();
					this.cancelAllIntercepts('editorDisabled');
					this.clearReplayState('editorDisabled');
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
				this._autoOverrideCapturing = this._autoOverrideFeatureEnabled
					&& this._mode === 'autoOverride'
					&& !this._autoOverrideHasOverrides;
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
			if (e.affectsConfiguration(ConfigKey.LiveRequestEditorTimelineReplayEnabled.fullyQualifiedId)) {
				this._timelineReplayEnabled = this._configurationService.getConfig(ConfigKey.LiveRequestEditorTimelineReplayEnabled);
				if (!this.isReplayEnabled()) {
					this.clearReplayState('replayDisabled');
				}
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

	isReplayEnabled(): boolean {
		return this._enabled && this._timelineReplayEnabled;
	}

	/**
	 * Produce a JSON-friendly snapshot of the prompt context for in-memory use.
	 * Strips host-bound objects (conversation, streams, documents).
	 */
	prunePromptContext(context: IBuildPromptContext): LiveRequestContextSnapshot {
		const prune = <T,>(value: T): T | undefined => {
			if (!value) {
				return undefined;
			}
			try {
				return JSON.parse(JSON.stringify(value)) as T;
			} catch {
				return undefined;
			}
		};

		return {
			requestId: context.requestId,
			query: context.query,
			history: prune(context.history),
			chatVariables: prune(context.chatVariables),
			workingSet: prune(context.workingSet),
			tools: prune(context.tools),
			toolCallRounds: prune(context.toolCallRounds),
			toolCallResults: prune(context.toolCallResults),
			toolGrouping: prune(context.toolGrouping),
			editedFileEvents: prune(context.editedFileEvents),
			isContinuation: context.isContinuation,
			modeInstructions: prune(context.modeInstructions),
		};
	}

	prepareRequest(init: EditableChatRequestInit): EditableChatRequest | undefined {
		if (!this._enabled) {
			this.removeRequest(init.sessionId, init.location);
			return undefined;
		}
		const request = buildEditableChatRequest(init);
		if (this._mode === 'autoOverride' && this._autoOverrideFeatureEnabled) {
			this.applyAutoOverridesForRequest(request);
		}
		this._requests.set(this.toKey(init.sessionId, init.location), request);
		this.pruneRequestCacheIfNeeded();
		this.schedulePersistRequestCache();
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

	getAllRequests(): readonly EditableChatRequest[] {
		if (!this._enabled) {
			return [];
		}
		return Array.from(this._requests.values());
	}

	getOriginalRequestMessages(key: LiveRequestSessionKey): Raw.ChatMessage[] | undefined {
		const request = this.getRequest(key);
		if (!request) {
			return undefined;
		}
		return deepClone(request.originalMessages);
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

	updateLeafByPath(key: LiveRequestSessionKey, targetPath: string, newValue: unknown): EditableChatRequest | undefined {
		return this.withRequest(key, request => this.applyLeafEdit(request, targetPath, newValue), true);
	}

	undoLastEdit(key: LiveRequestSessionKey): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			const history = request.editHistory;
			if (!history || !history.undoStack.length) {
				return false;
			}
			const op = history.undoStack.pop()!;
			this.applyLeafValue(request, op.targetPath, op.oldValue);
			history.redoStack.push(op);
			return true;
		}, true);
	}

	redoLastEdit(key: LiveRequestSessionKey): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			const history = request.editHistory;
			if (!history || !history.redoStack.length) {
				return false;
			}
			const op = history.redoStack.pop()!;
			this.applyLeafValue(request, op.targetPath, op.newValue);
			history.undoStack.push(op);
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
			request.editHistory = undefined;
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

	applyTraceData(key: LiveRequestSessionKey, trace: LiveRequestTraceSnapshot): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			let didChange = false;
			if (typeof trace.totalTokens === 'number' && trace.totalTokens >= 0) {
				request.metadata.tokenCount = trace.totalTokens;
				didChange = true;
			}

			for (let index = 0; index < trace.perMessage.length; index++) {
				const section = request.sections.find(candidate => candidate.sourceMessageIndex === index);
				if (!section) {
					continue;
				}
				const snapshot = trace.perMessage[index];
				if (typeof snapshot.tokenCount === 'number' && snapshot.tokenCount >= 0 && section.tokenCount !== snapshot.tokenCount) {
					section.tokenCount = snapshot.tokenCount;
					didChange = true;
				}
				if (snapshot.tracePath?.length) {
					const sanitizedPath = snapshot.tracePath.filter(segment => typeof segment === 'string' && segment.length);
					const hoverTitle = sanitizedPath.join(' › ');
					if (hoverTitle && hoverTitle !== section.hoverTitle) {
						section.hoverTitle = hoverTitle;
						didChange = true;
					}
					const metadata = section.metadata ? { ...section.metadata } : {};
					if (!equals(metadata.tracePath, sanitizedPath)) {
						metadata.tracePath = sanitizedPath;
						section.metadata = metadata;
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
			if (request.sessionSnapshot) {
				request.sessionSnapshot = {
					...request.sessionSnapshot,
					requestOptions: next
				};
			}
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
		const hadPendingIntercept = this._pendingIntercepts.size > 0;
		const previousMode = this._mode;
		this._mode = mode;
		if (mode === 'interceptOnce') {
			this._modeBeforeInterceptOnce = previousMode === 'interceptOnce' ? 'off' : previousMode;
		}
		this._autoOverrideCapturing = mode === 'autoOverride'
			&& this._autoOverrideFeatureEnabled
			&& (!this._autoOverrideHasOverrides || hadPendingIntercept);
		const shouldPersist = mode === 'interceptAlways';
		const previouslyPersisted = previousMode === 'interceptAlways';
		if (shouldPersist) {
			await this.updateInterceptionSetting(true);
		} else if (previouslyPersisted) {
			await this.updateInterceptionSetting(false);
		}
		// If interception is being turned off entirely, cancel any pending pauses.
		// Switching to Auto-apply with a pending intercept should preserve the pending turn
		// so edits can be saved instead of being discarded mid-transition.
		if (!this.isInterceptionEnabled() && (mode === 'off' || !hadPendingIntercept)) {
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
		const reason = event.reason ?? 'contextChanged';
		if (this._pendingIntercepts.size && this.isInterceptionEnabled()) {
			const pendingIntercepts = Array.from(this._pendingIntercepts.values());
			for (const pending of pendingIntercepts) {
				this.resolvePendingIntercept(pending.key, 'cancel', { reason });
			}
		}
		this.markReplayStale(event.key, undefined, reason);
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
		this.schedulePersistRequestCache();
		this._onDidChange.fire(request);
		this.emitMetadataForRequest(request);
		this.updateReplayMetadataFromRequest(request);
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
		if (!request) {
			return undefined;
		}
		const snapshot = this.buildMetadataSnapshot(request);
		request.metadata.lastUpdated = snapshot.lastUpdated;
		return snapshot;
	}

	buildReplayForRequest(key: LiveRequestSessionKey): LiveRequestReplaySnapshot | undefined {
		if (!this.isReplayEnabled()) {
			return undefined;
		}
		const request = this.getRequest(key);
		if (!request) {
			return undefined;
		}
		const replayKey = this.toReplayKey(request, key);
		const compositeKey = this.toReplayCompositeKey(replayKey);
		const sourceUpdatedAt = request.metadata.lastUpdated ?? request.metadata.createdAt ?? Date.now();
		const existing = this._replays.get(compositeKey);
		if (existing?.sourceUpdatedAt && existing.sourceUpdatedAt > sourceUpdatedAt) {
			return this.toReplaySnapshot(existing);
		}

		const sendResult = this.getMessagesForSend(key, request.messages);
		if (sendResult.error) {
			this.markReplayStale(key, replayKey.requestId, sendResult.error.code);
			return undefined;
		}

		const payload = deepClone(sendResult.messages);
		const projection = buildReplayProjection(request.sections, {
			cap: DEFAULT_REPLAY_SECTION_CAP,
			requestOptions: request.metadata.requestOptions,
			trimmed: this.wasPromptTrimmed(request)
		});

		if (!projection) {
			this.markReplayStale(key, replayKey.requestId, 'empty');
			return undefined;
		}

		const payloadHash = computeChatMessagesHash(payload);
		const projectionHash = computeReplayProjectionHash(projection);
		const nextVersion = (existing?.version ?? 0) + 1;
		if (existing) {
			this._replayRestoreBuffer.set(compositeKey, existing);
		}

		const entry: ReplayEntry = {
			key: replayKey,
			state: 'ready',
			version: nextVersion,
			updatedAt: Date.now(),
			payload,
			payloadHash,
			projection,
			projectionHash,
			parentSessionId: request.sessionId,
			parentTurnId: replayKey.requestId,
			debugName: request.debugName,
			model: request.model,
			intentId: request.metadata.intentId,
			requestCreatedAt: request.metadata.createdAt,
			requestLastUpdated: request.metadata.lastUpdated,
			lastLoggedHash: request.metadata.lastLoggedHash,
			lastLoggedMatches: request.metadata.lastLoggedMatches,
			sourceUpdatedAt,
		};

		this._replays.set(compositeKey, entry);
		const snapshot = this.toReplaySnapshot(entry);
		this._onDidChangeReplay.fire({ key: replayKey, replay: snapshot });
		return snapshot;
	}

	getReplaySnapshot(key: LiveRequestReplayKey): LiveRequestReplaySnapshot | undefined {
		const entry = this._replays.get(this.toReplayCompositeKey(key));
		return entry ? this.toReplaySnapshot(entry) : undefined;
	}

	restorePreviousReplay(key: LiveRequestReplayKey): LiveRequestReplaySnapshot | undefined {
		if (!this.isReplayEnabled()) {
			return undefined;
		}
		const compositeKey = this.toReplayCompositeKey(key);
		const previous = this._replayRestoreBuffer.get(compositeKey);
		if (!previous) {
			return undefined;
		}
		const current = this._replays.get(compositeKey);
		const nextVersion = (current?.version ?? previous.version ?? 0) + 1;
		const restored: ReplayEntry = {
			...previous,
			state: previous.state === 'stale' ? 'ready' : previous.state,
			version: nextVersion,
			updatedAt: Date.now(),
			restoreOfVersion: current?.version,
			staleReason: undefined,
		};
		if (current) {
			this._replayRestoreBuffer.set(compositeKey, current);
		} else {
			this._replayRestoreBuffer.delete(compositeKey);
		}
		this._replays.set(compositeKey, restored);
		const snapshot = this.toReplaySnapshot(restored);
		this._onDidChangeReplay.fire({ key, replay: snapshot });
		return snapshot;
	}

	markReplayForkActive(key: LiveRequestReplayKey, forkSessionId: string): LiveRequestReplaySnapshot | undefined {
		if (!this.isReplayEnabled()) {
			return undefined;
		}
		const compositeKey = this.toReplayCompositeKey(key);
		const entry = this._replays.get(compositeKey);
		if (!entry) {
			return undefined;
		}
		if (entry.state === 'stale') {
			return undefined;
		}
		const updated: ReplayEntry = {
			...entry,
			state: 'forkActive',
			version: entry.version + 1,
			updatedAt: Date.now(),
			forkSessionId,
			staleReason: undefined,
		};
		this._replays.set(compositeKey, updated);
		const snapshot = this.toReplaySnapshot(updated);
		this._onDidChangeReplay.fire({ key, replay: snapshot });
		return snapshot;
	}

	markReplayStale(key: LiveRequestSessionKey, requestId?: string, reason?: string): void {
		if (!this._replays.size) {
			return;
		}
		const restoreKeysToClear: string[] = [];
		for (const [compositeKey, entry] of Array.from(this._replays.entries())) {
			if (entry.key.sessionId !== key.sessionId || entry.key.location !== key.location) {
				continue;
			}
			if (requestId && entry.key.requestId !== requestId) {
				continue;
			}
			const updated: ReplayEntry = {
				...entry,
				state: 'stale',
				version: entry.version + 1,
				updatedAt: Date.now(),
				staleReason: reason ?? 'contextChanged',
			};
			this._replays.set(compositeKey, updated);
			const snapshot = this.toReplaySnapshot(updated);
			this._onDidChangeReplay.fire({ key: updated.key, replay: snapshot });
			restoreKeysToClear.push(compositeKey);
		}
		for (const compositeKey of restoreKeysToClear) {
			this._replayRestoreBuffer.delete(compositeKey);
		}
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
		request.metadata.lastUpdated = Date.now();
		if (recompute) {
			this.recomputeMessages(request);
		} else {
			request.isDirty = !equals(request.messages, request.originalMessages);
		}
		const validationError = this.validateRequestForSend(request);
		this.updateValidationMetadata(request, validationError);
		this.schedulePersistRequestCache();
		this._onDidChange.fire(request);
		this.emitMetadataForRequest(request);
		return request;
	}

	private applyLeafEdit(request: EditableChatRequest, targetPath: string, newValue: unknown): boolean {
		const normalizedPath = targetPath.trim();
		if (!normalizedPath.length) {
			return false;
		}

		// Resolve and apply the value first; capture the old value from the
		// container so we can record a reversible EditOp.
		const resolution = this.resolveLeafContainer(request, normalizedPath);
		if (!resolution) {
			return false;
		}

		const { container, key, currentValue } = resolution;
		const nextValue = this.coerceLeafValue(currentValue, newValue);
		if (equals(currentValue, nextValue)) {
			return false;
		}

		(container as Record<string | number, unknown>)[key] = nextValue;

		// Initialize edit history if needed.
		let history: EditHistory | undefined = request.editHistory;
		if (!history) {
			history = { undoStack: [], redoStack: [] };
			request.editHistory = history;
		}
		const previousVersion = history.undoStack.at(-1)?.id.version ?? 0;
		const targetKind = this.classifyTargetKind(normalizedPath);
		const op: EditOp = {
			id: {
				requestId: request.metadata.requestId ?? request.id,
				version: previousVersion + 1
			},
			targetKind,
			targetPath: normalizedPath,
			oldValue: deepClone(currentValue),
			newValue: deepClone(nextValue)
		};

		history.undoStack.push(op);
		history.redoStack.length = 0;
		return true;
	}

	private applyLeafValue(request: EditableChatRequest, targetPath: string, value: unknown): void {
		const resolution = this.resolveLeafContainer(request, targetPath);
		if (!resolution) {
			return;
		}
		const nextValue = this.coerceLeafValue(resolution.currentValue, value);
		(resolution.container as Record<string | number, unknown>)[resolution.key] = nextValue;
	}

	private classifyTargetKind(targetPath: string): EditTargetKind {
		if (targetPath.startsWith('requestOptions.')) {
			return 'requestOption';
		}
		if (targetPath.includes('.toolCalls[') && targetPath.endsWith('.function.arguments')) {
			return 'toolArguments';
		}
		if (targetPath.includes('.content[') && targetPath.endsWith('.text')) {
			return 'contentText';
		}
		return 'messageField';
	}

	private resolveLeafContainer(
		request: EditableChatRequest,
		targetPath: string
	): { container: unknown; key: string | number; currentValue: unknown } | undefined {
		const rootMatch = /^([a-zA-Z0-9_]+)(?:\[(\d+)\])?(?:\.|$)/.exec(targetPath);
		if (!rootMatch) {
			return undefined;
		}
		const rootName = rootMatch[1];
		const rootIndex = rootMatch[2] !== undefined ? Number(rootMatch[2]) : undefined;
		const rest = targetPath.slice(rootMatch[0].length);

		let container: unknown;

		if (rootName === 'messages') {
			if (rootIndex === undefined || Number.isNaN(rootIndex)) {
				return undefined;
			}
			const section = request.sections.find(candidate => candidate.sourceMessageIndex === rootIndex && !candidate.deleted);
			if (!section) {
				return undefined;
			}
			if (!section.message) {
				this.recomputeMessages(request);
			}
			const refreshed = request.sections.find(candidate => candidate.sourceMessageIndex === rootIndex && !candidate.deleted);
			if (!refreshed?.message) {
				return undefined;
			}
			container = refreshed.message;
		} else if (rootName === 'requestOptions') {
			if (!request.metadata.requestOptions) {
				request.metadata.requestOptions = {};
			}
			container = request.metadata.requestOptions;
		} else {
			// Unsupported root; no-op.
			return undefined;
		}

		if (!rest.length) {
			// Root-level leaf (e.g. "requestOptions"); editing entire object is out of scope.
			return undefined;
		}

		const segments = rest.split('.').filter(segment => segment.length);
		let current: unknown = container;
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];
			const match = /^([a-zA-Z0-9_]+)(?:\[(\d+)\])?$/.exec(segment);
			if (!match) {
				return undefined;
			}
			const prop = match[1];
			const index = match[2] !== undefined ? Number(match[2]) : undefined;

			if (i === segments.length - 1) {
				// Leaf segment: return container + key.
				if (index !== undefined) {
					const arrayContainer = (current as Record<string, unknown>)[prop];
					if (!Array.isArray(arrayContainer) || index < 0 || index >= arrayContainer.length) {
						return undefined;
					}
					return {
						container: arrayContainer,
						key: index,
						currentValue: arrayContainer[index]
					};
				}
				const objectContainer = current as Record<string, unknown>;
				return {
					container: objectContainer,
					key: prop,
					currentValue: objectContainer[prop]
				};
			}

			// Intermediate segment: descend into object / array.
			if (index !== undefined) {
				const arrayContainer = (current as Record<string, unknown>)[prop];
				if (!Array.isArray(arrayContainer) || index < 0 || index >= arrayContainer.length) {
					return undefined;
				}
				current = arrayContainer[index];
			} else {
				const objectContainer = current as Record<string, unknown>;
				const next = objectContainer[prop];
				if (next === undefined || next === null) {
					return undefined;
				}
				current = next;
			}
		}

		return undefined;
	}

	private coerceLeafValue(currentValue: unknown, newValue: unknown): unknown {
		if (typeof currentValue === 'number' && typeof newValue === 'string') {
			const parsed = Number(newValue);
			return Number.isNaN(parsed) ? newValue : parsed;
		}
		if (typeof currentValue === 'boolean' && typeof newValue === 'string') {
			if (newValue === 'true') {
				return true;
			}
			if (newValue === 'false') {
				return false;
			}
		}
		return newValue;
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

			let message: Raw.ChatMessage;
			if (section.message) {
				// Start from the last known message for this section so that
				// leaf-level edits (e.g. content parts, tool args) are preserved.
				message = deepClone(section.message);
			} else {
				const originalMessage = request.originalMessages[section.sourceMessageIndex];
				if (originalMessage) {
					message = deepClone(originalMessage);
				} else {
					message = this.createMessageShell(section.kind);
					isDirty = true;
				}
			}

			if (section.editedContent !== undefined) {
				// For legacy section-level edits (e.g., Auto-apply overrides),
				// treat the edited content as a single text payload while
				// preserving any non-text parts. Leaf-level edits use direct
				// field updates instead of this path.
				const existingParts = Array.isArray(message.content) ? message.content : [];
				const nonTextParts = existingParts.filter(part => {
					const candidate = part as { type?: unknown; text?: unknown };
					if (candidate.type === Raw.ChatCompletionContentPartKind.Text) {
						return false;
					}
					if (typeof candidate.text === 'string') {
						return false;
					}
					return true;
				});
				message.content = [
					{
						type: Raw.ChatCompletionContentPartKind.Text,
						text: section.editedContent
					},
					...nonTextParts
				];
				isDirty = true;
			}

			if (section.editedContent === undefined) {
				section.content = renderMessageContent(message);
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

	/**
	 * Attempt to re-render messages from a stored session snapshot. If unavailable or it fails,
	 * return undefined to signal fallback.
	 */
	private async renderFromSnapshot(request: EditableChatRequest, token: CancellationToken | undefined): Promise<Raw.ChatMessage[] | undefined> {
		if (!request.sessionSnapshot) {
			return undefined;
		}
		try {
			const endpoint = await this._endpointProvider.getChatEndpoint(request.sessionSnapshot.endpointModel);
			const props = {
				endpoint,
				promptContext: request.sessionSnapshot.promptContext,
				location: request.location,
				enableCacheBreakpoints: false,
				customizations: undefined,
				requestOptionsOverride: request.sessionSnapshot.requestOptions,
			};
			const rendered = await renderPromptElement(this._instantiationService, endpoint, AgentPrompt, props, undefined, token);
			return rendered.messages;
		} catch (error) {
			this._logService.warn(`LiveRequestEditor: snapshot render failed: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}

	/**
	 * Regenerate messages from the snapshot if available. Returns true on success.
	 */
	async regenerateFromSnapshot(key: LiveRequestSessionKey, token: CancellationToken | undefined): Promise<boolean> {
		const request = this.getRequest(key);
		if (!request || !request.sessionSnapshot) {
			return false;
		}
		const rendered = await this.renderFromSnapshot(request, token);
		if (!rendered || !rendered.length) {
			return false;
		}
		request.messages = deepClone(rendered);
		request.originalMessages = deepClone(rendered);
		request.sections = createSectionsFromMessages(request.messages);
		request.isDirty = true;
		this._onDidChange.fire(request);
		this.emitMetadataForRequest(request);
		return true;
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
		return computeChatMessagesHash(messages);
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
		this.markReplayStale({ sessionId: existing.sessionId, location: existing.location }, existing.metadata.requestId, 'requestRemoved');
		this._requests.delete(compositeKey);
		this.schedulePersistRequestCache();
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
		// Keep intercepted requests around for debugging (and persistence across restart).
		// A disposed chat session means we cannot continue sending/streaming for that session,
		// but the captured prompt state remains valuable to inspect.
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
		for (const compositeKey of Array.from(this._replayRestoreBuffer.keys())) {
			if (compositeKey.startsWith(sessionPrefix)) {
				this._replayRestoreBuffer.delete(compositeKey);
			}
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
		} catch (error) {
			this._logService.warn(`Live Request Editor: failed to persist interception setting (${String(error)}). Continuing with in-memory mode only.`);
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
		const lastUpdated = Date.now();
		request.metadata.lastUpdated = lastUpdated;
		this._onDidChangeMetadata.fire({
			key: { sessionId: request.sessionId, location: request.location },
			metadata: this.buildMetadataSnapshot(request, lastUpdated)
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

	private buildMetadataSnapshot(request: EditableChatRequest, lastUpdated?: number): LiveRequestMetadataSnapshot {
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
			lastUpdated: lastUpdated ?? Date.now(),
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

	private wasPromptTrimmed(request: EditableChatRequest): boolean | undefined {
		const tokenCount = this.getTokenCountForRequest(request);
		const maxPromptTokens = request.metadata.maxPromptTokens;
		if (typeof tokenCount === 'number' && typeof maxPromptTokens === 'number' && maxPromptTokens > 0) {
			return tokenCount > maxPromptTokens;
		}
		return undefined;
	}

	private toReplayKey(request: EditableChatRequest, key: LiveRequestSessionKey): LiveRequestReplayKey {
		return {
			sessionId: key.sessionId,
			location: key.location,
			requestId: request.metadata.requestId ?? request.id,
		};
	}

	private toReplayCompositeKey(key: LiveRequestReplayKey): string {
		return `${key.sessionId}::${key.location}::${key.requestId}`;
	}

	private toReplaySnapshot(entry: ReplayEntry): LiveRequestReplaySnapshot {
		return {
			key: entry.key,
			state: entry.state,
			version: entry.version,
			updatedAt: entry.updatedAt,
			payload: deepClone(entry.payload),
			payloadHash: entry.payloadHash,
			projection: entry.projection ? this.cloneReplayProjection(entry.projection) : undefined,
			projectionHash: entry.projectionHash,
			parentSessionId: entry.parentSessionId,
			parentTurnId: entry.parentTurnId,
			debugName: entry.debugName,
			model: entry.model,
			intentId: entry.intentId,
			requestCreatedAt: entry.requestCreatedAt,
			requestLastUpdated: entry.requestLastUpdated,
			lastLoggedHash: entry.lastLoggedHash,
			lastLoggedMatches: entry.lastLoggedMatches,
			forkSessionId: entry.forkSessionId,
			staleReason: entry.staleReason,
			restoreOfVersion: entry.restoreOfVersion,
		};
	}

	private cloneReplayProjection(projection: LiveRequestReplayProjection): LiveRequestReplayProjection {
		return {
			...projection,
			requestOptions: projection.requestOptions ? deepClone(projection.requestOptions) : undefined,
			sections: projection.sections.map(section => ({
				...section,
				message: section.message ? deepClone(section.message) : undefined,
				metadata: section.metadata ? { ...section.metadata } : undefined,
			}))
		};
	}

	private clearReplayState(reason: string): void {
		if (this._replays.size) {
			for (const [compositeKey, entry] of Array.from(this._replays.entries())) {
				const updated: ReplayEntry = {
					...entry,
					state: 'stale',
					version: entry.version + 1,
					updatedAt: Date.now(),
					staleReason: reason,
				};
				this._onDidChangeReplay.fire({ key: updated.key, replay: this.toReplaySnapshot(updated) });
				this._replays.set(compositeKey, updated);
			}
			this._replays.clear();
		}
		this._replayRestoreBuffer.clear();
	}

	private updateReplayMetadataFromRequest(request: EditableChatRequest): void {
		if (!this._replays.size) {
			return;
		}
		const requestId = request.metadata.requestId ?? request.id;
		for (const [compositeKey, entry] of Array.from(this._replays.entries())) {
			if (entry.parentSessionId !== request.sessionId || entry.parentTurnId !== requestId) {
				continue;
			}
			const updated: ReplayEntry = {
				...entry,
				version: entry.version + 1,
				updatedAt: Date.now(),
				requestLastUpdated: request.metadata.lastUpdated,
				lastLoggedHash: request.metadata.lastLoggedHash,
				lastLoggedMatches: request.metadata.lastLoggedMatches,
			};
			this._replays.set(compositeKey, updated);
			this._onDidChangeReplay.fire({ key: updated.key, replay: this.toReplaySnapshot(updated) });
		}
	}

	private schedulePersistRequestCache(): void {
		if (!this._enabled) {
			return;
		}
		this._persistRequestsScheduler.schedule();
	}

	private pruneRequestCacheIfNeeded(): void {
		if (this._requests.size <= MAX_PERSISTED_REQUESTS) {
			return;
		}
		const entries = Array.from(this._requests.entries())
			.map(([key, request]) => ({ key, ts: this.getRequestTimestamp(request) }))
			.sort((a, b) => b.ts - a.ts);
		const keep = new Set(entries.slice(0, MAX_PERSISTED_REQUESTS).map(entry => entry.key));
		for (const key of Array.from(this._requests.keys())) {
			if (!keep.has(key)) {
				this.removeRequestByCompositeKey(key);
			}
		}
	}

	private restoreRequestCache(): void {
		if (!this._enabled) {
			return;
		}
		const payload = this._extensionContext.workspaceState.get<PersistedRequestCacheV1 | undefined>(WORKSPACE_REQUEST_CACHE_KEY);
		if (!payload || payload.version !== 1 || !Array.isArray(payload.requests) || !payload.requests.length) {
			return;
		}

		const candidates: EditableChatRequest[] = [];
		for (const entry of payload.requests) {
			if (!this.isValidPersistedRequest(entry)) {
				continue;
			}
			candidates.push(deepClone(entry));
		}

		if (!candidates.length) {
			return;
		}

		candidates.sort((a, b) => this.getRequestTimestamp(b) - this.getRequestTimestamp(a));
		for (const request of candidates.slice(0, MAX_PERSISTED_REQUESTS)) {
			this._requests.set(this.toKey(request.sessionId, request.location), request);
		}
	}

	private async persistRequestCache(): Promise<void> {
		if (!this._enabled) {
			return;
		}
		try {
			const requests = Array.from(this._requests.values());
			if (!requests.length) {
				await this._extensionContext.workspaceState.update(WORKSPACE_REQUEST_CACHE_KEY, undefined);
				return;
			}
			const pruned = requests
				.slice()
				.sort((a, b) => this.getRequestTimestamp(b) - this.getRequestTimestamp(a))
				.slice(0, MAX_PERSISTED_REQUESTS)
				.map(request => {
					const clone = deepClone(request);
					// Session snapshots may carry non-serializable objects (Conversation, streams, etc.);
					// they are for in-memory regeneration only. Drop them before persisting.
					if (clone.sessionSnapshot) {
						delete (clone as { sessionSnapshot?: unknown }).sessionSnapshot;
					}
					return clone;
				});
			const payload: PersistedRequestCacheV1 = {
				version: 1,
				updatedAt: Date.now(),
				requests: pruned
			};
			await this._extensionContext.workspaceState.update(WORKSPACE_REQUEST_CACHE_KEY, payload);
		} catch (error) {
			this._logService.error('LiveRequestEditorService: failed to persist request cache', error);
		}
	}

	private isValidPersistedRequest(value: unknown): value is EditableChatRequest {
		if (!value || typeof value !== 'object') {
			return false;
		}
		const candidate = value as Partial<EditableChatRequest>;
		return typeof candidate.sessionId === 'string'
			&& candidate.sessionId.length > 0
			&& typeof candidate.location === 'number'
			&& Array.isArray(candidate.messages)
			&& Array.isArray(candidate.sections)
			&& Array.isArray(candidate.originalMessages)
			&& !!candidate.metadata
			&& typeof (candidate.metadata as { requestId?: unknown }).requestId === 'string'
			&& typeof (candidate.metadata as { createdAt?: unknown }).createdAt === 'number';
	}

	private getRequestTimestamp(request: EditableChatRequest): number {
		return request.metadata?.lastUpdated ?? request.metadata?.createdAt ?? 0;
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
