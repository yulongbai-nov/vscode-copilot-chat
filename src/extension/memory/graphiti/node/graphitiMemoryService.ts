/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { IGitService } from '../../../../platform/git/common/gitService';
import { ILogService } from '../../../../platform/log/common/logService';
import { IFetcherService } from '../../../../platform/networking/common/fetcherService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { IWorkspaceTrustService } from '../../../../platform/workspace/common/workspaceTrustService';
import { createServiceIdentifier } from '../../../../util/common/services';
import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import { GraphitiWorkspaceConsentStorageKey, isGraphitiConsentRecord } from '../common/graphitiConsent';
import { getGraphitiActorIdentityFromGitHubSession, getGraphitiUserScopeKeyFromGitHubSession } from '../common/graphitiIdentity';
import { normalizeGraphitiEndpoint } from '../common/graphitiEndpoint';
import { GraphitiUserScopeKeyStorageKey } from '../common/graphitiStorageKeys';
import { GraphitiClient } from './graphitiClient';
import { computeGraphitiGroupId } from './graphitiGroupIds';
import { GraphitiIngestionQueue } from './graphitiIngestionQueue';
import { mapChatTurnToGraphitiMessages, truncateForGraphiti } from './graphitiMessageMapping';
import { looksLikeSecretForAutoPromotion, parseGraphitiMemoryDirectives } from './graphitiMemoryDirectives';
import { formatGraphitiOwnershipContextEpisode } from './graphitiOwnershipContext';
import { formatGraphitiPromotionEpisode } from './graphitiPromotionTemplates';
import { generateUuid } from '../../../../util/vs/base/common/uuid';
import { computeGraphitiWorkspaceScopeKeys } from './graphitiScopeKeys';

export const IGraphitiMemoryService = createServiceIdentifier<IGraphitiMemoryService>('IGraphitiMemoryService');

export interface GraphitiConversationTurnForIngestion {
	readonly turnId: string;
	readonly userMessage: string;
	readonly assistantMessage: string;
	readonly timestampMs: number;
}

export interface IGraphitiMemoryService {
	readonly _serviceBrand: undefined;
	enqueueConversationSnapshot(sessionId: string, turns: readonly GraphitiConversationTurnForIngestion[]): void;
}

type ResolvedGraphitiIngestionConfig = {
	readonly endpoint: string;
	readonly timeoutMs: number;
	readonly maxBatchSize: number;
	readonly maxQueueSize: number;
	readonly maxMessageChars: number;
	readonly scopes: 'session' | 'workspace' | 'both';
	readonly groupIdStrategy: 'raw' | 'hashed';
	readonly includeSystemMessages: boolean;
	readonly includeGitMetadata: boolean;
	readonly autoPromoteEnabled: boolean;
};

const FLUSH_DELAY_MS = 250;
const BACKFILL_DELAY_MS = 250;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

const MAX_BACKFILL_TURNS_PER_TICK = 25;
const MAX_SEEN_TURNS_PER_GROUP = 500;
const MAX_SEEN_GROUPS = 50;

const OWNERSHIP_CONTEXT_TURN_ID = 'copilotchat.graphiti.ownership_context.v1';
const AUTO_PROMOTION_ID_PREFIX = 'copilotchat.graphiti.auto_promotion.v1';

type PendingBackfillState = {
	turns: readonly GraphitiConversationTurnForIngestion[];
	cursor: number;
};

class LruSet {
	private readonly _map = new Map<string, true>();

	constructor(private readonly _maxSize: number) { }

	has(key: string): boolean {
		return this._map.has(key);
	}

	add(key: string): void {
		if (this._map.has(key)) {
			this._map.delete(key);
		}
		this._map.set(key, true);

		while (this._map.size > this._maxSize) {
			const oldest = this._map.keys().next().value as string | undefined;
			if (oldest === undefined) {
				return;
			}
			this._map.delete(oldest);
		}
	}

	clear(): void {
		this._map.clear();
	}
}

export class GraphitiMemoryService extends Disposable implements IGraphitiMemoryService {
	declare readonly _serviceBrand: undefined;

	private readonly _queue = new GraphitiIngestionQueue();
	private readonly _seenTurnsByGroupId = new Map<string, LruSet>();
	private readonly _pendingBackfillBySessionId = new Map<string, PendingBackfillState>();

