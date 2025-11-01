/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from '@vscode/copilot-api';
import { Raw } from '@vscode/prompt-tsx';
import { ChatCompletionContentPartKind } from '@vscode/prompt-tsx/dist/base/output/rawTypes';
import { FetchStreamSource } from '../../../platform/chat/common/chatMLFetcher';
import { ChatFetchError, ChatFetchResponseType, ChatLocation } from '../../../platform/chat/common/commonTypes';
import { toTextParts } from '../../../platform/chat/common/globalStringUtils';
import { ConfigKey, ExperimentBasedConfig, IConfigurationService, XTabProviderId } from '../../../platform/configuration/common/configurationService';
import { IDiffService } from '../../../platform/diff/common/diffService';
import { ChatEndpoint } from '../../../platform/endpoint/node/chatEndpoint';
import { createProxyXtabEndpoint } from '../../../platform/endpoint/node/proxyXtabEndpoint';
import { IIgnoreService } from '../../../platform/ignore/common/ignoreService';
import { Copilot } from '../../../platform/inlineCompletions/common/api';
import { LanguageContextEntry, LanguageContextResponse } from '../../../platform/inlineEdits/common/dataTypes/languageContext';
import { LanguageId } from '../../../platform/inlineEdits/common/dataTypes/languageId';
import { NextCursorLinePrediction } from '../../../platform/inlineEdits/common/dataTypes/nextCursorLinePrediction';
import * as xtabPromptOptions from '../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { LanguageContextLanguages, LanguageContextOptions } from '../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { InlineEditRequestLogContext } from '../../../platform/inlineEdits/common/inlineEditLogContext';
import { ResponseProcessor } from '../../../platform/inlineEdits/common/responseProcessor';
import { IStatelessNextEditProvider, NoNextEditReason, PushEdit, ShowNextEditPreference, StatelessNextEditDocument, StatelessNextEditRequest, StatelessNextEditResult, StatelessNextEditTelemetryBuilder } from '../../../platform/inlineEdits/common/statelessNextEditProvider';
import { editWouldDeleteWhatWasJustInserted, editWouldDeleteWhatWasJustInserted2, IgnoreEmptyLineAndLeadingTrailingWhitespaceChanges, IgnoreWhitespaceOnlyChanges } from '../../../platform/inlineEdits/common/statelessNextEditProviders';
import { ILanguageContextProviderService } from '../../../platform/languageContextProvider/common/languageContextProviderService';
import { ILanguageDiagnosticsService } from '../../../platform/languages/common/languageDiagnosticsService';
import { ContextKind, SnippetContext } from '../../../platform/languageServer/common/languageContextService';
import { ILogService } from '../../../platform/log/common/logService';
import { OptionalChatRequestParams, Prediction } from '../../../platform/networking/common/fetch';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { ISimulationTestContext } from '../../../platform/simulationTestContext/common/simulationTestContext';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { raceFilter } from '../../../util/common/async';
import * as errors from '../../../util/common/errors';
import { Result } from '../../../util/common/result';
import { TokenizerType } from '../../../util/common/tokenizer';
import { createTracer, ITracer } from '../../../util/common/tracing';
import { assertNever } from '../../../util/vs/base/common/assert';
import { AsyncIterableObject, DeferredPromise, raceTimeout, timeout } from '../../../util/vs/base/common/async';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { StopWatch } from '../../../util/vs/base/common/stopwatch';
import { LineEdit, LineReplacement } from '../../../util/vs/editor/common/core/edits/lineEdit';
import { StringEdit, StringReplacement } from '../../../util/vs/editor/common/core/edits/stringEdit';
import { Position } from '../../../util/vs/editor/common/core/position';
import { Range } from '../../../util/vs/editor/common/core/range';
import { LineRange } from '../../../util/vs/editor/common/core/ranges/lineRange';
import { OffsetRange } from '../../../util/vs/editor/common/core/ranges/offsetRange';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { Position as VscodePosition } from '../../../vscodeTypes';
import { Delayer, DelaySession } from '../../inlineEdits/common/delayer';
import { getOrDeduceSelectionFromLastEdit } from '../../inlineEdits/common/nearbyCursorInlineEditProvider';
import { IgnoreImportChangesAspect } from '../../inlineEdits/node/importFiltering';
import { createTaggedCurrentFileContentUsingPagedClipping, getUserPrompt, N_LINES_ABOVE, N_LINES_AS_CONTEXT, N_LINES_BELOW, PromptPieces } from '../common/promptCrafting';
import { nes41Miniv3SystemPrompt, simplifiedPrompt, systemPromptTemplate, unifiedModelSystemPrompt, xtab275SystemPrompt } from '../common/systemMessages';
import { PromptTags } from '../common/tags';
import { CurrentDocument } from '../common/xtabCurrentDocument';
import { XtabEndpoint } from './xtabEndpoint';
import { linesWithBackticksRemoved, toLines } from './xtabUtils';

namespace ResponseTags {
	export const NO_CHANGE = {
		start: '<NO_CHANGE>'
	};
	export const EDIT = {
		start: '<EDIT>',
		end: '</EDIT>'
	};
	export const INSERT = {
		start: '<INSERT>',
		end: '</INSERT>'
	};
}

const enum RetryState {
	NotRetrying,
	Retrying
}

interface ModelConfig extends xtabPromptOptions.PromptOptions {
	modelName: string | undefined;
}

export class XtabProvider implements IStatelessNextEditProvider {

	public static readonly ID = XTabProviderId;

	public readonly ID = XtabProvider.ID;

	public readonly dependsOnSelection = true;
	public readonly showNextEditPreference = ShowNextEditPreference.Always;

	private static computeTokens = (s: string) => Math.floor(s.length / 4);

	private readonly tracer: ITracer;
	private readonly delayer: Delayer;

	private forceUseDefaultModel: boolean = false;

	constructor(
		@ISimulationTestContext private readonly simulationCtx: ISimulationTestContext,
		@IInstantiationService private readonly instaService: IInstantiationService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IDiffService private readonly diffService: IDiffService,
		@IConfigurationService private readonly configService: IConfigurationService,
		@IExperimentationService private readonly expService: IExperimentationService,
		@ILogService private readonly logService: ILogService,
		@ILanguageContextProviderService private readonly langCtxService: ILanguageContextProviderService,
		@ILanguageDiagnosticsService private readonly langDiagService: ILanguageDiagnosticsService,
		@IIgnoreService private readonly ignoreService: IIgnoreService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
		this.delayer = new Delayer(this.configService, this.expService);
		this.tracer = createTracer(['NES', 'XtabProvider'], (s) => this.logService.trace(s));
	}

	public handleAcceptance(): void {
		this.delayer.handleAcceptance();
	}

	public handleRejection(): void {
		this.delayer.handleRejection();
	}

	public provideNextEdit(request: StatelessNextEditRequest, pushEdit: PushEdit, logContext: InlineEditRequestLogContext, cancellationToken: CancellationToken): Promise<StatelessNextEditResult> {
		const filteringPushEdit: PushEdit = (result) => {
			if (result.isError()) {
				pushEdit(result);
				return;
			}
			const { edit } = result.val;
			const filteredEdits = this.filterEdit(request.getActiveDocument(), [edit]);
			if (filteredEdits.length === 0) { // do not invoke pushEdit
				return;
			}
			pushEdit(result);
		};

		return this._provideNextEdit(request, filteringPushEdit, logContext, cancellationToken);
	}

