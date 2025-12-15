/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { IGitService } from '../../../../platform/git/common/gitService';
import { ILogService } from '../../../../platform/log/common/logService';
import { IFetcherService } from '../../../../platform/networking/common/fetcherService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { IWorkspaceTrustService } from '../../../../platform/workspace/common/workspaceTrustService';
import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../../../util/vs/base/common/uuid';
import { GraphitiClient } from '../node/graphitiClient';
import { getGraphitiUserScopeKeyFromGitHubSession } from '../common/graphitiIdentity';
import { computeGraphitiGroupId } from '../node/graphitiGroupIds';
import { computeGraphitiWorkspaceScopeKeys } from '../node/graphitiScopeKeys';
import { formatGraphitiPromotionEpisode, GraphitiPromotionKind, GraphitiPromotionScope } from '../node/graphitiPromotionTemplates';
import { GraphitiWorkspaceConsentStorageKey, isGraphitiConsentRecord } from '../common/graphitiConsent';
import { normalizeGraphitiEndpoint } from '../common/graphitiEndpoint';
import { GraphitiMessage } from '../node/graphitiTypes';
import { GraphitiUserScopeKeyStorageKey } from '../common/graphitiStorageKeys';

const OUTPUT_CHANNEL_NAME = 'GitHub Copilot Chat: Graphiti Memory';

