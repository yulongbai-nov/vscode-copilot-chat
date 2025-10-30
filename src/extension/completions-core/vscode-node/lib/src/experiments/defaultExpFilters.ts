/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../../../../../platform/authentication/common/authentication';
import { IDisposable } from '../../../../../../util/vs/base/common/lifecycle';
import { IInstantiationService, ServicesAccessor } from '../../../../../../util/vs/platform/instantiation/common/instantiation';
import { CompletionsExperimentationServiceBridge } from '../../../bridge/src/completionsExperimentationServiceBridge';
import { CopilotToken } from '../auth/copilotTokenManager';
import { getUserKind } from '../auth/orgs';
import {
	BuildType,
	ConfigKey,
	getConfig,
	ICompletionsBuildInfoService
} from '../config';
import { ICompletionsContextService } from '../context';
import { getEngineRequestInfo } from '../openai/config';
import { Filter, Release } from './filters';

export function setupCompletionsExperimentationService(accessor: ServicesAccessor): IDisposable {
	const authService = accessor.get(IAuthenticationService);
	const instantiationService = accessor.get(IInstantiationService);

	const disposable = authService.onDidAccessTokenChange(() => {
		authService.getCopilotToken()
			.then(t => instantiationService.invokeFunction(updateCompletionsFilters, t))
			.catch(err => { });
	});

	updateCompletionsFilters(accessor, authService.copilotToken);

	return disposable;
}

function getPluginRelease(accessor: ServicesAccessor): Release {
	if (accessor.get(ICompletionsBuildInfoService).getBuildType() === BuildType.NIGHTLY) {
		return Release.Nightly;
	}
	return Release.Stable;
}

function updateCompletionsFilters(accessor: ServicesAccessor, token: Omit<CopilotToken, "token"> | undefined) {
	const ctx = accessor.get(ICompletionsContextService);
	const exp = ctx.get(CompletionsExperimentationServiceBridge);

	const filters = createCompletionsFilters(accessor, token);

	exp.experimentationService.setCompletionsFilters(filters);
}

export function createCompletionsFilters(accessor: ServicesAccessor, token: Omit<CopilotToken, "token"> | undefined) {
	const filters = new Map<Filter, string>();

	filters.set(Filter.ExtensionRelease, getPluginRelease(accessor));
	filters.set(Filter.CopilotOverrideEngine, getConfig(accessor, ConfigKey.DebugOverrideEngine) || getConfig(accessor, ConfigKey.DebugOverrideEngineLegacy));
	filters.set(Filter.CopilotClientVersion, accessor.get(ICompletionsBuildInfoService).isProduction() ? accessor.get(ICompletionsBuildInfoService).getVersion() : '1.999.0');

	if (token) {
		const userKind = getUserKind(token);
		const customModel = token.getTokenValue('ft') ?? '';
		const orgs = token.getTokenValue('ol') ?? '';
		const customModelNames = token.getTokenValue('cml') ?? '';
		const copilotTrackingId = token.getTokenValue('tid') ?? '';

		filters.set(Filter.CopilotUserKind, userKind);
		filters.set(Filter.CopilotCustomModel, customModel);
		filters.set(Filter.CopilotOrgs, orgs);
		filters.set(Filter.CopilotCustomModelNames, customModelNames);
		filters.set(Filter.CopilotTrackingId, copilotTrackingId);
		filters.set(Filter.CopilotUserKind, getUserKind(token));
	}

	const model = getEngineRequestInfo(accessor).modelId;
	filters.set(Filter.CopilotEngine, model);
	return filters;
}