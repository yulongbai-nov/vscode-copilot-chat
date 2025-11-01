/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** @jsxRuntime automatic */
/** @jsxImportSource ../../../../prompt/jsx-runtime/ */
import { CopilotContentExclusionManager, StatusBarEvent } from '../../contentExclusion/contentExclusionManager';
import { ICompletionsContextService } from '../../context';
import { logger, LogTarget } from '../../logger';

import { IInstantiationService, ServicesAccessor } from '../../../../../../../util/vs/platform/instantiation/common/instantiation';
import { ICompletionsTelemetryService } from '../../../../bridge/src/completionsTelemetryServiceBridge';
import { DataPipe, VirtualPrompt } from '../../../../prompt/src/components/virtualPrompt';
import { TokenizerName } from '../../../../prompt/src/tokenization';
import { CancellationToken, Position } from '../../../../types/src';
import { CompletionState } from '../../completionState';
import { telemetryException, TelemetryWithExp } from '../../telemetry';
import { TextDocumentContents } from '../../textDocument';
import { CodeSnippets } from '../components/codeSnippets';
import { CompletionsContext } from '../components/completionsContext';
import { CompletionsPromptOk, CompletionsPromptRenderer } from '../components/completionsPromptRenderer';
import { ContextProviderBridge } from '../components/contextProviderBridge';
import { CurrentFile } from '../components/currentFile';
import { DocumentMarker } from '../components/marker';
import { RecentEdits } from '../components/recentEdits';
import { SimilarFiles } from '../components/similarFiles';
import { splitContextCompletionsPrompt } from '../components/splitContextPrompt';
import { SplitContextPromptRenderer } from '../components/splitContextPromptRenderer';
import { Traits } from '../components/traits';
import {
	ContextProviderTelemetry,
	matchContextItems,
	ResolvedContextItem,
	telemetrizeContextItems,
	useContextProviderAPI,
} from '../contextProviderRegistry';
import { getCodeSnippetsFromContextItems } from '../contextProviders/codeSnippets';
import {
	CodeSnippetWithId,
	SupportedContextItemWithId,
	TraitWithId,
} from '../contextProviders/contextItemSchemas';
import { getTraitsFromContextItems, ReportTraitsTelemetry } from '../contextProviders/traits';
import { componentStatisticsToPromptMatcher, ContextProviderStatistics } from '../contextProviderStatistics';
import {
	_contextTooShort,
	_copilotContentExclusion,
	_promptCancelled,
	_promptError,
	getPromptOptions,
	MIN_PROMPT_CHARS,
	PromptResponse,
	trimLastLine,
} from '../prompt';
import { isIncludeNeighborFilesActive } from '../similarFiles/neighborFiles';
import {
	CompletionsPromptFactory,
	CompletionsPromptOptions,
	PromptOpts,
} from './completionsPromptFactory';

export type CompletionRequestDocument = TextDocumentContents;

export type CompletionRequestData = {
	document: CompletionRequestDocument;
	position: Position;
	telemetryData: TelemetryWithExp;
	cancellationToken?: CancellationToken;
	// see inlineCompletions data param
	data?: unknown;
	// Context provider items
	traits?: TraitWithId[];
	codeSnippets?: CodeSnippetWithId[];
	turnOffSimilarFiles?: boolean;
	suffixMatchThreshold?: number;
	maxPromptTokens: number;
	tokenizer?: TokenizerName;
};

export function isCompletionRequestData(data: unknown): data is CompletionRequestData {
	if (!data || typeof data !== 'object') { return false; }

	const req = data as Partial<CompletionRequestData>;

	// Check document
	if (!req.document) { return false; }

	// Check position
	if (!req.position) { return false; }
	if (req.position.line === undefined) { return false; }
	if (req.position.character === undefined) { return false; }

	// Check telemetryData
	if (!req.telemetryData) { return false; }

	return true;
}

export enum PromptOrdering {
	Default = 'default',
	SplitContext = 'splitContext',
}

type DeclarativePromptFunction = typeof defaultCompletionsPrompt;
type AvailableDeclarativePrompts = {
	[K in PromptOrdering]: {
		promptFunction: DeclarativePromptFunction;
		renderer: typeof CompletionsPromptRenderer;
	};
};

