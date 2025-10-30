/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import type { CancellationToken } from 'vscode';
import * as vscode from 'vscode';
import { FetchStreamRecorder } from '../../../platform/chat/common/chatMLFetcher';
import { ITokenizer, TokenizerType } from '../../../util/common/tokenizer';
import { AsyncIterableObject } from '../../../util/vs/base/common/async';
import { toErrorMessage } from '../../../util/vs/base/common/errorMessage';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatFetchResponseType, ChatLocation, ChatResponse } from '../../chat/common/commonTypes';
import { ILogService } from '../../log/common/logService';
import { FinishedCallback, OpenAiFunctionTool, OptionalChatRequestParams } from '../../networking/common/fetch';
import { Response } from '../../networking/common/fetcherService';
import { IChatEndpoint, ICreateEndpointBodyOptions, IEndpointBody, IMakeChatRequestOptions } from '../../networking/common/networking';
import { ChatCompletion } from '../../networking/common/openai';
import { IRequestLogger } from '../../requestLogger/node/requestLogger';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { TelemetryData } from '../../telemetry/common/telemetryData';
import { ITokenizerProvider } from '../../tokenizer/node/tokenizer';
import { EndpointEditToolName, IEndpointProvider, isEndpointEditToolName } from '../common/endpointProvider';
import { CustomDataPartMimeTypes } from '../common/endpointTypes';
import { decodeStatefulMarker, encodeStatefulMarker, rawPartAsStatefulMarker } from '../common/statefulMarkerContainer';
import { rawPartAsThinkingData } from '../common/thinkingDataContainer';

export class ExtensionContributedChatEndpoint implements IChatEndpoint {
	private readonly _maxTokens: number;
	public readonly isDefault: boolean = false;
	public readonly isFallback: boolean = false;
	public readonly isPremium: boolean = false;
	public readonly multiplier: number = 0;
	public readonly isExtensionContributed = true;
	public readonly supportedEditTools?: readonly EndpointEditToolName[] | undefined;

	constructor(
		private readonly languageModel: vscode.LanguageModelChat,
		@ITokenizerProvider private readonly _tokenizerProvider: ITokenizerProvider,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IRequestLogger private readonly _requestLogger: IRequestLogger,
		@IEndpointProvider private readonly _endpointProvider: IEndpointProvider
	) {
		// Initialize with the model's max tokens
		this._maxTokens = languageModel.maxInputTokens;
		this.supportedEditTools = languageModel.capabilities.editToolsHint?.filter(isEndpointEditToolName);
	}

	get modelMaxPromptTokens(): number {
		return this._maxTokens;
	}

	get maxOutputTokens(): number {
		// The VS Code API doesn't expose max output tokens, use a reasonable default
		return 8192;
	}

	get urlOrRequestMetadata(): string {
		// Not used for extension contributed endpoints
		return '';
	}

	get model(): string {
		return this.languageModel.id;
	}

	get name(): string {
		return this.languageModel.name;
	}

	get version(): string {
		return this.languageModel.version;
	}

	get family(): string {
		return this.languageModel.family;
	}

	get tokenizer(): TokenizerType {
		// Most language models use the O200K tokenizer, if they don't they should specify in their metadata
		return TokenizerType.O200K;
	}

	get showInModelPicker(): boolean {
		// TODO @lramos15 - Need some API exposed for this, registration seems to have it
		return true;
	}

	get supportsToolCalls(): boolean {
		return this.languageModel.capabilities?.supportsToolCalling ?? false;
	}

	get supportsVision(): boolean {
		return this.languageModel?.capabilities?.supportsImageToText ?? false;
	}

	get supportsPrediction(): boolean {
		return false;
	}

	get policy(): 'enabled' | { terms: string } {
		return 'enabled';
	}

	async processResponseFromChatEndpoint(
		telemetryService: ITelemetryService,
		logService: ILogService,
		response: Response,
		expectedNumChoices: number,
		finishCallback: FinishedCallback,
		telemetryData: TelemetryData,
		cancellationToken?: CancellationToken
	): Promise<AsyncIterableObject<ChatCompletion>> {
		throw new Error('processResponseFromChatEndpoint not supported for extension contributed endpoints');
	}

	async acceptChatPolicy(): Promise<boolean> {
		return true;
	}