	private filterEdit(activeDoc: StatelessNextEditDocument, edits: readonly LineReplacement[]): readonly LineReplacement[] {
		type EditFilter = (edits: readonly LineReplacement[]) => readonly LineReplacement[];

		const filters: EditFilter[] = [
			(edits) => IgnoreImportChangesAspect.filterEdit(activeDoc, edits),
			(edits) => IgnoreEmptyLineAndLeadingTrailingWhitespaceChanges.filterEdit(activeDoc, edits),
		];

		if (!this.configService.getExperimentBasedConfig(ConfigKey.InlineEditsAllowWhitespaceOnlyChanges, this.expService)) {
			filters.push((edits) => IgnoreWhitespaceOnlyChanges.filterEdit(activeDoc, edits));
		}

		const undoInsertionFiltering = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsUndoInsertionFiltering, this.expService);
		if (undoInsertionFiltering !== undefined) {
			let filter;
			switch (undoInsertionFiltering) {
				case 'v1':
					filter = editWouldDeleteWhatWasJustInserted;
					break;
				case 'v2':
					filter = editWouldDeleteWhatWasJustInserted2;
					break;
				default:
					assertNever(undoInsertionFiltering);
			}
			filters.push((edits) => filter(activeDoc, new LineEdit(edits)) ? [] : edits);
		}