const availableDeclarativePrompts: AvailableDeclarativePrompts = {
	[PromptOrdering.Default]: {
		promptFunction: defaultCompletionsPrompt,
		renderer: CompletionsPromptRenderer,
	},
	[PromptOrdering.SplitContext]: {
		promptFunction: splitContextCompletionsPrompt,
		renderer: SplitContextPromptRenderer,
	},
};

// The weights mimic the PromptPriorityList from prompt/src/wishlist.ts
function defaultCompletionsPrompt(accessor: ServicesAccessor) {
	const ctx = accessor.get(ICompletionsContextService);
	return (
		<>
			<CompletionsContext>
				<DocumentMarker ctx={ctx} weight={0.7} />
				<Traits weight={0.6} />
				<CodeSnippets ctx={ctx} weight={0.9} />
				<SimilarFiles ctx={ctx} weight={0.8} />
				<RecentEdits ctx={ctx} weight={0.99} />
			</CompletionsContext>
			<CurrentFile weight={1} />
		</>
	);
}

// Exported for testing
export class ComponentsCompletionsPromptFactory implements CompletionsPromptFactory {
	private virtualPrompt: VirtualPrompt;
	private pipe: DataPipe;
	private renderer: CompletionsPromptRenderer;
	private promptOrdering: PromptOrdering;
	private logTarget;

	constructor(
		virtualPrompt: VirtualPrompt | undefined = undefined,
		ordering: PromptOrdering | undefined = undefined,
		@ICompletionsContextService private readonly ctx: ICompletionsContextService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICompletionsTelemetryService private readonly completionsTelemetryService: ICompletionsTelemetryService,
	) {
		this.logTarget = this.ctx.get(LogTarget);
		this.promptOrdering = ordering ?? PromptOrdering.Default;
		this.virtualPrompt = virtualPrompt ?? new VirtualPrompt(this.completionsPrompt());
		this.pipe = this.virtualPrompt.createPipe();
		this.renderer = this.getRenderer();
	}

	async prompt(opts: CompletionsPromptOptions, cancellationToken?: CancellationToken): Promise<PromptResponse> {
		try {
			return await this.createPromptUnsafe(opts, cancellationToken);
		} catch (e) {
			return this.errorPrompt(e as Error);
		}
	}

	async createPromptUnsafe(
		{ completionId, completionState, telemetryData, promptOpts }: CompletionsPromptOptions,
		cancellationToken?: CancellationToken
	): Promise<PromptResponse> {
		const { maxPromptLength, suffixPercent, suffixMatchThreshold } = this.instantiationService.invokeFunction(getPromptOptions,
			telemetryData,
			completionState.textDocument.detectedLanguageId
		);

		const failFastPrompt = await this.failFastPrompt(
			completionState.textDocument,
			completionState.position,
			suffixPercent,
			cancellationToken
		);
		if (failFastPrompt) {
			return failFastPrompt;
		}

		// TODO: Prompt ordering changes are triggered by ExP changes.
		// TODO@benibenj remove this as its always true (except in tests)
		const promptOrdering = promptOpts?.separateContext ? PromptOrdering.SplitContext : PromptOrdering.Default;
		this.setPromptOrdering(promptOrdering);

		const start = performance.now();

		const { traits, codeSnippets, turnOffSimilarFiles, resolvedContextItems } = await this.resolveContext(
			completionId,
			completionState,
			telemetryData,
			cancellationToken,
			promptOpts
		);

		await this.updateComponentData(
			completionState.textDocument,
			completionState.position,
			traits,
			codeSnippets,
			telemetryData,
			turnOffSimilarFiles,
			maxPromptLength,
			cancellationToken,
			promptOpts,
			suffixMatchThreshold,
			promptOpts?.tokenizer
		);

		if (cancellationToken?.isCancellationRequested) {
			return _promptCancelled;
		}

		const snapshot = this.virtualPrompt.snapshot(cancellationToken);
		const snapshotStatus = snapshot.status;
		if (snapshotStatus === 'cancelled') {
			return _promptCancelled;
		} else if (snapshotStatus === 'error') {
			return this.errorPrompt(snapshot.error);
		}

		const rendered = this.renderer.render(
			snapshot.snapshot!,
			{
				delimiter: '\n',
				tokenizer: promptOpts?.tokenizer,
				promptTokenLimit: maxPromptLength,
				suffixPercent: suffixPercent,
				languageId: completionState.textDocument.detectedLanguageId,
			},
			cancellationToken
		);
		if (rendered.status === 'cancelled') {
			return _promptCancelled;
		} else if (rendered.status === 'error') {
			return this.errorPrompt(rendered.error);
		}

		const [prefix, trailingWs] = trimLastLine(rendered.prefix);
		const renderedTrimmed = { ...rendered, prefix };

		let contextProvidersTelemetry: ContextProviderTelemetry[] | undefined = undefined;
		const languageId = completionState.textDocument.detectedLanguageId;
		if (this.instantiationService.invokeFunction(useContextProviderAPI, languageId, telemetryData)) {
			const promptMatcher = componentStatisticsToPromptMatcher(rendered.metadata.componentStatistics);
			this.ctx
				.get(ContextProviderStatistics)
				.getStatisticsForCompletion(completionId)
				.computeMatch(promptMatcher);
			contextProvidersTelemetry = telemetrizeContextItems(this.ctx, completionId, resolvedContextItems);
			// To support generating context provider metrics of completion in COffE.
			logger.debug(this.logTarget, `Context providers telemetry: '${JSON.stringify(contextProvidersTelemetry)}'`);
		}
		const end = performance.now();
		this.resetIfEmpty(rendered);
		return this.successPrompt(renderedTrimmed, end, start, trailingWs, contextProvidersTelemetry);
	}

