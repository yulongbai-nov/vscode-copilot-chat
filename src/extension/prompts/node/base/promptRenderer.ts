/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptRenderer as BasePromptRenderer, HTMLTracer, ITokenizer, JSONTree, MetadataMap, OutputMode, QueueItem, Raw, RenderPromptResult } from '@vscode/prompt-tsx';
import type { ChatResponsePart, ChatResponseProgressPart, LanguageModelToolTokenizationOptions, Progress } from 'vscode';
import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { toTextPart } from '../../../../platform/chat/common/globalStringUtils';
import { IEndpointProvider } from '../../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../../platform/log/common/logService';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { IRequestLogger } from '../../../../platform/requestLogger/node/requestLogger';
import { ITokenizerProvider } from '../../../../platform/tokenizer/node/tokenizer';
import { createServiceIdentifier } from '../../../../util/common/services';
import { isLocation } from '../../../../util/common/types';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from '../../../../util/vs/platform/instantiation/common/serviceCollection';
import { ChatResponseReferencePart, Location, Uri } from '../../../../vscodeTypes';
import { RendererVisualizations } from '../../../inlineChat/node/rendererVisualization';
import { getUniqueReferences, PromptReference } from '../../../prompt/common/conversation';
import { IBuildPromptContext } from '../../../prompt/common/intents';
import { IIntent } from '../../../prompt/node/intents';
import { PromptElementCtor } from './promptElement';
import { PromptTokenUsageMetadata, IPromptSectionTokenUsage } from '../../common/tokenUsageMetadata';

/**
 * Allows us to use dependency injection to pass the fully fledged IChatEndpoint to the prompt element being rendered.
 */
export type IPromptEndpoint = IChatEndpoint & {
	_serviceBrand: undefined;
};
export const IPromptEndpoint = createServiceIdentifier<IPromptEndpoint>('IPromptEndpoint');

/**
 * Convenience intent invocation that uses a renderer for prompt crafting.
 */
export abstract class RendererIntentInvocation {

	constructor(
		readonly intent: IIntent,
		readonly location: ChatLocation,
		readonly endpoint: IChatEndpoint,
	) { }

	async buildPrompt(promptParams: IBuildPromptContext, progress: Progress<ChatResponseReferencePart | ChatResponseProgressPart>, token: CancellationToken): Promise<RenderPromptResult<OutputMode.Raw> & { references: PromptReference[] }> {
		const renderer = await this.createRenderer(promptParams, this.endpoint, progress, token);
		return await renderer.render(progress, token);
	}

	abstract createRenderer(promptParams: IBuildPromptContext, endpoint: IChatEndpoint, progress: Progress<ChatResponseReferencePart | ChatResponseProgressPart>, token: CancellationToken): BasePromptRenderer<any, OutputMode.Raw> | Promise<BasePromptRenderer<any, OutputMode.Raw>>;
}

export class PromptRenderer<P extends BasePromptElementProps> extends BasePromptRenderer<P, OutputMode.Raw> {
	private ctorName?: string; // when and iff tracing is enabled

	public static create<P extends BasePromptElementProps>(
		instantiationService: IInstantiationService,
		endpoint: IChatEndpoint,
		ctor: PromptElementCtor<P, any>,
		props: P,
	) {
		// TODO@Alex, TODO@Joh: instantiationService.createInstance doesn't work here
		const hydratedInstaService = instantiationService.createChild(new ServiceCollection([IPromptEndpoint, endpoint]));
		return hydratedInstaService.invokeFunction((accessor) => {
			const tokenizerProvider = accessor.get(ITokenizerProvider);
			let renderer = new PromptRenderer(hydratedInstaService, endpoint, ctor, props, tokenizerProvider, accessor.get(IRequestLogger), accessor.get(IAuthenticationService), accessor.get(ILogService));

			const visualizations = RendererVisualizations.getIfVisualizationTestIsRunning();
			if (visualizations) {
				renderer = visualizations.decorateAndRegister(renderer, ctor.name);
			}

			return renderer;
		});
	}

	constructor(
		private readonly _instantiationService: IInstantiationService,
		protected readonly endpoint: IChatEndpoint,
		ctor: PromptElementCtor<P, any>,
		props: P,
		@ITokenizerProvider tokenizerProvider: ITokenizerProvider,
		@IRequestLogger private readonly _requestLogger: IRequestLogger,
		@IAuthenticationService authenticationService: IAuthenticationService,
		@ILogService private readonly _logService: ILogService,
	) {
		const tokenizer = tokenizerProvider.acquireTokenizer(endpoint);
		super(endpoint, ctor, props, tokenizer);

		const token = authenticationService.copilotToken;
		const isTeamMember = !!(token?.isInternal && token.isVscodeTeamMember);
		if (isTeamMember) {
			this.ctorName = ctor.name || '<anonymous>';
			this.tracer = new HTMLTracer();
		}
	}

	override createElement(element: QueueItem<PromptElementCtor<P, any>, P>, ...args: any[]) {
		return this._instantiationService.createInstance(element.ctor, element.props, ...args);
	}