	public acquireTokenizer(): ITokenizer {
		// TODO @lramos15, this should be driven by the extension API.
		return this._tokenizerProvider.acquireTokenizer(this);
	}

	async makeChatRequest(
		debugName: string,
		messages: Raw.ChatMessage[],
		finishedCb: FinishedCallback | undefined,
		token: CancellationToken,
		location: ChatLocation,
		source?: { extensionId?: string | undefined },
		requestOptions?: Omit<OptionalChatRequestParams, 'n'>,
		userInitiatedRequest?: boolean,
		telemetryProperties?: Record<string, string>,
	): Promise<ChatResponse> {
		return this.makeChatRequest2({
			debugName,
			messages,
			finishedCb,
			location,
			source,
			requestOptions,
			userInitiatedRequest,
			telemetryProperties,
		}, token);
	}

	async makeChatRequest2({
		debugName,
		messages,
		requestOptions,
		finishedCb,
		location,
		source,
	}: IMakeChatRequestOptions, token: CancellationToken): Promise<ChatResponse> {
		const vscodeMessages = convertToApiChatMessage(messages);
		const ourRequestId = generateUuid();

		const allEndpoints = await this._endpointProvider.getAllChatEndpoints();
		const currentEndpoint = allEndpoints.find(endpoint => endpoint.model === this.model);
		const isExternalModel = !currentEndpoint;

		const vscodeOptions: vscode.LanguageModelChatRequestOptions = {
			tools: ((requestOptions?.tools ?? []) as OpenAiFunctionTool[]).map(tool => ({
				name: tool.function.name,
				description: tool.function.description,
				inputSchema: tool.function.parameters,
			}))
		};

		const streamRecorder = new FetchStreamRecorder(finishedCb);

		const pendingLoggedChatRequest = isExternalModel ? this._requestLogger.logChatRequest(debugName + '-external', this, {
			messages,
			model: this.model,
			ourRequestId,
			location,
			postOptions: requestOptions,
			tools: requestOptions?.tools,
			ignoreStatefulMarker: true
		})
			: undefined;

		try {
			const response = await this.languageModel.sendRequest(vscodeMessages, vscodeOptions, token);
			let text = '';
			let numToolsCalled = 0;
			const requestId = ourRequestId;

			// consume stream
			for await (const chunk of response.stream) {
				if (chunk instanceof vscode.LanguageModelTextPart) {
					text += chunk.value;
					// Call finishedCb with the current chunk of text
					if (streamRecorder.callback) {
						await streamRecorder.callback(text, 0, { text: chunk.value });
					}
				} else if (chunk instanceof vscode.LanguageModelToolCallPart) {
					// Call finishedCb with updated tool calls
					if (streamRecorder.callback) {
						const functionCalls = [chunk].map(tool => ({
							name: tool.name ?? '',
							arguments: JSON.stringify(tool.input) ?? '',
							id: tool.callId
						}));
						numToolsCalled++;
						await streamRecorder.callback(text, 0, { text: '', copilotToolCalls: functionCalls });
					}
				} else if (chunk instanceof vscode.LanguageModelDataPart) {
					if (chunk.mimeType === CustomDataPartMimeTypes.StatefulMarker) {
						const decoded = decodeStatefulMarker(chunk.data);
						await streamRecorder.callback?.(text, 0, { text: '', statefulMarker: decoded.marker });
					}
				} else if (chunk instanceof vscode.LanguageModelThinkingPart) {
					// Call finishedCb with the current chunk of thinking text with a specific thinking field
					if (streamRecorder.callback) {
						await streamRecorder.callback(text, 0, {
							text: '',  // Use empty text to avoid creating markdown part
							thinking: {
								text: chunk.value,
								id: chunk.id || '',
								metadata: chunk.metadata
							}
						});
					}
				}
			}

			if (text || numToolsCalled > 0) {
				const response: ChatResponse = {
					type: ChatFetchResponseType.Success,
					requestId,
					serverRequestId: requestId,
					usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
					value: text,
					resolvedModel: this.languageModel.id
				};
				pendingLoggedChatRequest?.resolve({ ...response, value: [response.value] }, streamRecorder.deltas);
				return response;
			} else {
				const result: ChatResponse = {
					type: ChatFetchResponseType.Unknown,
					reason: 'No response from language model',
					requestId: requestId,
					serverRequestId: undefined
				};
				pendingLoggedChatRequest?.resolve(result);
				return result;
			}
		} catch (e) {
			const result: ChatResponse = {
				type: ChatFetchResponseType.Failed,
				reason: toErrorMessage(e, true),
				requestId: generateUuid(),
				serverRequestId: undefined
			};
			pendingLoggedChatRequest?.resolve(result);
			return result;
		}
	}

