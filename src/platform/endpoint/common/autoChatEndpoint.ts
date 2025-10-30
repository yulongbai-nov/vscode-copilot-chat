/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RequestMetadata } from '@vscode/copilot-api';
import { Raw } from '@vscode/prompt-tsx';
import type { CancellationToken } from 'vscode';
import { ITokenizer, TokenizerType } from '../../../util/common/tokenizer';
import { AsyncIterableObject } from '../../../util/vs/base/common/async';
import { IChatMLFetcher, Source } from '../../chat/common/chatMLFetcher';
import { ChatLocation, ChatResponse } from '../../chat/common/commonTypes';
import { ILogService } from '../../log/common/logService';
import { FinishedCallback, OptionalChatRequestParams } from '../../networking/common/fetch';
import { Response } from '../../networking/common/fetcherService';
import { IChatEndpoint, ICreateEndpointBodyOptions, IEndpointBody, IMakeChatRequestOptions } from '../../networking/common/networking';
import { ChatCompletion } from '../../networking/common/openai';
import { ITelemetryService, TelemetryProperties } from '../../telemetry/common/telemetry';
import { TelemetryData } from '../../telemetry/common/telemetryData';
import { CustomModel } from './endpointProvider';

/**
 * This endpoint represents the "Auto" model in the model picker.
 * It just effectively wraps a different endpoint and adds the auto stuff on top
 */
export class AutoChatEndpoint implements IChatEndpoint {
	public static readonly pseudoModelId = 'auto';
	maxOutputTokens: number = this._wrappedEndpoint.maxOutputTokens;
	model: string = this._wrappedEndpoint.model;
	supportsToolCalls: boolean = this._wrappedEndpoint.supportsToolCalls;
	supportsVision: boolean = this._wrappedEndpoint.supportsVision;
	degradationReason?: string | undefined = this._wrappedEndpoint.degradationReason;
	customModel?: CustomModel | undefined = this._wrappedEndpoint.customModel;
	supportsPrediction: boolean = this._wrappedEndpoint.supportsPrediction;
	showInModelPicker: boolean = true;
	isPremium?: boolean | undefined = this._wrappedEndpoint.isPremium;
	public readonly multiplier?: number | undefined;
	restrictedToSkus?: string[] | undefined = this._wrappedEndpoint.restrictedToSkus;
	isDefault: boolean = this._wrappedEndpoint.isDefault;
	isFallback: boolean = this._wrappedEndpoint.isFallback;
	policy: 'enabled' | { terms: string } = this._wrappedEndpoint.policy;
	urlOrRequestMetadata: string | RequestMetadata = this._wrappedEndpoint.urlOrRequestMetadata;
	modelMaxPromptTokens: number = this._wrappedEndpoint.modelMaxPromptTokens;
	name: string = this._wrappedEndpoint.name;
	version: string = this._wrappedEndpoint.version;
	family: string = this._wrappedEndpoint.family;
	tokenizer: TokenizerType = this._wrappedEndpoint.tokenizer;

	constructor(
		private readonly _wrappedEndpoint: IChatEndpoint,
		private readonly _chatMLFetcher: IChatMLFetcher,
		private readonly _sessionToken: string,
		private readonly _discountPercent: number,
		public readonly discountRange: { low: number; high: number }
	) {
		// Calculate the multiplier including the discount percent, rounding to two decimal places
		const baseMultiplier = this._wrappedEndpoint.multiplier ?? 1;
		this.multiplier = Math.round(baseMultiplier * (1 - this._discountPercent) * 100) / 100;
	}

	public get apiType(): string | undefined {
		return this._wrappedEndpoint.apiType;
	}

	getExtraHeaders(): Record<string, string> {
		return {
			...(this._wrappedEndpoint.getExtraHeaders?.() || {}),
			'Copilot-Session-Token': this._sessionToken
		};
	}

	createRequestBody(options: ICreateEndpointBodyOptions): IEndpointBody {
		return this._wrappedEndpoint.createRequestBody(options);
	}

	processResponseFromChatEndpoint(telemetryService: ITelemetryService, logService: ILogService, response: Response, expectedNumChoices: number, finishCallback: FinishedCallback, telemetryData: TelemetryData, cancellationToken?: CancellationToken): Promise<AsyncIterableObject<ChatCompletion>> {
		return this._wrappedEndpoint.processResponseFromChatEndpoint(telemetryService, logService, response, expectedNumChoices, finishCallback, telemetryData, cancellationToken);
	}
	acceptChatPolicy(): Promise<boolean> {
		return this._wrappedEndpoint.acceptChatPolicy();
	}
	cloneWithTokenOverride(modelMaxPromptTokens: number): IChatEndpoint {
		return this._wrappedEndpoint.cloneWithTokenOverride(modelMaxPromptTokens);
	}
	acquireTokenizer(): ITokenizer {
		return this._wrappedEndpoint.acquireTokenizer();
	}

	public async makeChatRequest2(options: IMakeChatRequestOptions, token: CancellationToken): Promise<ChatResponse> {
		return this._chatMLFetcher.fetchOne({
			requestOptions: {},
			...options,
			endpoint: this,
			// TODO https://github.com/microsoft/vscode/issues/266410
			ignoreStatefulMarker: options.ignoreStatefulMarker ?? true
		}, token);
	}

	public async makeChatRequest(
		debugName: string,
		messages: Raw.ChatMessage[],
		finishedCb: FinishedCallback | undefined,
		token: CancellationToken,
		location: ChatLocation,
		source?: Source,
		requestOptions?: Omit<OptionalChatRequestParams, 'n'>,
		userInitiatedRequest?: boolean,
		telemetryProperties?: TelemetryProperties,
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
}