	private async updateComponentData(
		textDocument: CompletionRequestDocument,
		position: Position,
		traits: TraitWithId[] | undefined,
		codeSnippets: CodeSnippetWithId[] | undefined,
		telemetryData: TelemetryWithExp,
		turnOffSimilarFiles: boolean,
		maxPromptLength: number,
		cancellationToken?: CancellationToken,
		opts: PromptOpts = {},
		suffixMatchThreshold?: number,
		tokenizer?: TokenizerName
	) {
		const completionRequestData = this.createRequestData(
			textDocument,
			position,
			telemetryData,
			cancellationToken,
			opts,
			maxPromptLength,
			traits,
			codeSnippets,
			turnOffSimilarFiles,
			suffixMatchThreshold,
			tokenizer
		);
		await this.pipe.pump(completionRequestData);
	}

	private async resolveContext(
		completionId: string,
		completionState: CompletionState,
		telemetryData: TelemetryWithExp,
		cancellationToken?: CancellationToken,
		opts: PromptOpts = {}
	): Promise<{
		traits: TraitWithId[] | undefined;
		codeSnippets: CodeSnippetWithId[] | undefined;
		turnOffSimilarFiles: boolean;
		resolvedContextItems: ResolvedContextItem[];
	}> {
		let resolvedContextItems: ResolvedContextItem[] = [];
		let traits: TraitWithId[] | undefined;
		let codeSnippets: CodeSnippetWithId[] | undefined;
		let turnOffSimilarFiles = false;
		if (this.instantiationService.invokeFunction(useContextProviderAPI, completionState.textDocument.detectedLanguageId, telemetryData)) {
			resolvedContextItems = await this.ctx.get(ContextProviderBridge).resolution(completionId);
			const { textDocument } = completionState;
			// Turn off neighboring files if:
			// - it's not explicitly enabled via EXP flag
			// - there are matched context providers
			const matchedContextItems = resolvedContextItems.filter(matchContextItems);
			if (!this.instantiationService.invokeFunction(similarFilesEnabled, textDocument.detectedLanguageId, matchedContextItems, telemetryData)) {
				turnOffSimilarFiles = true;
			}

			traits = await this.instantiationService.invokeFunction(getTraitsFromContextItems, completionId, matchedContextItems);
			void this.instantiationService.invokeFunction(ReportTraitsTelemetry,
				`contextProvider.traits`,
				traits,
				textDocument.detectedLanguageId,
				textDocument.detectedLanguageId, // TextDocumentContext does not have clientLanguageId
				telemetryData
			);

			codeSnippets = await this.instantiationService.invokeFunction(getCodeSnippetsFromContextItems,
				completionId,
				matchedContextItems,
				textDocument.detectedLanguageId
			);
		}
		return { traits, codeSnippets, turnOffSimilarFiles, resolvedContextItems };
	}

