/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Raw } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { CopilotToken } from '../../../platform/authentication/common/copilotToken';
import { IBlockedExtensionService } from '../../../platform/chat/common/blockedExtensionService';
import { ChatFetchResponseType, ChatLocation, getErrorDetailsFromChatFetchError } from '../../../platform/chat/common/commonTypes';
import { getTextPart } from '../../../platform/chat/common/globalStringUtils';
import { EmbeddingType, getWellKnownEmbeddingTypeInfo, IEmbeddingsComputer } from '../../../platform/embeddings/common/embeddingsComputer';
import { AutoChatEndpoint } from '../../../platform/endpoint/common/autoChatEndpoint';
import { IAutomodeService } from '../../../platform/endpoint/common/automodeService';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { CustomDataPartMimeTypes } from '../../../platform/endpoint/common/endpointTypes';
import { encodeStatefulMarker } from '../../../platform/endpoint/common/statefulMarkerContainer';
import { IEnvService, isScenarioAutomation } from '../../../platform/env/common/envService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { FinishedCallback, OpenAiFunctionTool, OptionalChatRequestParams } from '../../../platform/networking/common/fetch';
import { IChatEndpoint, IEndpoint } from '../../../platform/networking/common/networking';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { isEncryptedThinkingDelta } from '../../../platform/thinking/common/thinking';
import { BaseTokensPerCompletion } from '../../../platform/tokenizer/node/tokenizer';
import { TelemetryCorrelationId } from '../../../util/common/telemetryCorrelationId';
import { Emitter } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { isDefined, isNumber, isString, isStringArray } from '../../../util/vs/base/common/types';
import { localize } from '../../../util/vs/nls';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ExtensionMode } from '../../../vscodeTypes';
import type { LMResponsePart } from '../../byok/common/byokProvider';
import { IExtensionContribution } from '../../common/contributions';
import { PromptRenderer } from '../../prompts/node/base/promptRenderer';
import { isImageDataPart } from '../common/languageModelChatMessageHelpers';
import { LanguageModelAccessPrompt } from './languageModelAccessPrompt';

export class LanguageModelAccess extends Disposable implements IExtensionContribution {

	readonly id = 'languageModelAccess';