	override async render(progress?: Progress<ChatResponsePart> | undefined, token?: CancellationToken | undefined, opts?: Partial<{ trace: boolean }>): Promise<RenderPromptResult> {
		const result = await super.render(progress, token);
		const defaultOptions = { trace: true };
		opts = { ...defaultOptions, ...opts };
		if (this.tracer && !!opts.trace) {
			this._requestLogger.addPromptTrace(this.ctorName!, this.endpoint, result, this.tracer as HTMLTracer);
		}

		// Collect token usage per section before message collapse
		const tokenUsageMetadata = await this.collectTokenUsageMetadata(result);
		if (tokenUsageMetadata) {
			// Store metadata in the result - use the constructor as key
			const existingMetadata = result.metadata.getAll(PromptTokenUsageMetadata);
			existingMetadata.push(tokenUsageMetadata);
		}

		// Collapse consecutive system messages because CAPI currently expects a single
		// system message per prompt. Note: this may slightly reduce the actual
		// token usage under the `RenderPromptResult.tokenCount`.
		for (let i = 1; i < result.messages.length; i++) {
			const current = result.messages[i];
			const prev = result.messages[i - 1];
			if (current.role === Raw.ChatRole.System && prev.role === Raw.ChatRole.System) {
				const lastContent = prev.content.at(-1);
				const nextContent = current.content.at(0);
				if (lastContent && nextContent && lastContent.type === Raw.ChatCompletionContentPartKind.Text && nextContent.type === Raw.ChatCompletionContentPartKind.Text) {
					lastContent.text = lastContent.text.trimEnd() + '\n' + nextContent.text;
					prev.content = prev.content.concat(current.content.slice(1));
				} else {
					prev.content.push(toTextPart('\n'));
					prev.content = prev.content.concat(current.content);
				}
				result.messages.splice(i, 1);
				i--;
			}
		}

		const references = result.references.filter(ref => this.validateReference(ref));
		this._instantiationService.dispose(); // Dispose the hydrated instantiation service
		return { ...result, references: getUniqueReferences(references) };
	}

	/**
	 * Collects detailed token usage information for each section of the prompt
	 */
	private async collectTokenUsageMetadata(result: RenderPromptResult): Promise<PromptTokenUsageMetadata | undefined> {
		try {
			const sections: IPromptSectionTokenUsage[] = [];
			
			// Track token usage by message role and content type
			for (let i = 0; i < result.messages.length; i++) {
				const message = result.messages[i];
				const messagePrefix = this.getMessageRoleDescription(message.role, i);
				
				// Count tokens for each content part in the message
				for (let j = 0; j < message.content.length; j++) {
					const content = message.content[j];
					if (content.type === Raw.ChatCompletionContentPartKind.Text && content.text.trim()) {
						const sectionName = message.content.length > 1 
							? `${messagePrefix} (Part ${j + 1})`
							: messagePrefix;
						
						// Use the tokenizer to count tokens for this content part
						const tokenCount = await this.countTokensForContent(content.text);
						
						sections.push({
							section: sectionName,
							tokenCount,
							content: this.getSafeContentPreview(content.text),
							wasTruncated: false, // We don't have truncation info at this level
							priority: this.getPriorityForRole(message.role)
						});
					}
				}
			}

			// If we don't have detailed sections, create a summary
			if (sections.length === 0) {
				sections.push({
					section: 'Total Prompt',
					tokenCount: result.tokenCount,
					content: 'Complete prompt content',
					wasTruncated: false
				});
			}

			const tokenUsageInfo = {
				totalTokens: result.tokenCount,
				maxTokens: this.endpoint.modelMaxPromptTokens,
				usagePercentage: (result.tokenCount / this.endpoint.modelMaxPromptTokens) * 100,
				sections,
				model: this.endpoint.family || 'unknown',
				timestamp: Date.now(),
				isNearLimit: (result.tokenCount / this.endpoint.modelMaxPromptTokens) > 0.8
			};

			return new PromptTokenUsageMetadata(tokenUsageInfo);
		} catch (error) {
			this._logService.warn(`Failed to collect token usage metadata: ${error}`);
			return undefined;
		}
	}

	/**
	 * Count tokens for a specific text content using the appropriate tokenizer
	 */
	private async countTokensForContent(text: string): Promise<number> {
		try {
			// Use the same tokenizer acquisition pattern as the constructor
			const tokenizerProvider = this._instantiationService.invokeFunction((accessor) => {
				return accessor.get(ITokenizerProvider);
			});
			const tokenizer = tokenizerProvider.acquireTokenizer(this.endpoint);
			return await tokenizer.tokenLength({ type: Raw.ChatCompletionContentPartKind.Text, text });
		} catch (error) {
			this._logService.warn(`Failed to count tokens for content: ${error}`);
			// Fall back to rough estimation
			return Math.ceil(text.length / 4);
		}
	}