	createRequestBody(options: ICreateEndpointBodyOptions): IEndpointBody {
		throw new Error('unreachable'); // this endpoint does not call into fetchers
	}

	cloneWithTokenOverride(modelMaxPromptTokens: number): IChatEndpoint {
		return this._instantiationService.createInstance(ExtensionContributedChatEndpoint, {
			...this.languageModel,
			maxInputTokens: modelMaxPromptTokens
		});
	}
}

export function convertToApiChatMessage(messages: Raw.ChatMessage[]): Array<vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2> {
	const apiMessages: Array<vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2> = [];
	for (const message of messages) {
		const apiContent: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolResultPart2 | vscode.LanguageModelToolCallPart | vscode.LanguageModelDataPart | vscode.LanguageModelThinkingPart> = [];
		// Easier to work with arrays everywhere, rather than string in some cases. So convert to a single text content part
		for (const contentPart of message.content) {
			if (contentPart.type === Raw.ChatCompletionContentPartKind.Text) {
				apiContent.push(new vscode.LanguageModelTextPart(contentPart.text));
			} else if (contentPart.type === Raw.ChatCompletionContentPartKind.Image) {
				// Handle base64 encoded images
				if (contentPart.imageUrl.url.startsWith('data:')) {
					const dataUrlRegex = /^data:([^;]+);base64,(.*)$/;
					const match = contentPart.imageUrl.url.match(dataUrlRegex);

					if (match) {
						const [, mimeType, base64Data] = match;
						apiContent.push(new vscode.LanguageModelDataPart(Buffer.from(base64Data, 'base64'), mimeType as vscode.ChatImageMimeType));
					}
				} else {
					// Not a base64 image
					continue;
				}
			} else if (contentPart.type === Raw.ChatCompletionContentPartKind.CacheBreakpoint) {
				apiContent.push(new vscode.LanguageModelDataPart(new TextEncoder().encode('ephemeral'), CustomDataPartMimeTypes.CacheControl));
			} else if (contentPart.type === Raw.ChatCompletionContentPartKind.Opaque) {
				const statefulMarker = rawPartAsStatefulMarker(contentPart);
				if (statefulMarker) {
					apiContent.push(new vscode.LanguageModelDataPart(encodeStatefulMarker(statefulMarker.modelId, statefulMarker.marker), CustomDataPartMimeTypes.StatefulMarker));
				}
				const thinkingData = rawPartAsThinkingData(contentPart);
				if (thinkingData) {
					apiContent.push(new vscode.LanguageModelThinkingPart(thinkingData.text, thinkingData.id, thinkingData.metadata));
				}
			}
		}

		if (message.role === Raw.ChatRole.System || message.role === Raw.ChatRole.User) {
			apiMessages.push({
				role: message.role === Raw.ChatRole.System ? vscode.LanguageModelChatMessageRole.System : vscode.LanguageModelChatMessageRole.User,
				name: message.name,
				content: apiContent
			});
		} else if (message.role === Raw.ChatRole.Assistant) {
			if (message.toolCalls) {
				for (const toolCall of message.toolCalls) {
					apiContent.push(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, JSON.parse(toolCall.function.arguments)));
				}
			}
			apiMessages.push({
				role: vscode.LanguageModelChatMessageRole.Assistant,
				name: message.name,
				content: apiContent
			});
		} else if (message.role === Raw.ChatRole.Tool) {
			const toolResultPart: vscode.LanguageModelToolResultPart2 = new vscode.LanguageModelToolResultPart2(
				message.toolCallId ?? '',
				apiContent
			);
			apiMessages.push({
				role: vscode.LanguageModelChatMessageRole.User,
				name: '',
				content: [toolResultPart]
			});
		}
	}
	return apiMessages;
}