	private readonly _onDidChange = this._register(new Emitter<void>());
	private _currentModels: vscode.LanguageModelChatInformation[] = []; // Store current models for reference
	private _chatEndpoints: IChatEndpoint[] = [];
	private _lmWrapper: CopilotLanguageModelWrapper;
	private _promptBaseCountCache: LanguageModelAccessPromptBaseCountCache;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IEndpointProvider private readonly _endpointProvider: IEndpointProvider,
		@IEmbeddingsComputer private readonly _embeddingsComputer: IEmbeddingsComputer,
		@IVSCodeExtensionContext private readonly _vsCodeExtensionContext: IVSCodeExtensionContext,
		@IAutomodeService private readonly _automodeService: IAutomodeService,
		@IExperimentationService private readonly _expService: IExperimentationService,
	) {
		super();

		this._lmWrapper = this._instantiationService.createInstance(CopilotLanguageModelWrapper);
		this._promptBaseCountCache = this._instantiationService.createInstance(LanguageModelAccessPromptBaseCountCache);

		if (this._vsCodeExtensionContext.extensionMode === ExtensionMode.Test && !isScenarioAutomation) {
			this._logService.warn('[LanguageModelAccess] LanguageModels and Embeddings are NOT AVAILABLE in test mode.');
			return;
		}

		// initial
		this._registerChatProvider();
		this._registerEmbeddings();
	}

	override dispose(): void {
		super.dispose();
	}

	get currentModels(): vscode.LanguageModelChatInformation[] {
		return this._currentModels;
	}

	private _registerChatProvider(): void {
		const provider: vscode.LanguageModelChatProvider = {
			onDidChangeLanguageModelChatInformation: this._onDidChange.event,
			provideLanguageModelChatInformation: this._provideLanguageModelChatInfo.bind(this),
			provideLanguageModelChatResponse: this._provideLanguageModelChatResponse.bind(this),
			provideTokenCount: this._provideTokenCount.bind(this)
		};
		this._register(vscode.lm.registerLanguageModelChatProvider('copilot', provider));
		this._register(this._authenticationService.onDidAuthenticationChange(() => {
			// Auth changed which means models could've changed. Fire the event
			this._onDidChange.fire();
		}));
	}

	private async _provideLanguageModelChatInfo(options: { silent: boolean }, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		const session = await this._getToken();
		if (!session) {
			this._currentModels = [];
			return [];
		}

		const models: vscode.LanguageModelChatInformation[] = [];
		const chatEndpoints = await this._endpointProvider.getAllChatEndpoints();
		const autoEndpoint = await this._automodeService.resolveAutoModeEndpoint(undefined, chatEndpoints);
		chatEndpoints.push(autoEndpoint);
		let defaultChatEndpoint: IChatEndpoint | undefined;
		const defaultExpModel = this._expService.getTreatmentVariable<string>('chat.defaultLanguageModel')?.replace('copilot/', '');
		if (this._authenticationService.copilotToken?.isNoAuthUser) {
			// No Auth users always get Auto as the default model
			defaultChatEndpoint = autoEndpoint;
		} else if (defaultExpModel) {
			// Find exp default
			defaultChatEndpoint = chatEndpoints.find(e => e.model === defaultExpModel);
		}
		if (!defaultChatEndpoint) {
			// Find a default set by CAPI
			defaultChatEndpoint = chatEndpoints.find(e => e.isDefault) ?? await this._endpointProvider.getChatEndpoint('gpt-4.1') ?? chatEndpoints[0];
		}
		const seenFamilies = new Set<string>();

		for (const endpoint of chatEndpoints) {
			if (seenFamilies.has(endpoint.family) && !endpoint.showInModelPicker) {
				continue;
			}
			seenFamilies.add(endpoint.family);

			const sanitizedModelName = endpoint.name.replace(/\(Preview\)/g, '').trim();
			let modelDescription: string | undefined;
			if (endpoint.degradationReason) {
				modelDescription = endpoint.degradationReason;
			} else if (endpoint instanceof AutoChatEndpoint) {
				if (this._authenticationService.copilotToken?.isNoAuthUser || (endpoint.discountRange.low === 0 && endpoint.discountRange.high === 0)) {
					modelDescription = localize('languageModel.autoTooltipNoAuth', 'Auto selects the best model for your request based on capacity and performance.');
				} else if (endpoint.discountRange.low === endpoint.discountRange.high) {
					modelDescription = localize('languageModel.autoTooltipSameDiscount', 'Auto selects the best model for your request based on capacity and performance. Auto is given a {0}% discount.', endpoint.discountRange.low * 100);
				} else {
					modelDescription = localize('languageModel.autoTooltipDiffDiscount', 'Auto selects the best model for your request based on capacity and performance. Auto is given a {0}% to {1}% discount.', endpoint.discountRange.low * 100, endpoint.discountRange.high * 100);
				}
			} else if (endpoint.multiplier) {
				modelDescription = localize('languageModel.costTooltip', '{0} ({1}) is counted at a {2}x rate.', sanitizedModelName, endpoint.version, endpoint.multiplier);
			} else if (endpoint.isFallback && endpoint.multiplier === 0) {
				modelDescription = localize('languageModel.baseTooltip', '{0} ({1}) does not count towards your premium request limit. This model may be slowed during times of high congestion.', sanitizedModelName, endpoint.version);
			} else {
				modelDescription = `${sanitizedModelName} (${endpoint.version})`;
			}

			let modelCategory: { label: string; order: number } | undefined;
			if (endpoint instanceof AutoChatEndpoint) {
				modelCategory = { label: '', order: Number.MIN_SAFE_INTEGER };
			} else if (endpoint.isPremium === undefined || this._authenticationService.copilotToken?.isFreeUser) {
				modelCategory = { label: localize('languageModelHeader.copilot', "Copilot Models"), order: 0 };
			} else if (endpoint.isPremium) {
				modelCategory = { label: localize('languageModelHeader.premium', "Premium Models"), order: 1 };
			} else {
				modelCategory = { label: localize('languageModelHeader.standard', "Standard Models"), order: 0 };
			}

			// Counting tokens requires instantiating the tokenizers, which makes this process use a lot of memory.
			// Let's cache the results across extension activations
			const baseCount = await this._promptBaseCountCache.getBaseCount(endpoint);
			let modelDetail = endpoint.multiplier !== undefined ? `${endpoint.multiplier}x` : undefined;

			if (endpoint instanceof AutoChatEndpoint) {
				if (endpoint.discountRange.high === endpoint.discountRange.low && endpoint.discountRange.low !== 0) {
					modelDetail = `${endpoint.discountRange.low * 100}% discount`;
				} else if (endpoint.discountRange.high !== endpoint.discountRange.low) {
					modelDetail = `${endpoint.discountRange.low * 100}% to ${endpoint.discountRange.high * 100}% discount`;
				}
			}
			if (endpoint.customModel) {
				const customModel = endpoint.customModel;
				modelDetail = customModel.owner_name;
				modelDescription = `${endpoint.name} is contributed by ${customModel.owner_name} using ${customModel.key_name}`;
				modelCategory = { label: localize('languageModelHeader.custom_models', "Custom Models"), order: 2 };
			}

			const session = this._authenticationService.anyGitHubSession;

			const model: vscode.LanguageModelChatInformation = {
				id: endpoint instanceof AutoChatEndpoint ? AutoChatEndpoint.pseudoModelId : endpoint.model,
				name: endpoint instanceof AutoChatEndpoint ? 'Auto' : endpoint.name,
				family: endpoint.family,
				tooltip: modelDescription,
				detail: modelDetail,
				category: modelCategory,
				statusIcon: endpoint.degradationReason ? new vscode.ThemeIcon('warning') : undefined,
				version: endpoint.version,
				maxInputTokens: endpoint.modelMaxPromptTokens - baseCount - BaseTokensPerCompletion,
				maxOutputTokens: endpoint.maxOutputTokens,
				requiresAuthorization: session && { label: session.account.label },
				isDefault: endpoint === defaultChatEndpoint,
				isUserSelectable: endpoint.showInModelPicker,
				capabilities: {
					imageInput: endpoint.supportsVision,
					toolCalling: endpoint.supportsToolCalls,
				}
			};

			models.push(model);
		}

		this._currentModels = models;
		this._chatEndpoints = chatEndpoints;
		return models;
	}

	private async _provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: Array<vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2>,
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	): Promise<any> {
		const endpoint = this._chatEndpoints.find(e => e.model === model.id);
		if (!endpoint) {
			throw new Error(`Endpoint not found for model ${model.id}`);
		}

		return this._lmWrapper.provideLanguageModelResponse(endpoint, messages, {
			...options,
			modelOptions: options.modelOptions
		}, options.requestInitiator, progress, token);
	}

	private async _provideTokenCount(
		model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2,
		token: vscode.CancellationToken
	): Promise<number> {
		const endpoint = this._chatEndpoints.find(e => e.model === model.id);
		if (!endpoint) {
			throw new Error(`Endpoint not found for model ${model.id}`);
		}

		return this._lmWrapper.provideTokenCount(endpoint, text);
	}

	private async _registerEmbeddings(): Promise<void> {

		const embeddingsComputer = this._embeddingsComputer;
		const embeddingType = EmbeddingType.text3small_512;
		const model = getWellKnownEmbeddingTypeInfo(embeddingType)?.model;
		if (!model) {
			throw new Error(`No model found for embedding type ${embeddingType.id}`);
		}

		const that = this;
		this._register(vscode.lm.registerEmbeddingsProvider(`copilot.${model}`, new class implements vscode.EmbeddingsProvider {
			async provideEmbeddings(input: string[], token: vscode.CancellationToken): Promise<vscode.Embedding[]> {
				await that._getToken();

				const result = await embeddingsComputer.computeEmbeddings(embeddingType, input, {}, new TelemetryCorrelationId('EmbeddingsProvider::provideEmbeddings'), token);
				return result.values.map(embedding => ({ values: embedding.value.slice(0) }));
			}
		}));
	}

	private async _getToken(): Promise<CopilotToken | undefined> {
		try {
			const copilotToken = await this._authenticationService.getCopilotToken();
			return copilotToken;
		} catch (e) {
			this._logService.warn('[LanguageModelAccess] LanguageModel/Embeddings are not available without auth token');
			this._logService.error(e);
			return undefined;
		}
	}
}

