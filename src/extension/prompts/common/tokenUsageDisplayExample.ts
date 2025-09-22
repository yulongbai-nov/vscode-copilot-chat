/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RenderPromptResult } from '@vscode/prompt-tsx';
import type { Progress, ChatResponseReferencePart, ChatResponseProgressPart, ChatResponseStream } from 'vscode';
import { ChatResponseProgressPart as VSCodeChatResponseProgressPart } from '../../../vscodeTypes';
import { ChatResponseTokenUsagePart } from '../../conversation/common/chatResponseTokenUsagePart';
import { IPromptSectionTokenUsage, PromptTokenUsageMetadata } from './tokenUsageMetadata';

/**
 * Example utility to demonstrate how to extract and display token usage information
 * from prompt build results in chat responses.
 * 
 * This can be used in intent invocations or response processors to show users
 * how their prompts are consuming tokens.
 */
export class TokenUsageDisplayExample {

	/**
	 * Extracts token usage from a build prompt result and optionally displays it in the chat
	 * 
	 * @param buildPromptResult The result from building a prompt that may contain token usage metadata
	 * @param outputStream Optional chat response stream to display the token usage to the user
	 * @param mode Display mode - 'summary' shows compact info, 'detailed' shows full breakdown
	 * @returns The token usage metadata if found, undefined otherwise
	 */
	static extractAndDisplayTokenUsage(
		buildPromptResult: RenderPromptResult,
		outputStream?: ChatResponseStream,
		mode: 'summary' | 'detailed' = 'summary'
	): PromptTokenUsageMetadata | undefined {
		
		// Extract token usage metadata from the prompt result
		const tokenUsageMetadataList = buildPromptResult.metadata.getAll(PromptTokenUsageMetadata);
		const tokenUsageMetadata = tokenUsageMetadataList[0]; // Use the first (should only be one)
		
		if (!tokenUsageMetadata) {
			return undefined;
		}

		// If we have a stream, display the token usage in the chat UI
		if (outputStream) {
			const tokenUsagePart = new ChatResponseTokenUsagePart(tokenUsageMetadata.tokenUsageInfo, mode);
			
			// Display as markdown in the chat
			outputStream.markdown(tokenUsagePart.toMarkdown());
			
			// Alternatively, you could push it as a custom part if VS Code supported it:
			// outputStream.push(tokenUsagePart);
		}

		return tokenUsageMetadata;
	}

	/**
	 * Shows a progress message with compact token usage information
	 */
	static showTokenUsageProgress(
		tokenUsageMetadata: PromptTokenUsageMetadata,
		progress?: Progress<ChatResponseReferencePart | ChatResponseProgressPart>
	): void {
		if (!progress) {
			return;
		}

		const tokenUsagePart = new ChatResponseTokenUsagePart(tokenUsageMetadata.tokenUsageInfo, 'summary');
		const compactSummary = tokenUsagePart.toCompactString();
		
		progress.report(new VSCodeChatResponseProgressPart(`Token Usage: ${compactSummary}`));
	}

	/**
	 * Checks if the prompt is approaching token limits and shows a warning
	 */
	static checkAndWarnTokenLimits(
		buildPromptResult: RenderPromptResult,
		outputStream?: ChatResponseStream,
		warningThreshold: number = 0.8 // Warn when using 80% or more of available tokens
	): boolean {
		const tokenUsageMetadata = this.extractAndDisplayTokenUsage(buildPromptResult);
		
		if (!tokenUsageMetadata) {
			return false;
		}

		const { usagePercentage } = tokenUsageMetadata.tokenUsageInfo;
		const isNearLimit = usagePercentage >= (warningThreshold * 100);

		if (isNearLimit && outputStream) {
			const warningMessage = `⚠️ **Token Usage Warning**: Your prompt is using ${usagePercentage.toFixed(1)}% of available tokens. ` +
				`Consider reducing context size or using a more specific query to improve response quality.`;
			
			outputStream.markdown(warningMessage);
		}

		return isNearLimit;
	}

	/**
	 * Creates a formatted summary of token usage for logging or telemetry
	 */
	static createTokenUsageSummary(tokenUsageMetadata: PromptTokenUsageMetadata): string {
		const { totalTokens, maxTokens, usagePercentage, model, sections } = tokenUsageMetadata.tokenUsageInfo;
		
		const topSections = [...sections]
			.sort((a: IPromptSectionTokenUsage, b: IPromptSectionTokenUsage) => b.tokenCount - a.tokenCount)
			.slice(0, 3)
			.map((s: IPromptSectionTokenUsage) => `${s.section}: ${s.tokenCount}`)
			.join(', ');

		return `Token Usage: ${totalTokens}/${maxTokens} (${usagePercentage.toFixed(1)}%) on ${model}. Top sections: ${topSections}`;
	}
}

/**
 * Example of how to use token usage display in an intent invocation
 * 
 * This would typically be added to the buildPrompt method of an intent invocation:
 * 
 * ```typescript
 * async buildPrompt(
 *     promptParams: IBuildPromptContext, 
 *     progress: Progress<ChatResponseReferencePart | ChatResponseProgressPart>, 
 *     token: CancellationToken
 * ): Promise<RenderPromptResult<OutputMode.Raw> & { references: PromptReference[] }> {
 *     const renderer = await this.createRenderer(promptParams, this.endpoint, progress, token);
 *     const result = await renderer.render(progress, token);
 * 
 *     // Extract and optionally display token usage
 *     const tokenUsage = TokenUsageDisplayExample.extractAndDisplayTokenUsage(result);
 *     if (tokenUsage) {
 *         console.log('Token usage:', TokenUsageDisplayExample.createTokenUsageSummary(tokenUsage));
 *     }
 * 
 *     return result;
 * }
 * ```
 */

/**
 * Example of how to use token usage in a response processor:
 * 
 * ```typescript
 * class ExampleResponseProcessor implements IResponseProcessor {
 *     async processResponse(
 *         context: IResponseProcessorContext,
 *         inputStream: AsyncIterable<IResponsePart>,
 *         responseStream: ChatResponseStream,
 *         token: CancellationToken
 *     ): Promise<ChatResult | void> {
 *         
 *         // Show token usage at the beginning of processing
 *         const tokenUsage = TokenUsageDisplayExample.extractAndDisplayTokenUsage(
 *             context.buildPromptResult, 
 *             responseStream, 
 *             'summary'
 *         );
 * 
 *         // Check for token limit warnings
 *         TokenUsageDisplayExample.checkAndWarnTokenLimits(
 *             context.buildPromptResult, 
 *             responseStream
 *         );
 * 
 *         // ... rest of response processing
 *     }
 * }
 * ```
 */