/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../../../util/vs/platform/instantiation/common/instantiation';
import { ICompletionsContextService } from '../context';
import { Features } from '../experiments/features';
import { logger, LogTarget } from '../logger';
import { TelemetryWithExp } from '../telemetry';
import { ActiveExperiments } from './contextProviderRegistry';

export const TS_CONTEXT_PROVIDER_ID = 'typescript-ai-context-provider';

interface ContextProviderParams {
	[key: string]: string | number | boolean;
}

export function fillInTsActiveExperiments(
	accessor: ServicesAccessor,
	matchedContextProviders: string[],
	activeExperiments: ActiveExperiments,
	telemetryData: TelemetryWithExp
): boolean {
	if (
		!(
			(matchedContextProviders.length === 1 && matchedContextProviders[0] === '*') ||
			matchedContextProviders.includes(TS_CONTEXT_PROVIDER_ID)
		)
	) {
		return false;
	}
	const ctx = accessor.get(ICompletionsContextService);
	try {
		const tsContextProviderParams = ctx.get(Features).tsContextProviderParams(telemetryData);
		if (tsContextProviderParams) {
			const params = JSON.parse(tsContextProviderParams) as ContextProviderParams;
			for (const [key, value] of Object.entries(params)) { activeExperiments.set(key, value); }
		}
	} catch (e) {
		logger.debug(ctx.get(LogTarget), `Failed to get the active TypeScript experiments for the Context Provider API`, e);
		return false;
	}
	return true;
}