class LanguageModelAccessPromptBaseCountCache {
	constructor(
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IEnvService private readonly _envService: IEnvService
	) { }

	public async getBaseCount(endpoint: IChatEndpoint): Promise<number> {
		const key = `lmBaseCount/${endpoint.model}`;
		const cached = this._extensionContext.globalState.get<{ extensionVersion: string; baseCount: number }>(key);
		if (cached && cached.extensionVersion === this._envService.getVersion() && typeof cached.baseCount === 'number') {
			return cached.baseCount;
		}

		const baseCount = await this._computeBaseCount(endpoint);
		// Store the computed value along with the extension version so we can
		// invalidate the cache when the extension is updated.
		try {
			await this._extensionContext.globalState.update(key, { extensionVersion: this._envService.getVersion(), baseCount });
		} catch (err) {
			// Best-effort cache update — don't fail the caller if persisting the
			// cache entry fails for any reason.
		}

		return baseCount;
	}

	private async _computeBaseCount(endpoint: IChatEndpoint): Promise<number> {
		const baseCount = await PromptRenderer.create(this._instantiationService, endpoint, LanguageModelAccessPrompt, { noSafety: false, messages: [] }).countTokens();
		return baseCount;
	}

}

/**
 * Exported for test
 */
export class CopilotLanguageModelWrapper extends Disposable {