		return filters.reduce((acc, filter) => filter(acc), edits);
	}

	public async _provideNextEdit(request: StatelessNextEditRequest, pushEdit: PushEdit, logContext: InlineEditRequestLogContext, cancellationToken: CancellationToken): Promise<StatelessNextEditResult> {
		const telemetry = new StatelessNextEditTelemetryBuilder(request);

		logContext.setProviderStartTime();
		try {
			if (request.xtabEditHistory.length === 0) {
				return StatelessNextEditResult.noEdit(new NoNextEditReason.ActiveDocumentHasNoEdits(), telemetry);
			}

			const delaySession = this.delayer.createDelaySession(request.providerRequestStartDateTime);

			const nextEditResult = await this.doGetNextEdit(request, pushEdit, delaySession, logContext, cancellationToken, telemetry, RetryState.NotRetrying);

			if (nextEditResult.isError() && nextEditResult.err instanceof NoNextEditReason.GotCancelled) {
				logContext.setIsSkipped();
			}

			if (nextEditResult.isOk()) {
				await this.enforceArtificialDelay(delaySession, telemetry);
			}

			return new StatelessNextEditResult(nextEditResult, telemetry.build(nextEditResult));
		} catch (err: unknown) {
			return StatelessNextEditResult.noEdit(new NoNextEditReason.Unexpected(errors.fromUnknown(err)), telemetry);
		} finally {
			logContext.setProviderEndTime();
		}
	}

	private async doGetNextEdit(
		request: StatelessNextEditRequest,
		pushEdit: PushEdit,
		delaySession: DelaySession,
		logContext: InlineEditRequestLogContext,
		cancellationToken: CancellationToken,
		telemetryBuilder: StatelessNextEditTelemetryBuilder,
		retryState: RetryState,
	): Promise<Result<void, NoNextEditReason>> {
		return this.doGetNextEditWithSelection(
			request,
			getOrDeduceSelectionFromLastEdit(request.getActiveDocument()),
			pushEdit,
			delaySession,
			{ showLabel: false },
			logContext,
			cancellationToken,
			telemetryBuilder,
			retryState,
		);
	}

	private async doGetNextEditWithSelection(
		request: StatelessNextEditRequest,
		selection: Range | null,
		pushEdit: PushEdit,
		delaySession: DelaySession,
		opts: { showLabel: boolean },
		logContext: InlineEditRequestLogContext,
		cancellationToken: CancellationToken,
		telemetryBuilder: StatelessNextEditTelemetryBuilder,
		retryState: RetryState,
	): Promise<Result<void, NoNextEditReason>> {

		const tracer = this.tracer.sub('doGetNextEditWithSelection');

		const activeDocument = request.getActiveDocument();

		if (selection === null) {
			return Result.error(new NoNextEditReason.Uncategorized(new Error('NoSelection')));
		}

		const promptOptions = this.determineModelConfiguration(activeDocument);

		const endpoint = this.getEndpoint(promptOptions.modelName);
		logContext.setEndpointInfo(typeof endpoint.urlOrRequestMetadata === 'string' ? endpoint.urlOrRequestMetadata : JSON.stringify(endpoint.urlOrRequestMetadata.type), endpoint.model);
		telemetryBuilder.setModelName(endpoint.model);

		const cursorPosition = new Position(selection.endLineNumber, selection.endColumn);

		const currentDocument = new CurrentDocument(activeDocument.documentAfterEdits, cursorPosition);

		const cursorLine = currentDocument.lines[currentDocument.cursorLineOffset];
		const isCursorAtEndOfLine = cursorPosition.column === cursorLine.trimEnd().length;
		if (isCursorAtEndOfLine) {
			delaySession.setExtraDebounce(this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsExtraDebounceEndOfLine, this.expService));
		}
		telemetryBuilder.setIsCursorAtLineEnd(isCursorAtEndOfLine);

		const areaAroundEditWindowLinesRange = this.computeAreaAroundEditWindowLinesRange(currentDocument);

		const editWindowLinesRange = this.computeEditWindowLinesRange(currentDocument, request, retryState, telemetryBuilder);

		const cursorOriginalLinesOffset = Math.max(0, currentDocument.cursorLineOffset - editWindowLinesRange.start);
		const editWindowLastLineLength = currentDocument.transformer.getLineLength(editWindowLinesRange.endExclusive);
		const editWindow = currentDocument.transformer.getOffsetRange(new Range(editWindowLinesRange.start + 1, 1, editWindowLinesRange.endExclusive, editWindowLastLineLength + 1));

		const editWindowLines = currentDocument.lines.slice(editWindowLinesRange.start, editWindowLinesRange.endExclusive);

		// Expected: editWindow.substring(activeDocument.documentAfterEdits.value) === editWindowLines.join('\n')

		const doesIncludeCursorTag = editWindowLines.some(line => line.includes(PromptTags.CURSOR));
		const shouldRemoveCursorTagFromResponse = !doesIncludeCursorTag; // we'd like to remove the tag only if the original edit-window didn't include the tag

		const taggedCurrentFileContentResult = this.constructTaggedFile(
			currentDocument,
			editWindowLinesRange,
			areaAroundEditWindowLinesRange,
			promptOptions,
			XtabProvider.computeTokens,
			{ includeLineNumbers: false }
		);

		if (taggedCurrentFileContentResult.isError()) {
			return Result.error(new NoNextEditReason.PromptTooLarge('currentFile'));
		}

		const { taggedCurrentFileR: { taggedCurrentFileContent, nLines: nLinesCurrentFile }, areaAroundCodeToEdit } = taggedCurrentFileContentResult.val;

		telemetryBuilder.setNLinesOfCurrentFileInPrompt(nLinesCurrentFile);

		const langCtx = await this.getAndProcessLanguageContext(
			request,
			delaySession,
			activeDocument,
			cursorPosition,
			promptOptions,
			logContext,
			cancellationToken,
		);

		if (cancellationToken.isCancellationRequested) {
			return Result.error(new NoNextEditReason.GotCancelled('afterLanguageContextAwait'));
		}

		const promptPieces = new PromptPieces(
			currentDocument,
			editWindowLinesRange,
			areaAroundEditWindowLinesRange,
			activeDocument,
			request.xtabEditHistory,
			taggedCurrentFileContent,
			areaAroundCodeToEdit,
			langCtx,
			XtabProvider.computeTokens,
			promptOptions
		);

		const userPrompt = getUserPrompt(promptPieces);

		const responseFormat = xtabPromptOptions.ResponseFormat.fromPromptingStrategy(promptOptions.promptingStrategy);

		const prediction = this.getPredictedOutput(editWindowLines, responseFormat);

		const messages = constructMessages({
			systemMsg: this.pickSystemPrompt(promptOptions.promptingStrategy),
			userMsg: userPrompt,
		});

		logContext.setPrompt(messages);
		telemetryBuilder.setPrompt(messages);

		const HARD_CHAR_LIMIT = 30000 * 4; // 30K tokens, assuming 4 chars per token -- we use approximation here because counting tokens exactly is time-consuming
		const promptCharCount = charCount(messages);
		if (promptCharCount > HARD_CHAR_LIMIT) {
			return Result.error(new NoNextEditReason.PromptTooLarge('final'));
		}

		await this.debounce(delaySession, telemetryBuilder);
		if (cancellationToken.isCancellationRequested) {
			return Result.error(new NoNextEditReason.GotCancelled('afterDebounce'));
		}

		request.fetchIssued = true;

		const cursorLineOffset = cursorPosition.column;
		this.streamEdits(
			request,
			pushEdit,
			endpoint,
			messages,
			editWindow,
			editWindowLines,
			cursorOriginalLinesOffset,
			cursorLineOffset,
			editWindowLinesRange,
			promptPieces,
			prediction,
			{
				showLabel: opts.showLabel,
				shouldRemoveCursorTagFromResponse,
				responseFormat,
				retryState,
			},
			delaySession,
			tracer,
			telemetryBuilder,
			logContext,
			cancellationToken
		);
		return Result.ok<void>(undefined);
	}

	private constructTaggedFile(
		currentDocument: CurrentDocument,
		editWindowLinesRange: OffsetRange,
		areaAroundEditWindowLinesRange: OffsetRange,
		promptOptions: xtabPromptOptions.PromptOptions,
		computeTokens: (s: string) => number,
		opts: {
			includeLineNumbers: boolean;
		}
	) {
		const contentWithCursorAsLinesOriginal = (() => {
			const addCursorTagEdit = StringEdit.single(StringReplacement.insert(currentDocument.cursorOffset, PromptTags.CURSOR));
			const contentWithCursor = addCursorTagEdit.applyOnText(currentDocument.content);
			return contentWithCursor.getLines();
		})();

		const addLineNumbers = (lines: string[]) => lines.map((line, idx) => `${idx}| ${line}`);

		const contentWithCursorAsLines = opts.includeLineNumbers
			? addLineNumbers(contentWithCursorAsLinesOriginal)
			: contentWithCursorAsLinesOriginal;

		const editWindowWithCursorAsLines = contentWithCursorAsLines.slice(editWindowLinesRange.start, editWindowLinesRange.endExclusive);

		const areaAroundCodeToEdit = [
			PromptTags.AREA_AROUND.start,
			...contentWithCursorAsLines.slice(areaAroundEditWindowLinesRange.start, editWindowLinesRange.start),
			PromptTags.EDIT_WINDOW.start,
			...editWindowWithCursorAsLines,
			PromptTags.EDIT_WINDOW.end,
			...contentWithCursorAsLines.slice(editWindowLinesRange.endExclusive, areaAroundEditWindowLinesRange.endExclusive),
			PromptTags.AREA_AROUND.end
		].join('\n');

		const currentFileContentLines = opts.includeLineNumbers
			? addLineNumbers(currentDocument.lines)
			: currentDocument.lines;

		let areaAroundCodeToEditForCurrentFile: string;
		if (promptOptions.currentFile.includeTags) {
			areaAroundCodeToEditForCurrentFile = areaAroundCodeToEdit;
		} else {
			const editWindowLines = currentFileContentLines.slice(editWindowLinesRange.start, editWindowLinesRange.endExclusive);
			areaAroundCodeToEditForCurrentFile = [
				...contentWithCursorAsLines.slice(areaAroundEditWindowLinesRange.start, editWindowLinesRange.start),
				...editWindowLines,
				...contentWithCursorAsLines.slice(editWindowLinesRange.endExclusive, areaAroundEditWindowLinesRange.endExclusive),
			].join('\n');
		}

		const taggedCurrentFileContentResult = createTaggedCurrentFileContentUsingPagedClipping(
			currentFileContentLines,
			areaAroundCodeToEditForCurrentFile,
			areaAroundEditWindowLinesRange,
			computeTokens,
			promptOptions.pagedClipping.pageSize,
			promptOptions.currentFile,
		);

		return taggedCurrentFileContentResult.map(taggedCurrentFileR => ({
			taggedCurrentFileR,
			areaAroundCodeToEdit,
		}));
	}

	private getAndProcessLanguageContext(
		request: StatelessNextEditRequest,
		delaySession: DelaySession,
		activeDocument: StatelessNextEditDocument,
		cursorPosition: Position,
		promptOptions: ModelConfig,
		logContext: InlineEditRequestLogContext,
		cancellationToken: CancellationToken,
	): Promise<LanguageContextResponse | undefined> {
		const recordingEnabled = this.configService.getConfig<boolean>(ConfigKey.Internal.InlineEditsLogContextRecorderEnabled);

		if (!promptOptions.languageContext.enabled && !recordingEnabled) {
			return Promise.resolve(undefined);
		}

		const langCtxPromise = this.getLanguageContext(request, delaySession, activeDocument, cursorPosition, logContext, cancellationToken);

		// if recording, add diagnostics for the file to the recording and hook up the language context promise to write to the recording
		if (recordingEnabled) {
			logContext.setFileDiagnostics(this.langDiagService.getAllDiagnostics());
			langCtxPromise.then(langCtxs => {
				if (langCtxs) {
					logContext.setLanguageContext(langCtxs);
				}
			});
		}

		return promptOptions.languageContext.enabled
			? langCtxPromise
			: Promise.resolve(undefined);
	}


	private async getLanguageContext(
		request: StatelessNextEditRequest,
		delaySession: DelaySession,
		activeDocument: StatelessNextEditDocument,
		cursorPosition: Position,
		logContext: InlineEditRequestLogContext,
		cancellationToken: CancellationToken,
	): Promise<LanguageContextResponse | undefined> {
		try {
			const textDoc = this.workspaceService.textDocuments.find(doc => doc.uri.toString() === activeDocument.id.uri);
			if (textDoc === undefined) {
				return undefined;
			}

			const providers = this.langCtxService.getContextProviders(textDoc);
			if (providers.length < 1) {
				return undefined;
			}

			const debounceTime = delaySession.getDebounceTime();

			const cursorPositionVscode = new VscodePosition(cursorPosition.lineNumber - 1, cursorPosition.column - 1);

			const ctxRequest: Copilot.ResolveRequest = {
				opportunityId: request.opportunityId,
				completionId: request.id,
				documentContext: {
					uri: textDoc.uri.toString(),
					languageId: textDoc.languageId,
					version: textDoc.version,
					offset: textDoc.offsetAt(cursorPositionVscode)
				},
				activeExperiments: new Map(),
				timeBudget: debounceTime,
				timeoutEnd: Date.now() + debounceTime,
				source: 'nes',
			};

			const isSnippetIgnored = async (item: SnippetContext): Promise<boolean> => {
				const uris = [item.uri, ...(item.additionalUris ?? [])];
				const isIgnored = await raceFilter(uris.map(uri => this.ignoreService.isCopilotIgnored(uri)), r => r);
				return !!isIgnored;
			};

			const langCtxItems: LanguageContextEntry[] = [];
			const getContextPromise = async () => {
				const ctxIter = this.langCtxService.getContextItems(textDoc, ctxRequest, cancellationToken);
				for await (const item of ctxIter) {
					if (item.kind === ContextKind.Snippet && await isSnippetIgnored(item)) {
						// If the snippet is ignored, we don't want to include it in the context
						continue;
					}
					langCtxItems.push({ context: item, timeStamp: Date.now(), onTimeout: false });
				}
			};

			const start = Date.now();
			await raceTimeout(getContextPromise(), debounceTime);
			const end = Date.now();

			const langCtxOnTimeout = this.langCtxService.getContextItemsOnTimeout(textDoc, ctxRequest);
			for (const item of langCtxOnTimeout) {
				if (item.kind === ContextKind.Snippet && await isSnippetIgnored(item)) {
					// If the snippet is ignored, we don't want to include it in the context
					continue;
				}
				langCtxItems.push({ context: item, timeStamp: end, onTimeout: true });
			}

			return { start, end, items: langCtxItems };

		} catch (error: unknown) {
			logContext.setError(errors.fromUnknown(error));
			this.tracer.trace(`Failed to fetch language context: ${error}`);
			return undefined;
		}
	}

	public async streamEdits(
		request: StatelessNextEditRequest,
		pushEdit: PushEdit,
		endpoint: IChatEndpoint,
		messages: Raw.ChatMessage[],
		editWindow: OffsetRange,
		editWindowLines: string[],
		cursorOriginalLinesOffset: number,
		cursorLineOffset: number, // cursor offset within the line it's in; 1-based
		editWindowLineRange: OffsetRange,
		promptPieces: PromptPieces,
		prediction: Prediction | undefined,
		opts: {
			showLabel: boolean;
			responseFormat: xtabPromptOptions.ResponseFormat;
			shouldRemoveCursorTagFromResponse: boolean;
			retryState: RetryState;
		},
		delaySession: DelaySession,
		parentTracer: ITracer,
		telemetryBuilder: StatelessNextEditTelemetryBuilder,
		logContext: InlineEditRequestLogContext,
		cancellationToken: CancellationToken,
	) {
		const tracer = parentTracer.sub('streamEdits');

		const useFetcher = this.configService.getExperimentBasedConfig(ConfigKey.NextEditSuggestionsFetcher, this.expService) || undefined;

		const fetchStreamSource = new FetchStreamSource();

		const fetchRequestStopWatch = new StopWatch();

		let responseSoFar = '';

		let chatResponseFailure: ChatFetchError | undefined;

		let ttft: number | undefined;

		const firstTokenReceived = new DeferredPromise<void>();

		telemetryBuilder.setFetchStartedAt();
		logContext.setFetchStartTime();

		// we must not await this promise because we want to stream edits as they come in
		const fetchResultPromise = endpoint.makeChatRequest2(
			{
				debugName: XtabProvider.ID,
				messages,
				finishedCb: async (text, _, delta) => {
					if (!firstTokenReceived.isSettled) {
						firstTokenReceived.complete();
					}
					if (ttft === undefined) {
						ttft = fetchRequestStopWatch.elapsed();
						logContext.addLog(`TTFT ${ttft} ms`);
					}

					fetchStreamSource.update(text, delta);
					responseSoFar = text;
					logContext.setResponse(responseSoFar);
					return undefined;
				},
				location: ChatLocation.Other,
				source: undefined,
				requestOptions: {
					temperature: 0,
					stream: true,
					prediction,
				} satisfies OptionalChatRequestParams,
				userInitiatedRequest: undefined,
				telemetryProperties: {
					requestId: request.id,
				},
				useFetcher,
			},
			cancellationToken,
		);

		telemetryBuilder.setResponse(fetchResultPromise.then((response) => ({ response, ttft })));
		logContext.setFullResponse(fetchResultPromise.then((response) => response.type === ChatFetchResponseType.Success ? response.value : undefined));

		const fetchRes = await Promise.race([firstTokenReceived.p, fetchResultPromise]);
		if (fetchRes && fetchRes.type !== ChatFetchResponseType.Success) {
			if (fetchRes.type === ChatFetchResponseType.NotFound &&
				!this.forceUseDefaultModel // if we haven't already forced using the default model; otherwise, this could cause an infinite loop
			) {
				this.forceUseDefaultModel = true;
				return this.doGetNextEdit(request, pushEdit, delaySession, logContext, cancellationToken, telemetryBuilder, opts.retryState); // use the same retry state
			}
			pushEdit(Result.error(XtabProvider.mapChatFetcherErrorToNoNextEditReason(fetchRes)));
			return;
		}

		fetchResultPromise
			.then((response) => {
				// this's a way to signal the edit-pushing code to know if the request failed and
				// 	it shouldn't push edits constructed from an erroneous response
				chatResponseFailure = response.type !== ChatFetchResponseType.Success ? response : undefined;
			})
			.catch((err: unknown) => {
				// in principle this shouldn't happen because ChatMLFetcher's fetchOne should not throw
				logContext.setError(errors.fromUnknown(err));
				logContext.addLog(`ChatMLFetcher fetch call threw -- this's UNEXPECTED!`);

				// Properly handle the error by pushing it as a result
				pushEdit(Result.error(new NoNextEditReason.Unexpected(errors.fromUnknown(err))));
			}).finally(() => {
				logContext.setFetchEndTime();

				if (!firstTokenReceived.isSettled) {
					firstTokenReceived.complete();
				}

				fetchStreamSource.resolve();

				logContext.setResponse(responseSoFar);
			});

		const llmLinesStream = toLines(fetchStreamSource.stream);

		// logging of times
		// removal of cursor tag if option is set
		const linesStream = (() => {
			let i = 0;
			return llmLinesStream.map((v) => {

				const trace = `Line ${i++} emitted with latency ${fetchRequestStopWatch.elapsed()} ms`;
				logContext.addLog(trace);
				tracer.trace(trace);

				return opts.shouldRemoveCursorTagFromResponse
					? v.replaceAll(PromptTags.CURSOR, '')
					: v;
			});
		})();

		let cleanedLinesStream: AsyncIterableObject<string>;

		if (opts.responseFormat === xtabPromptOptions.ResponseFormat.EditWindowOnly) {
			cleanedLinesStream = linesStream;
		} else if (opts.responseFormat === xtabPromptOptions.ResponseFormat.UnifiedWithXml) {
			const linesIter = linesStream[Symbol.asyncIterator]();
			const firstLine = await linesIter.next();

			if (chatResponseFailure !== undefined) { // handle fetch failure
				pushEdit(Result.error(new NoNextEditReason.Unexpected(errors.fromUnknown(chatResponseFailure))));
				return;
			}

			if (firstLine.done) { // no lines in response -- unexpected case but take as no suggestions
				pushEdit(Result.error(new NoNextEditReason.NoSuggestions(request.documentBeforeEdits, editWindow)));
				return;
			}

			const trimmedLines = firstLine.value.trim();

			if (trimmedLines === ResponseTags.NO_CHANGE.start) {
				await this.pushNoSuggestionsOrRetry(request, editWindow, promptPieces, pushEdit, delaySession, logContext, cancellationToken, telemetryBuilder, opts.retryState);
				return;
			}

			if (trimmedLines === ResponseTags.INSERT.start) {
				const lineWithCursorContinued = await linesIter.next();
				if (lineWithCursorContinued.done || lineWithCursorContinued.value.includes(ResponseTags.INSERT.end)) {
					pushEdit(Result.error(new NoNextEditReason.NoSuggestions(request.documentBeforeEdits, editWindow)));
					return;
				}
				const edit = new LineReplacement(
					new LineRange(editWindowLineRange.start + cursorOriginalLinesOffset + 1 /* 0-based to 1-based */, editWindowLineRange.start + cursorOriginalLinesOffset + 2),
					[editWindowLines[cursorOriginalLinesOffset].slice(0, cursorLineOffset - 1) + lineWithCursorContinued.value + editWindowLines[cursorOriginalLinesOffset].slice(cursorLineOffset - 1)]
				);
				pushEdit(Result.ok({ edit, window: editWindow }));

				const lines: string[] = [];
				let v = await linesIter.next();
				while (!v.done) {
					if (v.value.includes(ResponseTags.INSERT.end)) {
						break;
					} else {
						lines.push(v.value);
					}
					v = await linesIter.next();
				}

				const line = editWindowLineRange.start + cursorOriginalLinesOffset + 2;
				pushEdit(Result.ok({
					edit: new LineReplacement(
						new LineRange(line, line),
						lines
					),
					window: editWindow
				}));

				pushEdit(Result.error(new NoNextEditReason.NoSuggestions(request.documentBeforeEdits, editWindow)));
				return;
			}

			if (trimmedLines === ResponseTags.EDIT.start) {
				cleanedLinesStream = new AsyncIterableObject(async (emitter) => {
					let v = await linesIter.next();
					while (!v.done) {
						if (v.value.includes(ResponseTags.EDIT.end)) {
							return;
						}
						emitter.emitOne(v.value);
						v = await linesIter.next();
					}
				});
			} else {
				pushEdit(Result.error(new NoNextEditReason.Unexpected(new Error(`unexpected tag ${trimmedLines}`))));
				return;
			}
		} else if (opts.responseFormat === xtabPromptOptions.ResponseFormat.CodeBlock) {
			cleanedLinesStream = linesWithBackticksRemoved(linesStream);
		} else {
			assertNever(opts.responseFormat);
		}

		const diffOptions: ResponseProcessor.DiffParams = {
			emitFastCursorLineChange: opts.showLabel
				? false
				: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabProviderEmitFastCursorLineChange, this.expService),
			nLinesToConverge: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabNNonSignificantLinesToConverge, this.expService),
			nSignificantLinesToConverge: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabNSignificantLinesToConverge, this.expService),
		};

		(async () => {
			let i = 0;
			let hasBeenDelayed = false;
			try {
				for await (const edit of ResponseProcessor.diff(editWindowLines, cleanedLinesStream, cursorOriginalLinesOffset, diffOptions)) {

					const singleLineEdits: LineReplacement[] = [];
					if (edit.lineRange.startLineNumber === edit.lineRange.endLineNumberExclusive || // we don't want to run diff on insertion
						edit.newLines.length === 0 || // we don't want to run diff on deletion
						edit.lineRange.endLineNumberExclusive - edit.lineRange.startLineNumber === 1 && edit.newLines.length === 1 // we want to run diff on single line edits
					) {
						const singleLineEdit = new LineReplacement(new LineRange(edit.lineRange.startLineNumber + editWindowLineRange.start, edit.lineRange.endLineNumberExclusive + editWindowLineRange.start), edit.newLines);
						singleLineEdits.push(singleLineEdit);
					} else {
						const affectedOriginalLines = editWindowLines.slice(edit.lineRange.startLineNumber - 1, edit.lineRange.endLineNumberExclusive - 1).join('\n');

						const diffResult = await this.diffService.computeDiff(affectedOriginalLines, edit.newLines.join('\n'), {
							ignoreTrimWhitespace: false,
							maxComputationTimeMs: 0,
							computeMoves: false
						});

						const translateByNLines = editWindowLineRange.start + edit.lineRange.startLineNumber;
						for (const change of diffResult.changes) {
							const singleLineEdit = new LineReplacement(
								new LineRange(
									translateByNLines + change.original.startLineNumber - 1,
									translateByNLines + change.original.endLineNumberExclusive - 1
								),
								edit.newLines.slice(change.modified.startLineNumber - 1, change.modified.endLineNumberExclusive - 1)
							);
							singleLineEdits.push(singleLineEdit);
						}
					}

					if (chatResponseFailure) { // do not emit edits if chat response failed
						break;
					}

					logContext.setResponse(responseSoFar);

					for (const singleLineEdit of singleLineEdits) {
						this.trace(`pushing edit #${i}:\n${singleLineEdit.toString()}`, logContext, tracer);

						if (!hasBeenDelayed) { // delay only the first one
							hasBeenDelayed = true;
							await this.enforceArtificialDelay(delaySession, telemetryBuilder);
						}

						pushEdit(Result.ok({ edit: singleLineEdit, window: editWindow, showLabel: opts.showLabel }));
						i++;
					}
				}

				if (chatResponseFailure) {
					pushEdit(Result.error(XtabProvider.mapChatFetcherErrorToNoNextEditReason(chatResponseFailure)));
					return;
				}

				const hadEdits = i > 0;
				if (hadEdits) {
					pushEdit(Result.error(new NoNextEditReason.NoSuggestions(request.documentBeforeEdits, editWindow)));
				} else {
					await this.pushNoSuggestionsOrRetry(request, editWindow, promptPieces, pushEdit, delaySession, logContext, cancellationToken, telemetryBuilder, opts.retryState);
				}

			} catch (err) {
				logContext.setError(err);
				// Properly handle the error by pushing it as a result
				pushEdit(Result.error(new NoNextEditReason.Unexpected(errors.fromUnknown(err))));
			}
		})();
	}

	private async pushNoSuggestionsOrRetry(
		request: StatelessNextEditRequest,
		editWindow: OffsetRange,
		promptPieces: PromptPieces,
		pushEdit: PushEdit,
		delaySession: DelaySession,
		logContext: InlineEditRequestLogContext,
		cancellationToken: CancellationToken,
		telemetryBuilder: StatelessNextEditTelemetryBuilder,
		retryState: RetryState,
	) {
		const allowRetryWithExpandedWindow = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabProviderRetryWithNMoreLinesBelow, this.expService);

		// if allowed to retry and not retrying already, flip the retry state and try again
		if (allowRetryWithExpandedWindow && retryState === RetryState.NotRetrying && request.expandedEditWindowNLines === undefined) {
			this.doGetNextEdit(request, pushEdit, delaySession, logContext, cancellationToken, telemetryBuilder, RetryState.Retrying);
			return;
		}

		let nextCursorLinePrediction = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsNextCursorPredictionEnabled, this.expService);
		nextCursorLinePrediction = (
			nextCursorLinePrediction === true ? NextCursorLinePrediction.OnlyWithEdit :
				(nextCursorLinePrediction === false ? undefined : nextCursorLinePrediction)
		);
		if (nextCursorLinePrediction !== undefined && retryState === RetryState.NotRetrying) {
			const nextCursorLineR = await this.predictNextCursorPosition(promptPieces);
			if (cancellationToken.isCancellationRequested) {
				pushEdit(Result.error(new NoNextEditReason.NoSuggestions(request.documentBeforeEdits, editWindow)));
				return;
			}

			if (nextCursorLineR.isError()) {
				this.tracer.trace(`Predicted next cursor line error: ${nextCursorLineR.err.message}`);
				telemetryBuilder.setNextCursorLineError(nextCursorLineR.err.message);
			} else {
				const nextCursorLineZeroBased = nextCursorLineR.val;

				const lineDistanceFromCursorLine = nextCursorLineZeroBased - promptPieces.currentDocument.cursorLineOffset;
				telemetryBuilder.setNextCursorLineDistance(lineDistanceFromCursorLine);

				this.tracer.trace(`Predicted next cursor line: ${nextCursorLineZeroBased}`);

				if (nextCursorLineZeroBased >= promptPieces.currentDocument.lines.length) { // >= because the line index is zero-based
					this.tracer.trace(`Predicted next cursor line error: exceedsDocumentLines`);
					telemetryBuilder.setNextCursorLineError('exceedsDocumentLines');
				} else if (promptPieces.editWindowLinesRange.contains(nextCursorLineZeroBased)) {
					this.tracer.trace(`Predicted next cursor line error: withinEditWindow`);
					telemetryBuilder.setNextCursorLineError('withinEditWindow');
				} else {
					const nextCursorLineOneBased = nextCursorLineZeroBased + 1;
					const nextCursorLine = promptPieces.activeDoc.documentAfterEditsLines.at(nextCursorLineZeroBased);
					const nextCursorColumn = (nextCursorLine?.match(/^(\s+)/)?.at(0)?.length ?? 0) + 1;
					switch (nextCursorLinePrediction) {
						case NextCursorLinePrediction.Jump: {
							const nextCursorPosition = new Position(nextCursorLineOneBased, nextCursorColumn);
							pushEdit(Result.error(new NoNextEditReason.NoSuggestions(request.documentBeforeEdits, editWindow, nextCursorPosition)));
							return;
						}
						case NextCursorLinePrediction.OnlyWithEdit:
						case NextCursorLinePrediction.LabelOnlyWithEdit: {
							this.doGetNextEditWithSelection(
								request,
								new Range(nextCursorLineOneBased, nextCursorColumn, nextCursorLineOneBased, nextCursorColumn),
								pushEdit,
								delaySession,
								{ showLabel: nextCursorLinePrediction === NextCursorLinePrediction.LabelOnlyWithEdit },
								logContext,
								cancellationToken,
								telemetryBuilder, RetryState.Retrying,
							);
							return;
						}
						default: {
							assertNever(nextCursorLinePrediction);
						}
					}
				}
			}
		}

		pushEdit(Result.error(new NoNextEditReason.NoSuggestions(request.documentBeforeEdits, editWindow)));
		return;
	}

	private computeAreaAroundEditWindowLinesRange(currentDocument: CurrentDocument): OffsetRange {
		const cursorLine = currentDocument.cursorLineOffset;
		const areaAroundStart = Math.max(0, cursorLine - N_LINES_AS_CONTEXT);
		const areaAroundEndExcl = Math.min(currentDocument.lines.length, cursorLine + N_LINES_AS_CONTEXT + 1);

		return new OffsetRange(areaAroundStart, areaAroundEndExcl);
	}

	private computeEditWindowLinesRange(currentDocument: CurrentDocument, request: StatelessNextEditRequest, retryState: RetryState, telemetry: StatelessNextEditTelemetryBuilder): OffsetRange {
		const currentDocLines = currentDocument.lines;
		const cursorLineOffset = currentDocument.cursorLineOffset;

		let nLinesAbove: number;
		{
			const useVaryingLinesAbove = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabProviderUseVaryingLinesAbove, this.expService);

			if (useVaryingLinesAbove) {
				nLinesAbove = 0; // default

				for (let i = 0; i < 8; ++i) {
					const lineIdx = cursorLineOffset - i;
					if (lineIdx < 0) {
						break;
					}
					if (currentDocLines[lineIdx].trim() !== '') {
						nLinesAbove = i;
						break;
					}
				}
			} else {
				nLinesAbove = (this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabProviderNLinesAbove, this.expService)
					?? N_LINES_ABOVE);
			}
		}

		let nLinesBelow;

		if (request.expandedEditWindowNLines !== undefined) {
			this.tracer.trace(`Using expanded nLinesBelow: ${request.expandedEditWindowNLines}`);
			nLinesBelow = request.expandedEditWindowNLines;
		} else {
			const overriddenNLinesBelow = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabProviderNLinesBelow, this.expService);
			if (overriddenNLinesBelow !== undefined) {
				this.tracer.trace(`Using overridden nLinesBelow: ${overriddenNLinesBelow}`);
				nLinesBelow = overriddenNLinesBelow;
			} else {
				this.tracer.trace(`Using default nLinesBelow: ${N_LINES_BELOW}`);
				nLinesBelow = N_LINES_BELOW; // default
			}
		}

		if (retryState === RetryState.Retrying) {
			nLinesBelow += this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabProviderRetryWithNMoreLinesBelow, this.expService) ?? 0;
		}

		let codeToEditStart = Math.max(0, cursorLineOffset - nLinesAbove);
		let codeToEditEndExcl = Math.min(currentDocLines.length, cursorLineOffset + nLinesBelow + 1);

		const maxMergeConflictLines = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabMaxMergeConflictLines, this.expService);
		if (maxMergeConflictLines) {
			const tentativeEditWindow = new OffsetRange(codeToEditStart, codeToEditEndExcl);
			const mergeConflictRange = findMergeConflictMarkersRange(currentDocLines, tentativeEditWindow, maxMergeConflictLines);
			if (mergeConflictRange) {
				const onlyMergeConflictLines = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabOnlyMergeConflictLines, this.expService);
				telemetry.setMergeConflictExpanded(onlyMergeConflictLines ? 'only' : 'normal');
				if (onlyMergeConflictLines) {
					this.tracer.trace(`Expanding edit window to include ONLY merge conflict markers: ${mergeConflictRange.toString()}`);
					codeToEditStart = mergeConflictRange.start;
					codeToEditEndExcl = mergeConflictRange.endExclusive;
				} else {
					this.tracer.trace(`Expanding edit window to include merge conflict markers: ${mergeConflictRange.toString()}; edit window range [${codeToEditStart}, ${codeToEditEndExcl})`);
					codeToEditEndExcl = Math.max(codeToEditEndExcl, mergeConflictRange.endExclusive);
				}
			}
		}

		return new OffsetRange(codeToEditStart, codeToEditEndExcl);
	}

	private static mapChatFetcherErrorToNoNextEditReason(fetchError: ChatFetchError): NoNextEditReason {
		switch (fetchError.type) {
			case ChatFetchResponseType.Canceled:
				return new NoNextEditReason.GotCancelled('afterFetchCall');
			case ChatFetchResponseType.OffTopic:
			case ChatFetchResponseType.Filtered:
			case ChatFetchResponseType.PromptFiltered:
			case ChatFetchResponseType.Length:
			case ChatFetchResponseType.RateLimited:
			case ChatFetchResponseType.QuotaExceeded:
			case ChatFetchResponseType.ExtensionBlocked:
			case ChatFetchResponseType.AgentUnauthorized:
			case ChatFetchResponseType.AgentFailedDependency:
			case ChatFetchResponseType.InvalidStatefulMarker:
				return new NoNextEditReason.Uncategorized(errors.fromUnknown(fetchError));
			case ChatFetchResponseType.BadRequest:
			case ChatFetchResponseType.NotFound:
			case ChatFetchResponseType.Failed:
			case ChatFetchResponseType.NetworkError:
			case ChatFetchResponseType.Unknown:
				return new NoNextEditReason.FetchFailure(errors.fromUnknown(fetchError));
		}
	}

	private determineModelConfiguration(activeDocument: StatelessNextEditDocument): ModelConfig {
		if (this.forceUseDefaultModel) {
			return {
				modelName: undefined,
				...xtabPromptOptions.DEFAULT_OPTIONS,
			};
		}

		const promptingStrategy = this.determinePromptingStrategy();
		const sourcedModelConfig = {
			modelName: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabProviderModelName, this.expService),
			promptingStrategy,
			currentFile: {
				maxTokens: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabCurrentFileMaxTokens, this.expService),
				includeTags: promptingStrategy !== xtabPromptOptions.PromptingStrategy.UnifiedModel /* unified model doesn't use tags in current file */ && this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabIncludeTagsInCurrentFile, this.expService),
				prioritizeAboveCursor: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabPrioritizeAboveCursor, this.expService)
			},
			pagedClipping: {
				pageSize: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabPageSize, this.expService)
			},
			recentlyViewedDocuments: {
				nDocuments: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabNRecentlyViewedDocuments, this.expService),
				maxTokens: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabRecentlyViewedDocumentsMaxTokens, this.expService),
				includeViewedFiles: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabIncludeViewedFiles, this.expService),
			},
			languageContext: this.determineLanguageContextOptions(activeDocument.languageId, {
				enabled: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabLanguageContextEnabled, this.expService),
				enabledLanguages: this.configService.getConfig(ConfigKey.Internal.InlineEditsXtabLanguageContextEnabledLanguages),
				maxTokens: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabLanguageContextMaxTokens, this.expService),
			}),
			diffHistory: {
				nEntries: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabDiffNEntries, this.expService),
				maxTokens: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabDiffMaxTokens, this.expService),
				onlyForDocsInPrompt: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabDiffOnlyForDocsInPrompt, this.expService),
				useRelativePaths: this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabDiffUseRelativePaths, this.expService),
			},
			includePostScript: true,
		};

		const localOverridingModelConfig = this.configService.getConfig(ConfigKey.Internal.InlineEditsXtabProviderModelConfiguration);
		if (localOverridingModelConfig) {
			return XtabProvider.overrideModelConfig(sourcedModelConfig, localOverridingModelConfig);
		}

		const expBasedModelConfig = this.overrideByStringModelConfig(sourcedModelConfig, ConfigKey.Internal.InlineEditsXtabProviderModelConfigurationString);
		if (expBasedModelConfig) {
			return expBasedModelConfig;
		}

		const defaultModelConfig = this.overrideByStringModelConfig(sourcedModelConfig, ConfigKey.Internal.InlineEditsXtabProviderDefaultModelConfigurationString);
		if (defaultModelConfig) {
			return defaultModelConfig;
		}

		return sourcedModelConfig;
	}

	private overrideByStringModelConfig(originalModelConfig: ModelConfig, configKey: ExperimentBasedConfig<string | undefined>): ModelConfig | undefined {
		const configString = this.configService.getExperimentBasedConfig(configKey, this.expService);
		if (configString === undefined) {
			return undefined;
		}

		let parsedConfig: xtabPromptOptions.ModelConfiguration | undefined;
		try {
			parsedConfig = JSON.parse(configString);
		} catch (e: unknown) {
			/* __GDPR__
				"incorrectNesModelConfig" : {
					"owner": "ulugbekna",
					"comment": "Capture if model configuration string is invalid JSON.",
					"configName": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Name of the configuration that failed to parse." },
					"errorMessage": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Error message from JSON.parse." },
					"configValue": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The invalid JSON string." }
				}
			*/
			this.telemetryService.sendMSFTTelemetryEvent('incorrectNesModelConfig', { configName: configKey.id, errorMessage: errors.toString(errors.fromUnknown(e)), configValue: configString });
		}

		if (parsedConfig) {
			return XtabProvider.overrideModelConfig(originalModelConfig, parsedConfig);
		}

		return undefined;
	}

	private static overrideModelConfig(modelConfig: ModelConfig, overridingConfig: xtabPromptOptions.ModelConfiguration): ModelConfig {
		return {
			...modelConfig,
			modelName: overridingConfig.modelName,
			promptingStrategy: overridingConfig.promptingStrategy,
			currentFile: {
				...modelConfig.currentFile,
				includeTags: overridingConfig.includeTagsInCurrentFile,
			},
		};
	}

	private async predictNextCursorPosition(promptPieces: PromptPieces): Promise<Result</* zero-based line number */ number, Error>> {

		const tracer = this.tracer.sub('predictNextCursorPosition');

		const systemMessage = 'Your task is to predict the next line number in the current file where the developer is most likely to make their next edit, using the provided context.';

		const maxTokens = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsNextCursorPredictionCurrentFileMaxTokens, this.expService);

		const currentFileContentR = this.constructTaggedFile(
			promptPieces.currentDocument,
			promptPieces.editWindowLinesRange,
			promptPieces.areaAroundEditWindowLinesRange,
			{
				...promptPieces.opts,
				currentFile: {
					...promptPieces.opts.currentFile,
					maxTokens,
					includeTags: false,
				}
			},
			XtabProvider.computeTokens,
			{ includeLineNumbers: true }
		);

		if (currentFileContentR.isError()) {
			tracer.trace(`Failed to construct tagged file: ${currentFileContentR.err}`);
			return Result.fromString(currentFileContentR.err);
		}

		const { taggedCurrentFileR: { taggedCurrentFileContent }, areaAroundCodeToEdit } = currentFileContentR.val;

		const newPromptPieces = new PromptPieces(
			promptPieces.currentDocument,
			promptPieces.editWindowLinesRange,
			promptPieces.areaAroundEditWindowLinesRange,
			promptPieces.activeDoc,
			promptPieces.xtabHistory,
			taggedCurrentFileContent,
			areaAroundCodeToEdit,
			promptPieces.langCtx,
			XtabProvider.computeTokens,
			{
				...promptPieces.opts,
				includePostScript: false,
			}
		);

		const userMessage = getUserPrompt(newPromptPieces);

		const messages = constructMessages({
			systemMsg: systemMessage,
			userMsg: userMessage
		});

		const modelName = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsNextCursorPredictionModelName, this.expService);
		if (modelName === undefined) {
			tracer.trace('Model name for cursor prediction is not defined; skipping prediction');
			return Result.fromString('modelNameNotDefined');
		}

		const url = this.configService.getConfig(ConfigKey.Internal.InlineEditsNextCursorPredictionUrl);
		const secretKey = this.configService.getConfig(ConfigKey.Internal.InlineEditsNextCursorPredictionApiKey);

		const endpoint = this.instaService.createInstance(ChatEndpoint, {
			id: modelName,
			name: 'nes.nextCursorPosition',
			urlOrRequestMetadata: url ? url : { type: RequestType.ProxyChatCompletions },
			model_picker_enabled: false,
			is_chat_default: false,
			is_chat_fallback: false,
			version: '',
			capabilities: {
				type: 'chat',
				family: '',
				tokenizer: TokenizerType.CL100K,
				limits: undefined,
				supports: {
					parallel_tool_calls: false,
					tool_calls: false,
					streaming: true,
					vision: false,
					prediction: false,
					thinking: false
				}
			},
		});

		const response = await endpoint.makeChatRequest2(
			{
				messages,
				debugName: 'nes.nextCursorPosition',
				finishedCb: undefined,
				location: ChatLocation.Other,
				requestOptions: secretKey ? {
					secretKey,
				} : undefined,
			},
			CancellationToken.None
		);

		if (response.type !== ChatFetchResponseType.Success) {
			return Result.fromString(`fetchError:${response.type}`);
		}

		try {
			const trimmed = response.value.trim();
			const lineNumber = parseInt(trimmed, 10);
			if (isNaN(lineNumber)) {
				return Result.fromString(`gotNaN`);
			}
			if (lineNumber < 0) {
				return Result.fromString(`negativeLineNumber`);
			}

			return Result.ok(lineNumber);
		} catch (err: unknown) {
			tracer.trace(`Failed to parse predicted line number from response '${response.value}': ${err}`);
			return Result.fromString(`failedToParseLine:"${response.value}". Error ${errors.fromUnknown(err).message}`);
		}
	}

	private determinePromptingStrategy(): xtabPromptOptions.PromptingStrategy | undefined {
		const isXtabUnifiedModel = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabUseUnifiedModel, this.expService);
		const isCodexV21NesUnified = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabCodexV21NesUnified, this.expService);
		const useSimplifiedPrompt = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabProviderUseSimplifiedPrompt, this.expService);
		const useXtab275Prompting = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabProviderUseXtab275Prompting, this.expService);
		const useNes41Miniv3Prompting = this.configService.getExperimentBasedConfig(ConfigKey.Internal.InlineEditsXtabUseNes41Miniv3Prompting, this.expService);

		if (isXtabUnifiedModel) {
			return xtabPromptOptions.PromptingStrategy.UnifiedModel;
		} else if (isCodexV21NesUnified) {
			return xtabPromptOptions.PromptingStrategy.Codexv21NesUnified;
		} else if (useSimplifiedPrompt) {
			return xtabPromptOptions.PromptingStrategy.SimplifiedSystemPrompt;
		} else if (useXtab275Prompting) {
			return xtabPromptOptions.PromptingStrategy.Xtab275;
		} else if (useNes41Miniv3Prompting) {
			return xtabPromptOptions.PromptingStrategy.Nes41Miniv3;
		} else {
			return undefined;
		}
	}

	private pickSystemPrompt(promptingStrategy: xtabPromptOptions.PromptingStrategy | undefined): string {
		switch (promptingStrategy) {
			case xtabPromptOptions.PromptingStrategy.UnifiedModel:
				return unifiedModelSystemPrompt;
			case xtabPromptOptions.PromptingStrategy.Codexv21NesUnified:
			case xtabPromptOptions.PromptingStrategy.SimplifiedSystemPrompt:
				return simplifiedPrompt;
			case xtabPromptOptions.PromptingStrategy.Xtab275:
				return xtab275SystemPrompt;
			case xtabPromptOptions.PromptingStrategy.Nes41Miniv3:
				return nes41Miniv3SystemPrompt;
			default:
				return systemPromptTemplate;
		}
	}

	private determineLanguageContextOptions(languageId: LanguageId, { enabled, enabledLanguages, maxTokens }: { enabled: boolean; enabledLanguages: LanguageContextLanguages; maxTokens: number }): LanguageContextOptions {
		// Some languages are
		if (languageId in enabledLanguages) {
			return { enabled: enabledLanguages[languageId], maxTokens };
		}

		return { enabled, maxTokens };
	}

	private getEndpoint(configuredModelName: string | undefined): ChatEndpoint {
		const url = this.configService.getConfig(ConfigKey.Internal.InlineEditsXtabProviderUrl);
		const apiKey = this.configService.getConfig(ConfigKey.Internal.InlineEditsXtabProviderApiKey);
		const hasOverriddenUrlAndApiKey = url !== undefined && apiKey !== undefined;

		if (hasOverriddenUrlAndApiKey) {
			return this.instaService.createInstance(XtabEndpoint, url, apiKey, configuredModelName);
		}

		return createProxyXtabEndpoint(this.instaService, configuredModelName);
	}

	private getPredictedOutput(editWindowLines: string[], responseFormat: xtabPromptOptions.ResponseFormat): Prediction | undefined {
		return this.configService.getConfig(ConfigKey.Internal.InlineEditsXtabProviderUsePrediction)
			? {
				type: 'content',
				content: XtabProvider.getPredictionContents(editWindowLines, responseFormat)
			}
			: undefined;
	}

	private static getPredictionContents(editWindowLines: readonly string[], responseFormat: xtabPromptOptions.ResponseFormat): string {
		if (responseFormat === xtabPromptOptions.ResponseFormat.UnifiedWithXml) {
			return ['<EDIT>', ...editWindowLines, '</EDIT>'].join('\n');
		} else if (responseFormat === xtabPromptOptions.ResponseFormat.EditWindowOnly) {
			return editWindowLines.join('\n');
		} else if (responseFormat === xtabPromptOptions.ResponseFormat.CodeBlock) {
			return ['```', ...editWindowLines, '```'].join('\n');
		} else {
			assertNever(responseFormat);
		}
	}

	private async debounce(delaySession: DelaySession, telemetry: StatelessNextEditTelemetryBuilder) {
		if (this.simulationCtx.isInSimulationTests) {
			return;
		}
		const debounceTime = delaySession.getDebounceTime();

		this.tracer.trace(`Debouncing for ${debounceTime} ms`);
		telemetry.setDebounceTime(debounceTime);

		await timeout(debounceTime);
	}

	private async enforceArtificialDelay(delaySession: DelaySession, telemetry: StatelessNextEditTelemetryBuilder) {
		if (this.simulationCtx.isInSimulationTests) {
			return;
		}
		const artificialDelay = delaySession.getArtificialDelay();

		this.tracer.trace(`Enforcing artificial delay of ${artificialDelay} ms`);
		telemetry.setArtificialDelay(artificialDelay);

		if (artificialDelay > 0) {
			await timeout(artificialDelay);
		}
	}

	private trace(msg: string, logContext: InlineEditRequestLogContext, tracer: ITracer) {
		tracer.trace(msg);
		logContext.addLog(msg);
	}
}