	private async failFastPrompt(
		textDocument: TextDocumentContents,
		position: Position,
		suffixPercent: number,
		cancellationToken: CancellationToken | undefined
	) {
		if (cancellationToken?.isCancellationRequested) {
			return _promptCancelled;
		}
		if (
			(
				await this.ctx
					.get(CopilotContentExclusionManager)
					.evaluate(textDocument.uri, textDocument.getText(), StatusBarEvent.UPDATE)
			).isBlocked
		) {
			return _copilotContentExclusion;
		}

		const eligibleChars = suffixPercent > 0 ? textDocument.getText().length : textDocument.offsetAt(position);
		if (eligibleChars < MIN_PROMPT_CHARS) {
			// Too short context
			return _contextTooShort;
		}
	}

	private createRequestData(
		textDocument: CompletionRequestDocument,
		position: Position,
		telemetryData: TelemetryWithExp,
		cancellationToken: CancellationToken | undefined,
		opts: PromptOpts,
		maxPromptLength: number,
		traits?: TraitWithId[],
		codeSnippets?: CodeSnippetWithId[],
		turnOffSimilarFiles?: boolean,
		suffixMatchThreshold?: number,
		tokenizer?: TokenizerName
	): CompletionRequestData {
		return {
			document: textDocument,
			position,
			telemetryData,
			cancellationToken,
			data: opts.data,
			traits,
			codeSnippets,
			turnOffSimilarFiles,
			suffixMatchThreshold,
			maxPromptTokens: maxPromptLength,
			tokenizer,
		};
	}

	private resetIfEmpty(rendered: CompletionsPromptOk) {
		if (rendered.prefix.length === 0 && rendered.suffix.length === 0) {
			this.reset();
		}
	}

	private successPrompt(
		rendered: CompletionsPromptOk,
		end: number,
		start: number,
		trailingWs: string,
		contextProvidersTelemetry?: ContextProviderTelemetry[]
	): PromptResponse {
		return {
			type: 'prompt',
			prompt: {
				prefix: rendered.prefix,
				prefixTokens: rendered.prefixTokens,
				suffix: rendered.suffix,
				suffixTokens: rendered.suffixTokens,
				context: rendered.context,
				isFimEnabled: rendered.suffix.length > 0,
			},
			computeTimeMs: end - start,
			trailingWs,
			neighborSource: new Map(),
			metadata: rendered.metadata,
			contextProvidersTelemetry,
		};
	}

	private errorPrompt(error: Error): PromptResponse {
		telemetryException(this.completionsTelemetryService, error, 'PromptComponents.CompletionsPromptFactory');
		this.reset();
		return _promptError;
	}

	private reset() {
		this.renderer = this.getRenderer();
		this.virtualPrompt = new VirtualPrompt(this.completionsPrompt());
		this.pipe = this.virtualPrompt.createPipe();
	}

	private setPromptOrdering(ordering: PromptOrdering) {
		if (this.promptOrdering !== ordering) {
			this.promptOrdering = ordering;
			this.reset();
		}
	}

	private completionsPrompt() {
		const promptFunction =
			availableDeclarativePrompts[this.promptOrdering]?.promptFunction ?? defaultCompletionsPrompt;
		return this.instantiationService.invokeFunction(promptFunction);
	}

	private getRenderer() {
		const promptInfo =
			availableDeclarativePrompts[this.promptOrdering] ?? availableDeclarativePrompts[PromptOrdering.Default];
		return new promptInfo.renderer();
	}
}

// Similar files is enabled if:
// - the languageId is C/C++.
// - it's explicitly enabled via EXP flag or config.
// - no code snippets are provided (which includes the case when all providers error).
function similarFilesEnabled(
	accessor: ServicesAccessor,
	detectedLanguageId: string,
	matchedContextItems: ResolvedContextItem<SupportedContextItemWithId>[],
	telemetryData: TelemetryWithExp
) {
	const cppLanguageIds = ['cpp', 'c'];
	const includeNeighboringFiles =
		isIncludeNeighborFilesActive(accessor, detectedLanguageId, telemetryData) || cppLanguageIds.includes(detectedLanguageId);
	return (
		includeNeighboringFiles || !matchedContextItems.some(ci => ci.data.some(item => item.type === 'CodeSnippet'))
	);
}