	constructor(
		@IExperimentationService readonly _expService: IExperimentationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IBlockedExtensionService private readonly _blockedExtensionService: IBlockedExtensionService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IEnvService private readonly _envService: IEnvService
	) {
		super();
	}

	private async _provideLanguageModelResponse(_endpoint: IChatEndpoint, _messages: Array<vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2>, _options: vscode.ProvideLanguageModelChatResponseOptions, extensionId: string, callback: FinishedCallback, token: vscode.CancellationToken): Promise<any> {

		const extensionInfo = extensionId === 'core' ? { packageJSON: { version: this._envService.vscodeVersion } } : vscode.extensions.getExtension(extensionId, true);
		if (!extensionInfo || typeof extensionInfo.packageJSON.version !== 'string') {
			throw new Error('Invalid extension information');
		}
		const extensionVersion = <string>extensionInfo.packageJSON.version;

		const blockedExtensionMessage = vscode.l10n.t('The extension has been temporarily blocked due to making too many requests. Please try again later.');
		if (this._blockedExtensionService.isExtensionBlocked(extensionId)) {
			throw vscode.LanguageModelError.Blocked(blockedExtensionMessage);
		}

		const toolTokenCount = _options.tools ? await this.countToolTokens(_endpoint, _options.tools) : 0;
		const baseCount = await PromptRenderer.create(this._instantiationService, _endpoint, LanguageModelAccessPrompt, { noSafety: false, messages: [] }).countTokens();
		const tokenLimit = _endpoint.modelMaxPromptTokens - baseCount - BaseTokensPerCompletion - toolTokenCount;

		this.validateRequest(_messages);
		if (_options.tools) {
			this.validateTools(_options.tools);
		}
		// Add safety rules to the prompt if it originates from outside the Copilot Chat extension, otherwise they already exist in the prompt.
		const { messages, tokenCount } = await PromptRenderer.create(this._instantiationService, {
			..._endpoint,
			modelMaxPromptTokens: tokenLimit
		}, LanguageModelAccessPrompt, { noSafety: extensionId === this._envService.extensionId, messages: _messages }).render();

		/* __GDPR__
			"languagemodelrequest" : {
				"owner": "jrieken",
				"comment": "Data about extensions using the language model",
				"model": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The model that is being used" },
				"extensionId": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The extension identifier for which we make the request" },
				"extensionVersion": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The extension version for which we make the request" },
				"tokenCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "The number of tokens" },
				"tokenLimit": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "The number of tokens that can be used" }
			}
		*/
		this._telemetryService.sendMSFTTelemetryEvent(
			'languagemodelrequest',
			{
				extensionId,
				extensionVersion,
				model: _endpoint.model
			},
			{
				tokenCount,
				tokenLimit
			}
		);

		// If no messages they got rendered out due to token limit
		if (messages.length === 0 || tokenCount > tokenLimit) {
			throw new Error('Message exceeds token limit.');
		}

		if (_options.tools && _options.tools.length > 128) {
			throw new Error('Cannot have more than 128 tools per request.');
		}

		const endpoint: IChatEndpoint = new Proxy(_endpoint, {
			get: function (target, prop, receiver) {
				if (prop === 'getExtraHeaders') {
					return function () {
						const extraHeaders = target.getExtraHeaders?.() ?? {};
						if (extensionId === 'core') {
							return extraHeaders;
						}
						return {
							...extraHeaders,
							'x-onbehalf-extension-id': `${extensionId}/${extensionVersion}`,
						};
					};
				}
				if (prop === 'acquireTokenizer') {
					return target.acquireTokenizer.bind(target);
				}
				return Reflect.get(target, prop, receiver);
			}
		});


		const options: OptionalChatRequestParams = LanguageModelOptions.Default.convert(_options.modelOptions ?? {});
		const telemetryProperties = { messageSource: `api.${extensionId}` };

		options.tools = _options.tools?.map((tool): OpenAiFunctionTool => {
			return {
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.inputSchema && Object.keys(tool.inputSchema).length ? tool.inputSchema : undefined
				}
			};
		});
		if (_options.toolMode === vscode.LanguageModelChatToolMode.Required && _options.tools?.length && _options.tools.length > 1) {
			throw new Error('LanguageModelChatToolMode.Required is not supported with more than one tool');
		}

