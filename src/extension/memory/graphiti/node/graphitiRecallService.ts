/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../../platform/log/common/logService';
import { IFetcherService } from '../../../../platform/networking/common/fetcherService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { IWorkspaceTrustService } from '../../../../platform/workspace/common/workspaceTrustService';
import { createServiceIdentifier } from '../../../../util/common/services';
import { GraphitiWorkspaceConsentStorageKey, isGraphitiConsentRecord } from '../common/graphitiConsent';
import { getGraphitiUserScopeKeys } from '../common/graphitiIdentity';
import { normalizeGraphitiEndpoint } from '../common/graphitiEndpoint';
import { GraphitiUserScopeKeyStorageKey } from '../common/graphitiStorageKeys';
import { GraphitiClient } from './graphitiClient';
import { computeGraphitiGroupId, computeWorkspaceKey } from './graphitiGroupIds';
import { GraphitiFactResult } from './graphitiTypes';

export const IGraphitiRecallService = createServiceIdentifier<IGraphitiRecallService>('IGraphitiRecallService');

export interface GraphitiRecalledFact {
	readonly scope: 'session' | 'workspace' | 'user';
	readonly fact: GraphitiFactResult;
}

export interface IGraphitiRecallService {
	readonly _serviceBrand: undefined;
	recallFacts(args: { sessionId?: string; query: string }): Promise<readonly GraphitiRecalledFact[]>;
}

type ResolvedGraphitiRecallConfig = {
	readonly endpoint: string;
	readonly timeoutMs: number;
	readonly maxFacts: number;
	readonly scopes: 'session' | 'workspace' | 'both' | 'all';
	readonly groupIdStrategy: 'raw' | 'hashed';
};

export class GraphitiRecallService implements IGraphitiRecallService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IWorkspaceTrustService private readonly _workspaceTrustService: IWorkspaceTrustService,
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async recallFacts(args: { sessionId?: string; query: string }): Promise<readonly GraphitiRecalledFact[]> {
		const query = args.query.trim();
		if (!query) {
			return [];
		}

		const config = this.resolveRecallConfig();
		if (!config) {
			return [];
		}

		const client = new GraphitiClient(this._fetcherService, this._logService, { endpoint: config.endpoint, timeoutMs: config.timeoutMs });
		const results: GraphitiRecalledFact[] = [];
		const seen = new Set<string>();

		const addFacts = (scope: GraphitiRecalledFact['scope'], facts: readonly GraphitiFactResult[]) => {
			for (const fact of facts) {
				const key = fact.uuid || fact.fact;
				if (seen.has(key)) {
					continue;
				}
				seen.add(key);
				results.push({ scope, fact });
				if (results.length >= config.maxFacts) {
					return;
				}
			}
		};

		const searchTargets: Array<{ scope: GraphitiRecalledFact['scope']; groupIds: readonly string[] }> = [];

		if ((config.scopes === 'session' || config.scopes === 'both' || config.scopes === 'all') && args.sessionId) {
			searchTargets.push({
				scope: 'session',
				groupIds: [computeGraphitiGroupId('session', config.groupIdStrategy, args.sessionId)],
			});
		}

		if (config.scopes === 'workspace' || config.scopes === 'both' || config.scopes === 'all') {
			const workspaceFolders = this._workspaceService.getWorkspaceFolders().map(u => u.toString());
			const workspaceKey = computeWorkspaceKey(workspaceFolders);
			searchTargets.push({
				scope: 'workspace',
				groupIds: [computeGraphitiGroupId('workspace', config.groupIdStrategy, workspaceKey)],
			});
		}

		if (config.scopes === 'all') {
			const legacyUserScopeKey = this._extensionContext.globalState.get<string>(GraphitiUserScopeKeyStorageKey);
			const userScopeKeys = getGraphitiUserScopeKeys({
				gitHubSession: this._authenticationService.anyGitHubSession,
				legacyUserScopeKey,
			});

			const groupIds = userScopeKeys.map(key => computeGraphitiGroupId('user', config.groupIdStrategy, key));
			if (groupIds.length) {
				searchTargets.push({ scope: 'user', groupIds });
			}
		}

		const searchPromises = searchTargets.map(({ scope, groupIds }) => {
			return client.search({ query, group_ids: groupIds, max_facts: config.maxFacts })
				.then(res => ({ scope, res }))
				.catch(() => {
					this._logService.debug(`Graphiti recall failed for ${scope} scope.`);
					return undefined;
				});
		});

		for (let i = 0; i < searchTargets.length; i++) {
			if (results.length >= config.maxFacts) {
				break;
			}

			const result = await searchPromises[i];
			if (!result) {
				continue;
			}

			addFacts(result.scope, result.res.facts);
		}

		this._logService.trace(`Graphiti recall produced ${results.length} fact(s).`);
		return results;
	}

	private resolveRecallConfig(): ResolvedGraphitiRecallConfig | undefined {
		if (!this._configurationService.getConfig(ConfigKey.MemoryGraphitiEnabled)) {
			return undefined;
		}

		if (!this._configurationService.getConfig(ConfigKey.MemoryGraphitiRecallEnabled)) {
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
			timeoutMs: this._configurationService.getConfig(ConfigKey.MemoryGraphitiRecallTimeoutMs),
			maxFacts: this._configurationService.getConfig(ConfigKey.MemoryGraphitiRecallMaxFacts),
			scopes: this._configurationService.getConfig(ConfigKey.MemoryGraphitiRecallScopes),
			groupIdStrategy: this._configurationService.getConfig(ConfigKey.MemoryGraphitiGroupIdStrategy),
		};
	}
}