/**
 * Finds the range of lines containing merge conflict markers within a specified edit window.
 *
 * @param lines - Array of strings representing the lines of text to search through
 * @param editWindowRange - The range within which to search for merge conflict markers
 * @param maxMergeConflictLines - Maximum number of lines to search for conflict markers
 * @returns An OffsetRange object representing the start and end of the conflict markers, or undefined if not found
 */
export function findMergeConflictMarkersRange(lines: string[], editWindowRange: OffsetRange, maxMergeConflictLines: number): OffsetRange | undefined {
	for (let i = editWindowRange.start; i < Math.min(lines.length, editWindowRange.endExclusive); ++i) {
		if (!lines[i].startsWith('<<<<<<<')) {
			continue;
		}

		// found start of merge conflict markers -- now find the end
		for (let j = i + 1; j < lines.length && (j - i) < maxMergeConflictLines; ++j) {
			if (lines[j].startsWith('>>>>>>>')) {
				return new OffsetRange(i, j + 1 /* because endExclusive */);
			}
		}
	}
	return undefined;
}

function constructMessages({ systemMsg, userMsg }: { systemMsg: string; userMsg: string }): Raw.ChatMessage[] {
	return [
		{
			role: Raw.ChatRole.System,
			content: toTextParts(systemMsg)
		},
		{
			role: Raw.ChatRole.User,
			content: toTextParts(userMsg)
		}
	] satisfies Raw.ChatMessage[];
}

function charCount(messages: Raw.ChatMessage[]): number {
	const promptCharCount = messages.reduce((total, msg) =>
		total + msg.content.reduce((subtotal, part) =>
			subtotal + (part.type === ChatCompletionContentPartKind.Text ? part.text.length : 0), 0), 0);
	return promptCharCount;
}