export class GraphitiMemoryContribution extends Disposable {
	private _pendingConsentFlow: Promise<void> | undefined;
	private readonly _outputChannel = this._register(vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME));

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

		this._register(vscode.commands.registerCommand('github.copilot.chat.memory.graphiti.testConnection', () => this.testConnectionCommand()));
		this._register(vscode.commands.registerCommand('github.copilot.chat.memory.graphiti.promoteToMemory', () => this.promoteToMemoryCommand()));

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ConfigKey.MemoryGraphitiEnabled.fullyQualifiedId) || e.affectsConfiguration(ConfigKey.MemoryGraphitiEndpoint.fullyQualifiedId)) {
				void this.maybeRunConsentFlow('configChanged');
			}
		}));

		this._register(this._workspaceTrustService.onDidGrantWorkspaceTrust(() => {
			void this.maybeRunConsentFlow('workspaceTrusted');
		}));

		void this.maybeRunConsentFlow('startup');
	}

	private async maybeRunConsentFlow(trigger: 'startup' | 'configChanged' | 'workspaceTrusted'): Promise<void> {
		if (this._pendingConsentFlow) {
			return this._pendingConsentFlow;
		}

		this._pendingConsentFlow = this.runConsentFlow(trigger).finally(() => {
			this._pendingConsentFlow = undefined;
		});

		return this._pendingConsentFlow;
	}

	private async runConsentFlow(trigger: 'startup' | 'configChanged' | 'workspaceTrusted'): Promise<void> {
		if (!this._configurationService.getConfig(ConfigKey.MemoryGraphitiEnabled)) {
			return;
		}

		if (!this._workspaceTrustService.isTrusted) {
			if (trigger !== 'startup') {
				vscode.window.showWarningMessage(l10n.t('Graphiti memory integration requires a trusted workspace.'));
			}
			return;
		}

		const endpointRaw = this._configurationService.getConfig(ConfigKey.MemoryGraphitiEndpoint);
		const normalizedEndpoint = normalizeGraphitiEndpoint(endpointRaw);
		if (!normalizedEndpoint) {
			vscode.window.showErrorMessage(l10n.t('Graphiti endpoint is not set or invalid. Configure {0} and try again.', ConfigKey.MemoryGraphitiEndpoint.fullyQualifiedId));
			return;
		}

		const consentValue = this._extensionContext.workspaceState.get(GraphitiWorkspaceConsentStorageKey);
		const consentRecord = isGraphitiConsentRecord(consentValue) ? consentValue : undefined;
		if (consentRecord?.endpoint === normalizedEndpoint) {
			return;
		}

		const allowLabel = l10n.t('Allow');
		const cancelLabel = l10n.t('Cancel');
		const includeSystemMessages = this._configurationService.getConfig(ConfigKey.MemoryGraphitiIncludeSystemMessages);
		const includeGitMetadata = this._configurationService.getConfig(ConfigKey.MemoryGraphitiIncludeGitMetadata);
		const extras: string[] = [];
		if (includeSystemMessages) {
			extras.push(l10n.t('system/context messages'));
		}
		if (includeGitMetadata) {
			extras.push(l10n.t('git metadata'));
		}
		const extrasSuffix = extras.length ? l10n.t(' and {0}', extras.join(' + ')) : '';
		const choice = await vscode.window.showWarningMessage(
			l10n.t('Enable Graphiti memory integration?'),
			{
				modal: true,
				detail: l10n.t('This will send chat text (user + assistant){0} to: {1}', extrasSuffix, normalizedEndpoint),
			},
			allowLabel,
			cancelLabel,
		);

		if (choice !== allowLabel) {
			this._logService.info(`Graphiti consent declined; disabling integration for this workspace.`);
			await this._configurationService.setConfig(ConfigKey.MemoryGraphitiEnabled, false);
			return;
		}

		await this._extensionContext.workspaceState.update(GraphitiWorkspaceConsentStorageKey, {
			version: 1,
			endpoint: normalizedEndpoint,
			consentedAt: new Date().toISOString(),
		});
	}

	private formatError(err: unknown): string {
		if (err instanceof Error) {
			return err.message;
		}
		return String(err);
	}

	private getConsentedEndpoint(): string | undefined {
		const consentValue = this._extensionContext.workspaceState.get(GraphitiWorkspaceConsentStorageKey);
		const consentRecord = isGraphitiConsentRecord(consentValue) ? consentValue : undefined;
		return consentRecord?.endpoint;
	}

	private getNormalizedEndpointOrShowError(): string | undefined {
		const endpointRaw = this._configurationService.getConfig(ConfigKey.MemoryGraphitiEndpoint);
		const normalizedEndpoint = normalizeGraphitiEndpoint(endpointRaw);
		if (!normalizedEndpoint) {
			vscode.window.showErrorMessage(l10n.t('Graphiti endpoint is not set or invalid. Configure {0} and try again.', ConfigKey.MemoryGraphitiEndpoint.fullyQualifiedId));
			return undefined;
		}
		return normalizedEndpoint;
	}

	private createClient(endpoint: string): GraphitiClient {
		const timeoutMs = this._configurationService.getConfig(ConfigKey.MemoryGraphitiTimeoutMs);
		return new GraphitiClient(this._fetcherService, this._logService, { endpoint, timeoutMs });
	}

	private showOutputChannel(): void {
		this._outputChannel.show(true);
	}

	private logToOutputLine(message: string): void {
		this._outputChannel.appendLine(message);
	}

	private async pollForEpisodes(client: GraphitiClient, groupId: string, maxWaitMs: number): Promise<{ found: boolean; elapsedMs: number; attempts: number; lastError?: string }> {
		const start = Date.now();
		let attempts = 0;
		let lastError: string | undefined;

		while (Date.now() - start < maxWaitMs) {
			attempts++;
			try {
				const episodes = await client.getEpisodes(groupId, 1);
				if (Array.isArray(episodes) && episodes.length > 0) {
					return { found: true, elapsedMs: Date.now() - start, attempts };
				}
				lastError = undefined;
			} catch (err) {
				lastError = this.formatError(err);
			}

			await new Promise<void>(resolve => setTimeout(resolve, 500));
		}

		return { found: false, elapsedMs: Date.now() - start, attempts, lastError };
	}

	private async testConnectionCommand(): Promise<void> {
		if (!this._workspaceTrustService.isTrusted) {
			vscode.window.showWarningMessage(l10n.t('Graphiti connection test requires a trusted workspace.'));
			return;
		}

		const endpoint = this.getNormalizedEndpointOrShowError();
		if (!endpoint) {
			return;
		}

		const mode = await vscode.window.showQuickPick(
			[
				{
					label: l10n.t('Basic test (read-only)'),
					description: l10n.t('Calls GET /healthcheck (and optionally /openapi.json).'),
					value: 'basic' as const,
				},
				{
					label: l10n.t('Smoke test (writes + deletes)'),
					description: l10n.t('Sends a synthetic message then deletes the temporary group.'),
					value: 'smoke' as const,
				},
			],
			{ placeHolder: l10n.t('Select Graphiti connection test mode') },
		);
		if (!mode) {
			return;
		}

		if (mode.value === 'smoke') {
			const proceedLabel = l10n.t('Proceed');
			const cancelLabel = l10n.t('Cancel');
			const confirm = await vscode.window.showWarningMessage(
				l10n.t('Run Graphiti smoke test?'),
				{
					modal: true,
					detail: l10n.t('This will send a synthetic message to {0} and then attempt cleanup by deleting the temporary group.', endpoint),
				},
				proceedLabel,
				cancelLabel,
			);
			if (confirm !== proceedLabel) {
				return;
			}
		}

		const client = this.createClient(endpoint);
		const start = Date.now();

		this._outputChannel.clear();
		this.showOutputChannel();

		this.logToOutputLine(`Endpoint: ${endpoint}`);
		this.logToOutputLine(`Mode: ${mode.label}`);

		try {
			const health = await client.healthcheck();
			this.logToOutputLine(`✓ GET /healthcheck: ${health.status}`);
		} catch (err) {
			this.logToOutputLine(`✗ GET /healthcheck failed: ${this.formatError(err)}`);
			return;
		}

		try {
			await client.openApi();
			this.logToOutputLine(`✓ GET /openapi.json`);
		} catch (err) {
			this.logToOutputLine(`! GET /openapi.json failed (optional): ${this.formatError(err)}`);
		}

		// Optional: verify canonical group id resolution endpoint (newer Graphiti deployments).
		try {
			const probeKey = 'github_login:graphiti-smoketest';
			const local = computeGraphitiGroupId('user', 'hashed', probeKey);
			const resolved = await client.resolveGroupId({ scope: 'user', key: probeKey });
			this.logToOutputLine(`✓ POST /groups/resolve (optional): ${resolved.group_id}`);
			if (resolved.group_id !== local) {
				this.logToOutputLine(`! /groups/resolve mismatch (local=${local})`);
			}
		} catch (err) {
			this.logToOutputLine(`! POST /groups/resolve failed (optional): ${this.formatError(err)}`);
		}

		// Best-effort DB reachability check (should return 404, not 500).
		try {
			const timeoutMs = this._configurationService.getConfig(ConfigKey.MemoryGraphitiTimeoutMs);
			const response = await this._fetcherService.fetch(`${endpoint}/entity-edge/not_a_real_uuid`, {
				method: 'GET',
				timeout: timeoutMs,
			});
			if (response.status === 404) {
				this.logToOutputLine(`✓ GET /entity-edge/not_a_real_uuid: 404 (expected)`);
			} else if (response.ok) {
				this.logToOutputLine(`✓ GET /entity-edge/not_a_real_uuid: ${response.status}`);
			} else {
				this.logToOutputLine(`! GET /entity-edge/not_a_real_uuid: ${response.status} ${response.statusText}`);
			}
		} catch (err) {
			this.logToOutputLine(`! GET /entity-edge/not_a_real_uuid failed (optional): ${this.formatError(err)}`);
		}

		if (mode.value === 'smoke') {
			const smokeGroupId = `graphiti_smoketest_${Date.now()}_${generateUuid()}`;
			this.logToOutputLine(`Smoke test group_id: ${smokeGroupId}`);

			const message: GraphitiMessage = {
				role_type: 'system',
				role: 'system',
				content: 'Copilot Chat Graphiti smoke test message. Safe to delete.',
				timestamp: new Date().toISOString(),
			};

			try {
				const res = await client.addMessages(smokeGroupId, [message]);
				this.logToOutputLine(`✓ POST /messages: ${res.success ? 'accepted' : 'not accepted'} (${res.message})`);

				const poll = await this.pollForEpisodes(client, smokeGroupId, 5000);
				if (poll.found) {
					this.logToOutputLine(`✓ GET /episodes/{group_id}?last_n=1: visible after ${poll.elapsedMs}ms (${poll.attempts} attempts)`);
				} else if (poll.lastError) {
					this.logToOutputLine(`! GET /episodes/{group_id}?last_n=1 did not return episodes after ${poll.elapsedMs}ms (${poll.attempts} attempts): ${poll.lastError}`);
					this.logToOutputLine('  Hint: background ingestion may be failing; check Graphiti logs and LLM/embedding configuration.');
				} else {
					this.logToOutputLine(`! GET /episodes/{group_id}?last_n=1 still empty after ${poll.elapsedMs}ms (${poll.attempts} attempts)`);
					this.logToOutputLine('  Hint: background ingestion may be failing; check Graphiti logs and LLM/embedding configuration.');
				}
			} catch (err) {
				this.logToOutputLine(`✗ POST /messages failed: ${this.formatError(err)}`);
			} finally {
				try {
					const del = await client.deleteGroup(smokeGroupId);
					this.logToOutputLine(`✓ DELETE /group/{group_id}: ${del.success ? 'ok' : 'failed'} (${del.message})`);
				} catch (err) {
					this.logToOutputLine(`! DELETE /group/{group_id} failed: ${this.formatError(err)}`);
				}
			}
		}

		this.logToOutputLine(`Done in ${Date.now() - start}ms`);
	}

	private async promoteToMemoryCommand(): Promise<void> {
		if (!this._workspaceTrustService.isTrusted) {
			vscode.window.showWarningMessage(l10n.t('Graphiti promotion requires a trusted workspace.'));
			return;
		}

		if (!this._configurationService.getConfig(ConfigKey.MemoryGraphitiEnabled)) {
			vscode.window.showWarningMessage(l10n.t('Graphiti integration is disabled.'));
			return;
		}

		const endpoint = this.getNormalizedEndpointOrShowError();
		if (!endpoint) {
			return;
		}

		await this.maybeRunConsentFlow('configChanged');

		const consentedEndpoint = this.getConsentedEndpoint();
		if (consentedEndpoint !== endpoint) {
			vscode.window.showWarningMessage(l10n.t('Graphiti integration is enabled but not consented for {0}.', endpoint));
			return;
		}

		const scopePick = await vscode.window.showQuickPick(
			[
				{ label: l10n.t('Workspace Scope'), description: l10n.t('Shared across chat sessions in this workspace.'), value: 'workspace' as const },
				{ label: l10n.t('User Scope (Global)'), description: l10n.t('Shared across workspaces; promotion-only.'), value: 'user' as const },
			],
			{ placeHolder: l10n.t('Select where to store this memory') },
		);
		if (!scopePick) {
			return;
		}
		const promotionScope: GraphitiPromotionScope = scopePick.value;

		const kindPick = await vscode.window.showQuickPick(
			[
				{ label: l10n.t('Decision'), value: 'decision' as const },
				{ label: l10n.t('Lesson Learned'), value: 'lesson_learned' as const },
				{ label: l10n.t('Preference'), value: 'preference' as const },
				{ label: l10n.t('Procedure'), value: 'procedure' as const },
				{ label: l10n.t('Task Update'), value: 'task_update' as const },
				{ label: l10n.t('Terminology'), value: 'terminology' as const },
			],
			{ placeHolder: l10n.t('Select a memory kind') },
		);
		if (!kindPick) {
			return;
		}
		const promotionKind: GraphitiPromotionKind = kindPick.value;

		const text = await vscode.window.showInputBox({
			prompt: l10n.t('Enter the memory text to store in Graphiti'),
			placeHolder: l10n.t('Example: We use Vitest for unit tests in this repo.'),
			validateInput: value => value.trim() ? undefined : l10n.t('Memory text cannot be empty.'),
		});
		if (text === undefined) {
			return;
		}

		const now = new Date();
		const content = formatGraphitiPromotionEpisode(promotionKind, promotionScope, text, now);
		const includeGitMetadata = this._configurationService.getConfig(ConfigKey.MemoryGraphitiIncludeGitMetadata);
		const git = includeGitMetadata ? this.tryReadGitMetadata() : undefined;

		const groupIdStrategy = this._configurationService.getConfig(ConfigKey.MemoryGraphitiGroupIdStrategy);
		let groupId: string;

		if (promotionScope === 'workspace') {
			const workspaceKeys = computeGraphitiWorkspaceScopeKeys({ gitService: this._gitService, workspaceService: this._workspaceService });
			groupId = computeGraphitiGroupId('workspace', groupIdStrategy, workspaceKeys.primary);
		} else {
			const identityUserScopeKey = getGraphitiUserScopeKeyFromGitHubSession(this._authenticationService.anyGitHubSession);
			let userScopeKey = identityUserScopeKey;
			if (!userScopeKey) {
				userScopeKey = this._extensionContext.globalState.get<string>(GraphitiUserScopeKeyStorageKey);
				if (!userScopeKey) {
					userScopeKey = generateUuid();
					await this._extensionContext.globalState.update(GraphitiUserScopeKeyStorageKey, userScopeKey);
				}
			}
			groupId = computeGraphitiGroupId('user', groupIdStrategy, userScopeKey);
		}

		const message: GraphitiMessage = {
			role_type: 'system',
			role: 'system',
			content,
			timestamp: now.toISOString(),
			source_description: includeGitMetadata
				? JSON.stringify({ source: 'copilotchat', event: 'promotion', scope: promotionScope, kind: promotionKind, ...(git ? { git } : {}) })
				: `copilot-chat:promotion:${promotionScope}:${promotionKind}`,
		};

		const client = this.createClient(endpoint);
		try {
			await client.addMessages(groupId, [message]);
			vscode.window.showInformationMessage(l10n.t('Promoted memory to Graphiti ({0}).', scopePick.label));
		} catch (err) {
			vscode.window.showErrorMessage(l10n.t('Failed to promote memory to Graphiti: {0}', this.formatError(err)));
		}
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
}