	/**
	 * Get a descriptive name for the message role
	 */
	private getMessageRoleDescription(role: Raw.ChatRole, index: number): string {
		switch (role) {
			case Raw.ChatRole.System:
				return index === 0 ? 'System Instructions' : `System Message ${index + 1}`;
			case Raw.ChatRole.User:
				return 'User Query';
			case Raw.ChatRole.Assistant:
				return 'Assistant Response';
			case Raw.ChatRole.Tool:
				return 'Tool Result';
			default:
				return `${role} Message`;
		}
	}

	/**
	 * Get priority level for different message roles
	 */
	private getPriorityForRole(role: Raw.ChatRole): number {
		switch (role) {
			case Raw.ChatRole.User:
				return 1; // Highest priority - user's actual query
			case Raw.ChatRole.System:
				return 2; // High priority - system instructions
			case Raw.ChatRole.Tool:
				return 3; // Medium priority - tool context
			case Raw.ChatRole.Assistant:
				return 4; // Lower priority - conversation history
			default:
				return 5; // Lowest priority - unknown
		}
	}

	/**
	 * Create a safe preview of content for display
	 */
	private getSafeContentPreview(text: string): string {
		// Limit preview length and clean up whitespace
		const maxLength = 200;
		const cleaned = text.replace(/\s+/g, ' ').trim();
		return cleaned.length > maxLength ? cleaned.substring(0, maxLength) + '...' : cleaned;
	}

	private validateReference(reference: PromptReference) {
		const validateLocation = (value: Uri | Location) => {
			const uri = isLocation(value) ? value.uri : value;
			if (!URI.isUri(uri)) {
				this._logService.warn(`Invalid PromptReference, uri not an instance of URI: ${uri}. Try to find the code that is creating this reference and fix it.`);
				return false;
			}
			return true;
		};
		const refAnchor = reference.anchor;
		if ('variableName' in refAnchor) {
			return refAnchor.value === undefined || validateLocation(refAnchor.value);
		}
		return validateLocation(refAnchor);
	}

	async countTokens(token?: CancellationToken): Promise<number> {
		const result = await super.render(undefined, token);
		return result.tokenCount;
	}
}

export async function renderPromptElement<P extends BasePromptElementProps>(
	instantiationService: IInstantiationService,
	endpoint: IChatEndpoint,
	ctor: PromptElementCtor<P, any>,
	props: P,
	progress?: Progress<ChatResponseProgressPart>,
	token?: CancellationToken,
): Promise<{ messages: Raw.ChatMessage[]; tokenCount: number; metadatas: MetadataMap; references: PromptReference[] }> {
	const renderer = PromptRenderer.create(instantiationService, endpoint, ctor, props);
	const { messages, tokenCount, references, metadata } = await renderer.render(progress, token);
	return { messages, tokenCount, metadatas: metadata, references: getUniqueReferences(references) };
}

// The below all exists to wrap `renderElementJSON` to call our instantiation service

class PromptRendererForJSON<P extends BasePromptElementProps> extends BasePromptRenderer<P, OutputMode.Raw> {
	constructor(
		ctor: PromptElementCtor<P, any>,
		props: P,
		tokenOptions: LanguageModelToolTokenizationOptions | undefined,
		chatEndpoint: IChatEndpoint,
		private readonly instantiationService: IInstantiationService,
	) {
		// Copied from prompt-tsx to map the vscode tool tokenOptions to ITokenizer
		const tokenizer: ITokenizer<OutputMode.Raw> = {
			mode: OutputMode.Raw,
			countMessageTokens(message) {
				throw new Error('Tools may only return text, not messages.');
			},
			tokenLength(text, token) {
				if (text.type === Raw.ChatCompletionContentPartKind.Text) {
					return Promise.resolve(tokenOptions?.countTokens(text.text, token) ?? Promise.resolve(1));
				} else {
					return Promise.resolve(1);
				}
			},
		};

		super({ modelMaxPromptTokens: tokenOptions?.tokenBudget ?? chatEndpoint.modelMaxPromptTokens }, ctor, props, tokenizer);
	}

	override createElement(element: QueueItem<PromptElementCtor<P, any>, P>, ...args: any[]) {
		return this.instantiationService.createInstance(element.ctor, element.props, ...args);
	}
}

export async function renderPromptElementJSON<P extends BasePromptElementProps>(
	instantiationService: IInstantiationService,
	ctor: PromptElementCtor<P, any>,
	props: P,
	tokenOptions?: LanguageModelToolTokenizationOptions,
	token?: CancellationToken
): Promise<JSONTree.PromptElementJSON> {
	// todo@connor4312: we don't know what model the tool call will use, just assume GPT family
	// todo@lramos15: We should pass in endpoint provider rather than doing invoke function, but this was easier
	const endpoint = await instantiationService.invokeFunction((accessor) => {
		return accessor.get(IEndpointProvider).getChatEndpoint('gpt-4.1');
	});
	const hydratedInstaService = instantiationService.createChild(new ServiceCollection([IPromptEndpoint, endpoint]));
	const renderer = new PromptRendererForJSON(ctor as any, props, tokenOptions, endpoint, hydratedInstaService);
	return await renderer.renderElementJSON(token);
}
