/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement, PromptPiece, PromptSizing, SystemMessage } from '@vscode/prompt-tsx';
import { IPromptTokenUsageInfo } from './tokenUsageMetadata';

/**
 * Props for TokenAwarePromptBuilder
 */
export interface TokenAwarePromptBuilderProps extends BasePromptElementProps {
	/**
	 * Current token usage information to inject into the prompt
	 */
	readonly tokenUsageInfo?: IPromptTokenUsageInfo;

	/**
	 * Whether to include the token awareness prompt
	 * Default: true
	 */
	readonly includeTokenAwareness?: boolean;

	/**
	 * Priority for the system message
	 * Default: 100 (relatively high priority to ensure model sees it)
	 */
	readonly priority?: number;
}

/**
 * TokenAwarePromptBuilder injects token usage information into system prompts
 * to enable the AI model to self-manage its context and provide better responses
 * when approaching token limits.
 *
 * This component generates a system message that informs the model about:
 * - Current token consumption levels
 * - Available token budget
 * - Recommended actions based on usage thresholds
 * - Context management strategies
 *
 * Usage thresholds:
 * - 0-60%: Optimal - no special handling needed
 * - 60-80%: Caution - model should be aware and prioritize conciseness
 * - 80-95%: Warning - model should focus on essential information only
 * - 95%+: Critical - model must be extremely concise or suggest context reduction
 *
 * Example usage:
 * ```tsx
 * <TokenAwarePromptBuilder tokenUsageInfo={currentTokenUsage} priority={100} />
 * ```
 */
export class TokenAwarePromptBuilder extends PromptElement<TokenAwarePromptBuilderProps, void> {

	override render(state: void, sizing: PromptSizing): PromptPiece<any, any> | undefined {
		// Skip if token awareness is explicitly disabled
		if (this.props.includeTokenAwareness === false) {
			return undefined;
		}

		// Skip if no token usage info is provided
		if (!this.props.tokenUsageInfo) {
			return undefined;
		}

		const { tokenUsageInfo } = this.props;
		const { totalTokens, maxTokens, usagePercentage } = tokenUsageInfo;
		const priority = this.props.priority ?? 100;

		// Generate appropriate guidance based on usage level
		const guidance = this.generateGuidanceForUsageLevel(usagePercentage);

		return (
			<SystemMessage priority= { priority } >
			{ this.renderTokenAwarenessMessage(totalTokens, maxTokens, usagePercentage, guidance) }
			</SystemMessage>
		);
	}

	/**
	 * Renders the token awareness system message
	 */
	private renderTokenAwarenessMessage(
		totalTokens: number,
		maxTokens: number,
		usagePercentage: number,
		guidance: string
	): string {
		const statusEmoji = this.getStatusEmoji(usagePercentage);

		return `## ${statusEmoji} Token Usage Context

**Current Token Consumption:** ${totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens (${usagePercentage.toFixed(1)}%)

${guidance}

**Context Management:**
- You have visibility into your current token usage to help manage responses effectively
- If approaching limits, prioritize the most relevant information
- Consider suggesting context reduction strategies to the user when appropriate
- Be mindful of token efficiency in your responses`;
	}

	/**
	 * Generates usage-specific guidance based on current token percentage
	 */
	private generateGuidanceForUsageLevel(usagePercentage: number): string {
		if (usagePercentage >= 95) {
			// Critical: Model must take immediate action
			return `**Status:** ⛔ CRITICAL - You are at critical token capacity (${usagePercentage.toFixed(1)}%)

**Required Actions:**
1. **Be extremely concise** - Provide only essential information
2. **Suggest context reduction** - Recommend the user clear history or compact context
3. **Avoid long code examples** - Use brief snippets or pseudocode only
4. **Focus on direct answers** - Skip elaboration unless explicitly requested
5. **Consider suggesting** the user use commands like "compact context" or "clear history"

Without immediate action, your response may be truncated or fail.`;
		} else if (usagePercentage >= 80) {
			// Warning: Model should be cautious
			return `**Status:** ⚠️ WARNING - Approaching token limit (${usagePercentage.toFixed(1)}%)

**Recommended Actions:**
1. **Prioritize conciseness** - Be clear but brief in your responses
2. **Focus on essentials** - Include only the most relevant context and examples
3. **Suggest optimization** - If the user's query requires extensive context, suggest they:
   - Use more specific queries
   - Break large tasks into smaller parts
   - Consider compacting context or clearing history
4. **Monitor output size** - Keep code examples and explanations focused

You still have working room, but should be strategic about token usage.`;
		} else if (usagePercentage >= 60) {
			// Caution: Model should be aware
			return `**Status:** 🟡 CAUTION - Moderate token usage (${usagePercentage.toFixed(1)}%)

**Best Practices:**
1. **Balance detail with efficiency** - Provide thorough but not excessive responses
2. **Be strategic** - Include helpful context without over-explaining
3. **Stay aware** - Monitor token usage as conversation progresses
4. **Optimize when needed** - If the user asks complex questions requiring lots of context, consider suggesting they:
   - Be more specific in their queries
   - Focus on one aspect at a time

You have good working room but should remain mindful of token consumption.`;
		} else {
			// Optimal: Normal operation
			return `**Status:** 🟢 OPTIMAL - Healthy token budget (${usagePercentage.toFixed(1)}%)

**Current Operating Mode:**
- Operate normally with standard response quality
- Provide comprehensive answers with appropriate detail
- Include helpful context, examples, and explanations as needed
- No special token management required at this level

You have plenty of token budget to work with effectively.`;
		}
	}

	/**
	 * Gets the appropriate status emoji for the usage level
	 */
	private getStatusEmoji(usagePercentage: number): string {
		if (usagePercentage >= 95) {
			return '⛔';
		} else if (usagePercentage >= 80) {
			return '⚠️';
		} else if (usagePercentage >= 60) {
			return '🟡';
		} else {
			return '🟢';
		}
	}
}

/**
 * Helper function to create token-aware prompt injection
 * This can be used in intent invocations to quickly add token awareness
 *
 * @param tokenUsageInfo Current token usage information
 * @param priority Priority for the system message (default: 100)
 * @returns TokenAwarePromptBuilder element or undefined if no token info
 *
 * @example
 * ```tsx
 * const renderer = new PromptRenderer(accessor, endpoint, MyPrompt, {
 *   ...otherProps,
 *   tokenAwareness: createTokenAwarePrompt(currentTokenUsage)
 * });
 * ```
 */
export function createTokenAwarePrompt(
	tokenUsageInfo?: IPromptTokenUsageInfo,
	priority?: number
): JSX.Element | undefined {
	if (!tokenUsageInfo) {
		return undefined;
	}

	return <TokenAwarePromptBuilder tokenUsageInfo={ tokenUsageInfo } priority = { priority } />;
}

/**
 * Helper function to determine if token-aware prompting should be enabled
 * based on configuration and token usage level
 *
 * @param usagePercentage Current token usage percentage
 * @param enabledThreshold Threshold at which to enable token-aware prompting (default: 60%)
 * @returns true if token-aware prompting should be enabled
 */
export function shouldEnableTokenAwarePrompting(
	usagePercentage: number,
	enabledThreshold: number = 60
): boolean {
	return usagePercentage >= enabledThreshold;
}