		options.tool_choice = _options.toolMode === vscode.LanguageModelChatToolMode.Required && _options.tools?.length ?
			{ type: 'function', function: { name: _options.tools[0].name } } :
			undefined;

		const result = await endpoint.makeChatRequest('copilotLanguageModelWrapper', messages, callback, token, ChatLocation.Other, { extensionId }, options, extensionId !== 'core', telemetryProperties);

		if (result.type !== ChatFetchResponseType.Success) {
			if (result.type === ChatFetchResponseType.ExtensionBlocked) {
				this._blockedExtensionService.reportBlockedExtension(extensionId, result.retryAfter);
				throw vscode.LanguageModelError.Blocked(blockedExtensionMessage);
			} else if (result.type === ChatFetchResponseType.QuotaExceeded) {
				const details = getErrorDetailsFromChatFetchError(result, (await this._authenticationService.getCopilotToken()).copilotPlan);
				const err = new vscode.LanguageModelError(details.message);
				err.name = 'ChatQuotaExceeded';
				throw err;
			} else if (result.type === ChatFetchResponseType.RateLimited) {
				const err = new Error(result.reason);
				err.name = 'ChatRateLimited';
				throw err;
			}

			throw new Error(result.reason);
		}

		this._telemetryService.sendInternalMSFTTelemetryEvent(
			'languagemodelrequest',
			{
				extensionId,
				extensionVersion,
				requestid: result.requestId,
				query: getTextPart(messages[messages.length - 1].content),
				model: _endpoint.model
			},
			{
				tokenCount,
				tokenLimit
			}
		);
	}

	async provideLanguageModelResponse(endpoint: IChatEndpoint, messages: Array<vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2>, options: vscode.ProvideLanguageModelChatResponseOptions, extensionId: string, progress: vscode.Progress<LMResponsePart>, token: vscode.CancellationToken): Promise<any> {
		let thinkingActive = false;
		const finishCallback: FinishedCallback = async (_text, index, delta): Promise<undefined> => {
			if (delta.thinking) {
				// Show thinking progress for unencrypted thinking deltas
				if (!isEncryptedThinkingDelta(delta.thinking)) {
					const text = delta.thinking.text ?? '';
					progress.report(new vscode.LanguageModelThinkingPart(text, delta.thinking.id, delta.thinking.metadata));
					thinkingActive = true;
				}
			} else if (thinkingActive) {
				progress.report(new vscode.LanguageModelThinkingPart('', '', { vscode_reasoning_done: true }));
				thinkingActive = false;
			}
			if (delta.text) {
				progress.report(new vscode.LanguageModelTextPart(delta.text));
			}
			if (delta.copilotToolCalls) {
				for (const call of delta.copilotToolCalls) {
					try {
						// Anthropic models send "" (empty string) for tools with no parameters.
						const parameters = JSON.parse(call.arguments || '{}');
						progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, parameters));
					} catch (err) {
						this._logService.error(err, `Got invalid JSON for tool call: ${call.arguments}`);
						throw new Error('Invalid JSON for tool call');
					}
				}
			}

			if (delta.statefulMarker) {
				progress.report(
					new vscode.LanguageModelDataPart(encodeStatefulMarker(endpoint.model, delta.statefulMarker), CustomDataPartMimeTypes.StatefulMarker)
				);
			}

			return undefined;
		};
		return this._provideLanguageModelResponse(endpoint, messages, options, extensionId, finishCallback, token);
	}

	async provideTokenCount(endpoint: IEndpoint, message: string | vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
		if (typeof message === 'string') {
			return endpoint.acquireTokenizer().tokenLength(message);
		} else {
			let raw: Raw.ChatMessage;

			const content = message.content.map((part): Raw.ChatCompletionContentPart | undefined => {
				if (part instanceof vscode.LanguageModelTextPart) {
					return { type: Raw.ChatCompletionContentPartKind.Text, text: part.value };
				} else if (isImageDataPart(part)) {
					return { type: Raw.ChatCompletionContentPartKind.Image, imageUrl: { url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64url')}` } };
				} else {
					return undefined;
				}
			}).filter(isDefined);
			switch (message.role) {
				case vscode.LanguageModelChatMessageRole.User:
					raw = { role: Raw.ChatRole.User, content, name: message.name };
					break;
				case vscode.LanguageModelChatMessageRole.System:
					raw = { role: Raw.ChatRole.Assistant, content, name: message.name };
					break;
				case vscode.LanguageModelChatMessageRole.Assistant:
					raw = {
						role: Raw.ChatRole.Assistant,
						content,
						name: message.name,
						toolCalls: message.content
							.filter(part => part instanceof vscode.LanguageModelToolCallPart)
							.map(part => part as vscode.LanguageModelToolCallPart)
							.map(part => ({ function: { name: part.name, arguments: JSON.stringify(part.input) }, id: part.callId, type: 'function' })),
					};
					break;
				default:
					return 0;
			}

			return endpoint.acquireTokenizer().countMessageTokens(raw);
		}
	}

	private validateTools(tools: readonly vscode.LanguageModelChatTool[]): void {
		for (const tool of tools) {
			if (!tool.name.match(/^[\w-]+$/)) {
				throw new Error(`Invalid tool name "${tool.name}": only alphanumeric characters, hyphens, and underscores are allowed.`);
			}
		}
	}

	private async countToolTokens(endpoint: IChatEndpoint, tools: readonly vscode.LanguageModelChatTool[]): Promise<number> {
		return await endpoint.acquireTokenizer().countToolTokens(tools);
	}

	private validateRequest(_messages: Array<vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2>): void {
		const lastMessage = _messages.at(-1);
		if (!lastMessage) {
			throw new Error('Invalid request: no messages.');
		}

		_messages.forEach((message, i) => {
			if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
				// Filter out DataPart since it does not share the same value type and does not have callId, function, etc.
				const filteredContent = message.content.filter(part => part instanceof vscode.LanguageModelDataPart);
				const toolCallIds = new Set(filteredContent
					.filter(part => part instanceof vscode.LanguageModelToolCallPart)
					.map(part => part.callId));
				let nextMessageIdx = i + 1;
				const errMsg = 'Invalid request: Tool call part must be followed by a User message with a LanguageModelToolResultPart with a matching callId.';
				while (toolCallIds.size > 0) {
					const nextMessage = _messages.at(nextMessageIdx++);
					if (!nextMessage || nextMessage.role !== vscode.LanguageModelChatMessageRole.User) {
						throw new Error(errMsg);
					}

					nextMessage.content.forEach(part => {
						if (!(part instanceof vscode.LanguageModelToolResultPart2 || part instanceof vscode.LanguageModelToolResultPart)) {
							throw new Error(errMsg);
						}

						toolCallIds.delete(part.callId);
					});
				}
			}
		});
	}
}


function or(...checks: ((value: any) => boolean)[]): (value: any) => boolean {
	return (value) => checks.some(check => check(value));
}

class LanguageModelOptions {

	private static _defaultDesc: Record<string, (value: any) => boolean> = {
		stop: or(isStringArray, isString),
		temperature: isNumber,
		max_tokens: isNumber,
		frequency_penalty: isNumber,
		presence_penalty: isNumber,
	};

	static Default = new LanguageModelOptions({ ...this._defaultDesc });

	constructor(private _description: Record<string, (value: any) => boolean>) { }

	convert(options: { [name: string]: any }): Record<string, number | boolean | string> {
		const result: Record<string, number | boolean | string> = {};
		for (const key in this._description) {
			const isValid = this._description[key];
			const value = options[key];
			if (value !== null && value !== undefined && isValid(value)) {
				result[key] = value;
			}
		}
		return result;
	}
}
