/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	CancellationToken,
	InlineCompletionContext,
	InlineCompletionEndOfLifeReason,
	InlineCompletionItem,
	InlineCompletionItemProvider,
	InlineCompletionList,
	InlineCompletionTriggerKind,
	PartialAcceptInfo,
	Position,
	TextDocument,
	workspace,
} from 'vscode';
import { Disposable } from '../../../../../util/vs/base/common/lifecycle';
import { IInstantiationService, ServicesAccessor } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { CompletionsTelemetryServiceBridge } from '../../bridge/src/completionsTelemetryServiceBridge';
import { ICompletionsBuildInfoService } from '../../lib/src/config';
import { CopilotConfigPrefix } from '../../lib/src/constants';
import { ICompletionsContextService } from '../../lib/src/context';
import { handleException } from '../../lib/src/defaultHandlers';
import { Logger } from '../../lib/src/logger';
import { telemetry, TelemetryData } from '../../lib/src/telemetry';
import { Deferred } from '../../lib/src/util/async';
import { isCompletionEnabledForDocument } from './config';
import { CopilotCompletionFeedbackTracker, sendCompletionFeedbackCommand } from './copilotCompletionFeedbackTracker';
import { CopilotExtensionStatus } from './extensionStatus';
import { GhostTextProvider } from './ghostText/ghostText';

const logger = new Logger('inlineCompletionItemProvider');

function quickSuggestionsDisabled() {
	const qs = workspace.getConfiguration('editor.quickSuggestions');
	return qs.get('other') !== 'on' && qs.get('comments') !== 'on' && qs.get('strings') !== 'on';
}

export function exception(accessor: ServicesAccessor, error: unknown, origin: string, logger?: Logger) {
	if (error instanceof Error && error.name === 'Canceled') {
		// these are VS Code cancellations
		return;
	}
	if (error instanceof Error && error.name === 'CodeExpectedError') {
		// expected errors from VS Code
		return;
	}
	const ctx = accessor.get(ICompletionsContextService);
	ctx.get(CompletionsTelemetryServiceBridge).sendGHTelemetryException(error, 'codeUnification.completions.exception');
	handleException(accessor, error, origin, logger);
}

/** @public */
export class CopilotInlineCompletionItemProvider extends Disposable implements InlineCompletionItemProvider {
	copilotCompletionFeedbackTracker: CopilotCompletionFeedbackTracker;
	ghostTextProvider: InlineCompletionItemProvider;
	initFallbackContext?: Promise<void>;
	pendingRequests: Set<Promise<unknown>> = new Set();

	constructor(
		@ICompletionsContextService private readonly ctx: ICompletionsContextService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICompletionsBuildInfoService private readonly buildInfoService: ICompletionsBuildInfoService,
	) {
		super();
		this.copilotCompletionFeedbackTracker = this._register(this.instantiationService.createInstance(CopilotCompletionFeedbackTracker));
		this.ghostTextProvider = this.instantiationService.createInstance(GhostTextProvider);
	}

	async waitForPendingRequests(): Promise<void> {
		while (this.pendingRequests.size > 0) {
			await Promise.all(this.pendingRequests);
		}
	}

	get delegate(): InlineCompletionItemProvider {
		return this.ghostTextProvider;
	}

	async provideInlineCompletionItems(
		doc: TextDocument,
		position: Position,
		context: InlineCompletionContext,
		token: CancellationToken
	): Promise<InlineCompletionItem[] | InlineCompletionList | undefined> {
		this.instantiationService.invokeFunction(telemetry, 'codeUnification.completions.invoked', TelemetryData.createAndMarkAsIssued({
			languageId: doc.languageId,
			lineCount: String(doc.lineCount),
			currentLine: String(position.line),
			isCycling: String(context.triggerKind === InlineCompletionTriggerKind.Invoke),
			completionsActive: String(context.selectedCompletionInfo !== undefined),
		}));

		try {
			return await this._provideInlineCompletionItems(doc, position, context, token);
		} catch (e) {
			this.ctx.get(CompletionsTelemetryServiceBridge).sendGHTelemetryException(e, 'codeUnification.completions.exception');
		} finally {
			this.instantiationService.invokeFunction(telemetry, 'codeUnification.completions.returned', TelemetryData.createAndMarkAsIssued());
		}
	}

	private async _provideInlineCompletionItems(
		doc: TextDocument,
		position: Position,
		context: InlineCompletionContext,
		token: CancellationToken
	): Promise<InlineCompletionItem[] | InlineCompletionList | undefined> {
		const pendingRequestDeferred = new Deferred();
		this.pendingRequests.add(pendingRequestDeferred.promise);

		if (context.triggerKind === InlineCompletionTriggerKind.Automatic) {
			if (!this.instantiationService.invokeFunction(isCompletionEnabledForDocument, doc)) {
				return;
			}
			if (this.ctx.get(CopilotExtensionStatus).kind === 'Error') {
				return;
			}
		}
		const copilotConfig = workspace.getConfiguration(CopilotConfigPrefix);
		// Constraining the generated inline completion to match selectedCompletionInfo sandbags Copilot pretty hard, as
		// typically it's just the first entry in the list alphabetically.  But if we generate a result that doesn't
		// match it, VS Code won't show it to the user unless the completion dropdown is dismissed. Historically we've
		// chosen to favor completion quality, but this option allows opting into or out of generating a completion that
		// VS Code will actually show.
		if (!copilotConfig.get('respectSelectedCompletionInfo', quickSuggestionsDisabled() || this.buildInfoService.isPreRelease())) {
			context = { ...context, selectedCompletionInfo: undefined };
		}
		try {
			let items = await this.delegate.provideInlineCompletionItems(doc, position, context, token);

			// Release CompletionItemProvider after returning
			setTimeout(() => {
				this.pendingRequests.delete(pendingRequestDeferred.promise);
				pendingRequestDeferred.resolve(undefined);
			});

			if (!items) {
				return undefined;
			}

			// If the language client provides a list of items, we want to add the send feedback command to it.
			if (Array.isArray(items)) {
				items = { items };
			}
			return {
				...items,
				commands: [sendCompletionFeedbackCommand],
			};
		} catch (e) {
			this.instantiationService.invokeFunction(exception, e, '.provideInlineCompletionItems', logger);
		}
	}

	handleDidShowCompletionItem(item: InlineCompletionItem, updatedInsertText: string) {
		try {
			this.copilotCompletionFeedbackTracker.trackItem(item);
			return this.delegate.handleDidShowCompletionItem?.(item, updatedInsertText);
		} catch (e) {
			this.instantiationService.invokeFunction(exception, e, '.provideInlineCompletionItems', logger);
		}
	}

	handleDidPartiallyAcceptCompletionItem(
		item: InlineCompletionItem,
		acceptedLengthOrInfo: number & PartialAcceptInfo
	) {
		try {
			return this.delegate.handleDidPartiallyAcceptCompletionItem?.(item, acceptedLengthOrInfo);
		} catch (e) {
			this.instantiationService.invokeFunction(exception, e, '.provideInlineCompletionItems', logger);
		}
	}

	handleEndOfLifetime(completionItem: InlineCompletionItem, reason: InlineCompletionEndOfLifeReason) {
		try {
			return this.delegate.handleEndOfLifetime?.(completionItem, reason);
		} catch (e) {
			this.instantiationService.invokeFunction(exception, e, '.handleEndOfLifetime', logger);
		}
	}
}
