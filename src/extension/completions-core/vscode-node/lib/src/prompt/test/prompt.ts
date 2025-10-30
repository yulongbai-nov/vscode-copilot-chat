/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vscode-languageserver-protocol';
import { createCompletionState } from '../../completionState';
import { ICompletionsContextService } from '../../context';
import { getGhostText } from '../../ghostText/ghostText';
import { TelemetryWithExp } from '../../telemetry';
import { IPosition, ITextDocument } from '../../textDocument';
import { ContextProviderBridge } from '../components/contextProviderBridge';
import { extractPrompt, ExtractPromptOptions } from '../prompt';
import { ServicesAccessor } from '../../../../../../../util/vs/platform/instantiation/common/instantiation';

export async function extractPromptInternal(
	accessor: ServicesAccessor,
	completionId: string,
	textDocument: ITextDocument,
	position: IPosition,
	telemetryWithExp: TelemetryWithExp,
	promptOpts: ExtractPromptOptions = {}
) {
	const completionState = createCompletionState(textDocument, position);
	const ctx = accessor.get(ICompletionsContextService);
	ctx.get(ContextProviderBridge).schedule(completionState, completionId, 'opId', telemetryWithExp);
	return extractPrompt(accessor, completionId, completionState, telemetryWithExp, undefined, promptOpts);
}

export async function getGhostTextInternal(
	accessor: ServicesAccessor,
	textDocument: ITextDocument,
	position: IPosition,
	token?: CancellationToken
) {
	return getGhostText(accessor, createCompletionState(textDocument, position), token, { opportunityId: 'opId' });
}