	private _flushTimer: ReturnType<typeof setTimeout> | undefined;
	private _retryTimer: ReturnType<typeof setTimeout> | undefined;
	private _flushInProgress = false;
	private _flushRequested = false;
	private _backoffMs = INITIAL_BACKOFF_MS;

	private _backfillTimer: ReturnType<typeof setTimeout> | undefined;

	private _clientEndpoint: string | undefined;
	private _client: GraphitiClient | undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IWorkspaceTrustService private readonly _workspaceTrustService: IWorkspaceTrustService,
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@IGitService private readonly _gitService: IGitService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(ConfigKey.MemoryGraphitiEnabled.fullyQualifiedId)
				|| e.affectsConfiguration(ConfigKey.MemoryGraphitiEndpoint.fullyQualifiedId)
				|| e.affectsConfiguration(ConfigKey.MemoryGraphitiScopes.fullyQualifiedId)
				|| e.affectsConfiguration(ConfigKey.MemoryGraphitiMaxBatchSize.fullyQualifiedId)
				|| e.affectsConfiguration(ConfigKey.MemoryGraphitiMaxQueueSize.fullyQualifiedId)
				|| e.affectsConfiguration(ConfigKey.MemoryGraphitiGroupIdStrategy.fullyQualifiedId)
				|| e.affectsConfiguration(ConfigKey.MemoryGraphitiIncludeSystemMessages.fullyQualifiedId)
				|| e.affectsConfiguration(ConfigKey.MemoryGraphitiIncludeGitMetadata.fullyQualifiedId)
				|| e.affectsConfiguration(ConfigKey.MemoryGraphitiAutoPromoteEnabled.fullyQualifiedId)
			) {
				this.clearQueueAndTimers();
			}
		}));
	}

	override dispose(): void {
		this.clearQueueAndTimers();
		super.dispose();
	}

	enqueueConversationSnapshot(sessionId: string, turns: readonly GraphitiConversationTurnForIngestion[]): void {
		try {
			const config = this.resolveIngestionConfig();
			if (!config) {
				return;
			}

			const latestTurn = turns.at(-1);
			if (!latestTurn) {
				return;
			}

			const git = config.includeGitMetadata ? this.tryReadGitMetadata() : undefined;
			const targets = this.getTargetGroups(config, sessionId);

			this.enqueueTurnToTargets(config, targets, latestTurn, git);
			this.maybeEnqueueAutoPromotionDirectives(config, latestTurn, git);

			const existing = this._pendingBackfillBySessionId.get(sessionId);
			const cursor = existing ? Math.min(existing.cursor, turns.length) : 0;
			this._pendingBackfillBySessionId.set(sessionId, { turns, cursor });
			this.scheduleBackfill();
		} catch (err) {
			this._logService.error(err as Error, 'Graphiti ingestion enqueue failed');
		}
	}

	private enqueueTurnToTargets(
		config: ResolvedGraphitiIngestionConfig,
		targets: ReadonlyArray<{ scope: 'session' | 'workspace'; groupId: string }>,
		turn: GraphitiConversationTurnForIngestion,
		git: { branch?: string; commit?: string; dirty?: boolean } | undefined,
	): void {
		const timestamp = new Date(turn.timestampMs);

		for (const target of targets) {
			const groupId = target.groupId;
			const seen = this.getSeenTurnsForGroup(groupId);

			this.maybeEnqueueOwnershipContext(config, target.scope, groupId, seen, timestamp, git);

			if (seen.has(turn.turnId)) {
				continue;
			}
			seen.add(turn.turnId);

			const sourceDescription = config.includeGitMetadata
				? JSON.stringify({ source: 'copilotchat', scope: target.scope, ...(git ? { git } : {}) })
				: undefined;

			const messages = mapChatTurnToGraphitiMessages({
				turnId: turn.turnId,
				userMessage: turn.userMessage,
				assistantMessage: turn.assistantMessage,
				timestamp,
				maxMessageChars: config.maxMessageChars,
				sourceDescription,
			});

			const { droppedCount } = this._queue.enqueue(groupId, messages, config.maxQueueSize);
			if (droppedCount > 0) {
				this._logService.warn(`Graphiti ingestion queue full; dropped ${droppedCount} queued message(s).`);
			}
		}

		this._logService.trace(`Graphiti ingestion queued message(s); pending=${this._queue.size}.`);
		this.scheduleFlush();
	}

	private maybeEnqueueOwnershipContext(
		config: ResolvedGraphitiIngestionConfig,
		scope: 'session' | 'workspace' | 'user',
		groupId: string,
		seen: LruSet,
		now: Date,
		git: { branch?: string; commit?: string; dirty?: boolean } | undefined,
	): void {
		if (!config.includeSystemMessages) {
			return;
		}

		if (seen.has(OWNERSHIP_CONTEXT_TURN_ID)) {
			return;
		}
		seen.add(OWNERSHIP_CONTEXT_TURN_ID);

		const owner = getGraphitiActorIdentityFromGitHubSession(this._authenticationService.anyGitHubSession);
		const workspaceFolderBasenames = this.getWorkspaceFolderBasenames();

		const content = formatGraphitiOwnershipContextEpisode({
			scope,
			owner,
			workspaceFolderBasenames,
			git: config.includeGitMetadata ? git : undefined,
			now,
		});

		const sourceDescription = config.includeGitMetadata
			? JSON.stringify({ source: 'copilotchat', event: 'ownership_context', scope, ...(git ? { git } : {}) })
			: undefined;

		const sourceDescriptionFields = sourceDescription ? { source_description: sourceDescription } : {};
		const message = {
			role_type: 'system' as const,
			role: 'system',
			name: `copilotchat.ownership_context.${scope}`,
			content,
			timestamp: now.toISOString(),
			...sourceDescriptionFields,
		};

		const { droppedCount } = this._queue.enqueue(groupId, [message], config.maxQueueSize);
		if (droppedCount > 0) {
			this._logService.warn(`Graphiti ingestion queue full; dropped ${droppedCount} queued message(s).`);
		}
	}

	private maybeEnqueueAutoPromotionDirectives(
		config: ResolvedGraphitiIngestionConfig,
		turn: GraphitiConversationTurnForIngestion,
		git: { branch?: string; commit?: string; dirty?: boolean } | undefined,
	): void {
		if (!config.autoPromoteEnabled) {
			return;
		}

		const directives = parseGraphitiMemoryDirectives(turn.userMessage);
		if (!directives.length) {
			return;
		}

		const now = new Date(turn.timestampMs);
		const timestamp = now.toISOString();
		const groupIdStrategy = config.groupIdStrategy;
		const includeGitMetadata = config.includeGitMetadata;

		const workspaceKeys = computeGraphitiWorkspaceScopeKeys({ gitService: this._gitService, workspaceService: this._workspaceService });
		const workspaceGroupId = computeGraphitiGroupId('workspace', groupIdStrategy, workspaceKeys.primary);

		let userGroupId: string | undefined;
		const getUserGroupId = (): string => {
			if (userGroupId) {
				return userGroupId;
			}

			const identityUserScopeKey = getGraphitiUserScopeKeyFromGitHubSession(this._authenticationService.anyGitHubSession);
			let userScopeKey = identityUserScopeKey;
			if (!userScopeKey) {
				userScopeKey = this._extensionContext.globalState.get<string>(GraphitiUserScopeKeyStorageKey);
				if (!userScopeKey) {
					userScopeKey = generateUuid();
					void this._extensionContext.globalState.update(GraphitiUserScopeKeyStorageKey, userScopeKey);
				}
			}
			userGroupId = computeGraphitiGroupId('user', groupIdStrategy, userScopeKey);
			return userGroupId;
		};

		for (let i = 0; i < directives.length; i++) {
			const directive = directives[i];
			if (looksLikeSecretForAutoPromotion(directive.content)) {
				this._logService.debug(`Graphiti auto-promotion skipped (possible secret): kind=${directive.kind} scope=${directive.scope}`);
				continue;
			}

			const groupId = directive.scope === 'user' ? getUserGroupId() : workspaceGroupId;
			const seen = this.getSeenTurnsForGroup(groupId);

			const autoPromotionId = `${AUTO_PROMOTION_ID_PREFIX}:${turn.turnId}:${i}:${directive.scope}:${directive.kind}`;
			if (seen.has(autoPromotionId)) {
				continue;
			}

			const needsOwnershipContext = config.includeSystemMessages && !seen.has(OWNERSHIP_CONTEXT_TURN_ID);
			const requiredMessages = 1 + (needsOwnershipContext ? 1 : 0);
			if (this._queue.size + requiredMessages > config.maxQueueSize) {
				this._logService.debug('Graphiti ingestion queue near capacity; skipping auto-promotion directive.');
				continue;
			}

			if (needsOwnershipContext) {
				this.maybeEnqueueOwnershipContext(config, directive.scope, groupId, seen, now, git);
			}

			const base = formatGraphitiPromotionEpisode(directive.kind, directive.scope, '', now);
			const budget = Math.max(0, config.maxMessageChars - base.length);
			const truncatedText = truncateForGraphiti(directive.content, budget);
			const content = formatGraphitiPromotionEpisode(directive.kind, directive.scope, truncatedText, now);

			const sourceDescription = includeGitMetadata
				? JSON.stringify({ source: 'copilotchat', event: 'auto_promotion', scope: directive.scope, kind: directive.kind, turnId: turn.turnId, ...(git ? { git } : {}) })
				: `copilot-chat:auto_promotion:${directive.scope}:${directive.kind}`;

			const message = {
				role_type: 'system' as const,
				role: 'system',
				name: `copilotchat.auto_promotion.${turn.turnId}.${i}`,
				content,
				timestamp,
				source_description: sourceDescription,
			};

			seen.add(autoPromotionId);
			const { droppedCount } = this._queue.enqueue(groupId, [message], config.maxQueueSize);
			if (droppedCount > 0) {
				this._logService.warn(`Graphiti ingestion queue full; dropped ${droppedCount} queued message(s).`);
			}
		}
	}

	private getWorkspaceFolderBasenames(): string[] {
		const basenames: string[] = [];
		for (const folder of this._workspaceService.getWorkspaceFolders()) {
			const path = folder.path ?? '';
			const parts = path.split('/').filter(Boolean);
			const name = parts.at(-1) ?? '';
			if (name) {
				basenames.push(name);
			}
		}
		return basenames;
	}

	private getSeenTurnsForGroup(groupId: string): LruSet {
		const existing = this._seenTurnsByGroupId.get(groupId);
		if (existing) {
			// Refresh LRU ordering for group tracking.
			this._seenTurnsByGroupId.delete(groupId);
			this._seenTurnsByGroupId.set(groupId, existing);
			return existing;
		}

		const created = new LruSet(MAX_SEEN_TURNS_PER_GROUP);
		this._seenTurnsByGroupId.set(groupId, created);

		while (this._seenTurnsByGroupId.size > MAX_SEEN_GROUPS) {
			const oldestGroup = this._seenTurnsByGroupId.keys().next().value as string | undefined;
			if (oldestGroup === undefined) {
				break;
			}
			this._seenTurnsByGroupId.delete(oldestGroup);
		}

		return created;
	}

	private resolveIngestionConfig(): ResolvedGraphitiIngestionConfig | undefined {
		if (!this._configurationService.getConfig(ConfigKey.MemoryGraphitiEnabled)) {
			return undefined;
		}

		if (!this._workspaceTrustService.isTrusted) {
			return undefined;
		}

		const endpoint = normalizeGraphitiEndpoint(this._configurationService.getConfig(ConfigKey.MemoryGraphitiEndpoint));
		if (!endpoint) {
			return undefined;
		}

		const consentValue = this._extensionContext.workspaceState.get(GraphitiWorkspaceConsentStorageKey);
		const consentRecord = isGraphitiConsentRecord(consentValue) ? consentValue : undefined;
		if (consentRecord?.endpoint !== endpoint) {
			return undefined;
		}

		return {
			endpoint,
			timeoutMs: this._configurationService.getConfig(ConfigKey.MemoryGraphitiTimeoutMs),
			maxBatchSize: this._configurationService.getConfig(ConfigKey.MemoryGraphitiMaxBatchSize),
			maxQueueSize: this._configurationService.getConfig(ConfigKey.MemoryGraphitiMaxQueueSize),
			maxMessageChars: this._configurationService.getConfig(ConfigKey.MemoryGraphitiMaxMessageChars),
			scopes: this._configurationService.getConfig(ConfigKey.MemoryGraphitiScopes),
			groupIdStrategy: this._configurationService.getConfig(ConfigKey.MemoryGraphitiGroupIdStrategy),
			includeSystemMessages: this._configurationService.getConfig(ConfigKey.MemoryGraphitiIncludeSystemMessages),
			includeGitMetadata: this._configurationService.getConfig(ConfigKey.MemoryGraphitiIncludeGitMetadata),
			autoPromoteEnabled: this._configurationService.getConfig(ConfigKey.MemoryGraphitiAutoPromoteEnabled),
		};
	}

	private getTargetGroups(config: ResolvedGraphitiIngestionConfig, sessionId: string): ReadonlyArray<{ scope: 'session' | 'workspace'; groupId: string }> {
		const targets: Array<{ scope: 'session' | 'workspace'; groupId: string }> = [];

		if (config.scopes === 'session' || config.scopes === 'both') {
			targets.push({ scope: 'session', groupId: computeGraphitiGroupId('session', config.groupIdStrategy, `copilotchat_session:${sessionId}`) });
		}

		if (config.scopes === 'workspace' || config.scopes === 'both') {
			const workspaceKeys = computeGraphitiWorkspaceScopeKeys({ gitService: this._gitService, workspaceService: this._workspaceService });
			targets.push({ scope: 'workspace', groupId: computeGraphitiGroupId('workspace', config.groupIdStrategy, workspaceKeys.primary) });
		}

		return targets;
	}

	private tryReadGitMetadata(): { branch?: string; commit?: string; dirty?: boolean } | undefined {
		try {
			const repo = this._gitService.activeRepository.get() ?? this._gitService.repositories[0];
			if (!repo) {
				return undefined;
			}

			const branch = repo.headBranchName || undefined;
			const commit = repo.headCommitHash || undefined;
			const changes = repo.changes;
			const dirty = changes
				? (changes.workingTree.length + changes.indexChanges.length + changes.mergeChanges.length + changes.untrackedChanges.length) > 0
				: undefined;

			if (!branch && !commit && dirty === undefined) {
				return undefined;
			}

			return { branch, commit, dirty };
		} catch {
			return undefined;
		}
	}

	private getOrCreateClient(config: ResolvedGraphitiIngestionConfig): GraphitiClient {
		if (!this._client || this._clientEndpoint !== config.endpoint) {
			this._clientEndpoint = config.endpoint;
			this._client = new GraphitiClient(this._fetcherService, this._logService, {
				endpoint: config.endpoint,
				timeoutMs: config.timeoutMs,
			});
		}
		return this._client;
	}

	private scheduleFlush(): void {
		if (this._retryTimer || this._flushTimer) {
			return;
		}

		if (this._flushInProgress) {
			this._flushRequested = true;
			return;
		}

		this._flushTimer = setTimeout(() => {
			this._flushTimer = undefined;
			void this.flushQueue();
		}, FLUSH_DELAY_MS);
	}

	private async flushQueue(): Promise<void> {
		if (this._flushInProgress) {
			return;
		}

		const config = this.resolveIngestionConfig();
		if (!config) {
			this.clearQueueAndTimers();
			return;
		}

		this._flushInProgress = true;
		this._flushRequested = false;
		try {
			const client = this.getOrCreateClient(config);
			while (this._queue.size > 0) {
				const batch = this._queue.takeBatch(config.maxBatchSize);
				if (!batch) {
					break;
				}

				try {
					const res = await client.addMessages(batch.groupId, batch.messages);
					if (!res.success) {
						throw new Error(res.message);
					}
					this._logService.trace(`Graphiti ingestion flushed ${batch.messages.length} message(s); pending=${this._queue.size}.`);
				} catch (err) {
					this._queue.requeueBatch(batch);
					this._logService.warn(`Graphiti ingestion request failed; will retry with backoff (${this._backoffMs}ms).`);
					this.scheduleRetry();
					return;
				}
			}

			this._backoffMs = INITIAL_BACKOFF_MS;
		} finally {
			this._flushInProgress = false;

			if (this._flushRequested && !this._retryTimer && this._queue.size > 0) {
				this._flushRequested = false;
				this.scheduleFlush();
			}
		}
	}

	private scheduleRetry(): void {
		if (this._retryTimer) {
			return;
		}

		this._retryTimer = setTimeout(() => {
			this._retryTimer = undefined;
			void this.flushQueue();
		}, this._backoffMs);

		this._backoffMs = Math.min(this._backoffMs * 2, MAX_BACKOFF_MS);
	}

	private clearQueueAndTimers(): void {
		this._queue.clear();
		this._pendingBackfillBySessionId.clear();
		this._seenTurnsByGroupId.clear();

		if (this._flushTimer) {
			clearTimeout(this._flushTimer);
			this._flushTimer = undefined;
		}
		if (this._retryTimer) {
			clearTimeout(this._retryTimer);
			this._retryTimer = undefined;
		}
		if (this._backfillTimer) {
			clearTimeout(this._backfillTimer);
			this._backfillTimer = undefined;
		}

		this._flushInProgress = false;
		this._flushRequested = false;
		this._backoffMs = INITIAL_BACKOFF_MS;
	}

	private scheduleBackfill(): void {
		if (this._backfillTimer || this._pendingBackfillBySessionId.size === 0) {
			return;
		}

		this._backfillTimer = setTimeout(() => {
			this._backfillTimer = undefined;
			this.processBackfill();
		}, BACKFILL_DELAY_MS);
	}

	private processBackfill(): void {
		const config = this.resolveIngestionConfig();
		if (!config) {
			this._pendingBackfillBySessionId.clear();
			return;
		}

		if (this._retryTimer) {
			this.scheduleBackfill();
			return;
		}

		const git = config.includeGitMetadata ? this.tryReadGitMetadata() : undefined;
		let didEnqueue = false;

		for (const [sessionId, state] of this._pendingBackfillBySessionId) {
			const targets = this.getTargetGroups(config, sessionId);
			const targetsWithSeen = targets.map(target => ({ target, seen: this.getSeenTurnsForGroup(target.groupId) }));

			let turnsEnqueuedThisTick = 0;
			while (state.cursor < state.turns.length && turnsEnqueuedThisTick < MAX_BACKFILL_TURNS_PER_TICK) {
				const turn = state.turns[state.cursor];
				const missing = targetsWithSeen.filter(({ seen }) => !seen.has(turn.turnId));
				if (missing.length === 0) {
					state.cursor++;
					continue;
				}

				let requiredMessages = 2 * missing.length;
				if (config.includeSystemMessages) {
					for (const { seen } of missing) {
						if (!seen.has(OWNERSHIP_CONTEXT_TURN_ID)) {
							requiredMessages += 1;
						}
					}
				}
				if (this._queue.size + requiredMessages > config.maxQueueSize) {
					break;
				}

				for (const { target, seen } of missing) {
					this.maybeEnqueueOwnershipContext(config, target.scope, target.groupId, seen, new Date(turn.timestampMs), git);
					seen.add(turn.turnId);

					const sourceDescription = config.includeGitMetadata
						? JSON.stringify({ source: 'copilotchat', scope: target.scope, ...(git ? { git } : {}) })
						: undefined;

					const messages = mapChatTurnToGraphitiMessages({
						turnId: turn.turnId,
						userMessage: turn.userMessage,
						assistantMessage: turn.assistantMessage,
						timestamp: new Date(turn.timestampMs),
						maxMessageChars: config.maxMessageChars,
						sourceDescription,
					});

					this._queue.enqueue(target.groupId, messages, config.maxQueueSize);
				}

				this.maybeEnqueueAutoPromotionDirectives(config, turn, git);

				didEnqueue = true;
				turnsEnqueuedThisTick++;
				state.cursor++;
			}

			if (state.cursor >= state.turns.length) {
				this._pendingBackfillBySessionId.delete(sessionId);
			}

			if (this._queue.size >= config.maxQueueSize) {
				break;
			}
		}

		if (didEnqueue) {
			this._logService.trace(`Graphiti backfill queued message(s); pending=${this._queue.size}.`);
			this.scheduleFlush();
		}

		if (this._pendingBackfillBySessionId.size > 0) {
			this.scheduleBackfill();
		}
	}
}
