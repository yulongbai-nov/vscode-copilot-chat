/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString } from '../../../vscodeTypes';
import { IPromptSectionTokenUsage, IPromptTokenUsageInfo } from '../../prompts/common/tokenUsageMetadata';

/**
 * A chat response part that displays prompt token usage information
 * This appears in the chat UI to show users how their prompt context is consuming tokens
 */
export class ChatResponseTokenUsagePart {
	public readonly kind: 'tokenUsage' = 'tokenUsage';

	constructor(
		public readonly tokenUsageInfo: IPromptTokenUsageInfo,
		public readonly mode: 'summary' | 'detailed' = 'summary'
	) { }

	/**
	 * Creates a formatted markdown representation of the token usage
	 */
	toMarkdown(): MarkdownString {
		const { totalTokens, maxTokens, usagePercentage, sections, isNearLimit, model } = this.tokenUsageInfo;

		if (this.mode === 'detailed') {
			return this.createDetailedMarkdown();
		}

		// Create a compact summary view
		let markdown = '';

		// Usage overview with visual bar
		const barLength = 20;
		const filledLength = Math.round(barLength * usagePercentage / 100);
		const emptyLength = barLength - filledLength;
		const usageBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);

		// Add warning emoji if near limit
		const warningIcon = isNearLimit ? '⚠️ ' : '';

		markdown += `${warningIcon}**Token Usage** \`${usageBar}\` ${usagePercentage.toFixed(1)}%\n\n`;
		markdown += `**${totalTokens.toLocaleString()}** / **${maxTokens.toLocaleString()}** tokens (${model})\n\n`;

		// Show top token consumers
		const topSections = [...sections]
			.sort((a: IPromptSectionTokenUsage, b: IPromptSectionTokenUsage) => b.tokenCount - a.tokenCount)
			.slice(0, 5); // Show top 5 consumers

		if (topSections.length > 0) {
			markdown += `**Top Token Consumers:**\n`;
			for (const section of topSections) {
				const percentage = (section.tokenCount / totalTokens * 100).toFixed(0);
				const truncatedIndicator = section.wasTruncated ? ' ⚠️' : '';
				markdown += `• ${section.section}: ${section.tokenCount.toLocaleString()} (${percentage}%)${truncatedIndicator}\n`;
			}
		}

		if (isNearLimit) {
			markdown += '\n💡 *Tip: Consider reducing context size or using a more specific query to improve response quality.*';
		}

		return new MarkdownString(markdown);
	}

	/**
	 * Creates a detailed breakdown view
	 */
	private createDetailedMarkdown(): MarkdownString {
		const { totalTokens, maxTokens, usagePercentage, sections, model, timestamp } = this.tokenUsageInfo;

		let markdown = `## 📊 Detailed Token Usage Report\n\n`;

		// Header information
		markdown += `| Field | Value |\n`;
		markdown += `|-------|-------|\n`;
		markdown += `| **Model** | ${model} |\n`;
		markdown += `| **Total Tokens** | ${totalTokens.toLocaleString()} |\n`;
		markdown += `| **Max Tokens** | ${maxTokens.toLocaleString()} |\n`;
		markdown += `| **Usage** | ${usagePercentage.toFixed(2)}% |\n`;
		markdown += `| **Generated** | ${new Date(timestamp).toLocaleString()} |\n\n`;

		// Visual usage bar
		const barLength = 40;
		const filledLength = Math.round(barLength * usagePercentage / 100);
		const emptyLength = barLength - filledLength;
		const usageBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
		markdown += `\`\`\`\n${usageBar} ${usagePercentage.toFixed(1)}%\n\`\`\`\n\n`;

		// Section breakdown
		markdown += `### 📋 Section Breakdown\n\n`;

		// Group by section type for better organization
		const systemSections = sections.filter(s => s.section.includes('system') || s.section.includes('safety'));
		const contextSections = sections.filter(s => s.section.includes('context') || s.section.includes('document') || s.section.includes('workspace'));
		const userSections = sections.filter(s => s.section.includes('user') || s.section.includes('query'));
		const toolSections = sections.filter(s => s.section.includes('tool') || s.section.includes('function'));
		const otherSections = sections.filter(s =>
			!systemSections.includes(s) &&
			!contextSections.includes(s) &&
			!userSections.includes(s) &&
			!toolSections.includes(s)
		);

		const addSectionGroup = (title: string, emoji: string, groupSections: readonly IPromptSectionTokenUsage[]) => {
			if (groupSections.length === 0) {
				return;
			}

			const groupTotal = groupSections.reduce((sum: number, s: IPromptSectionTokenUsage) => sum + s.tokenCount, 0);
			const groupPercentage = (groupTotal / totalTokens * 100).toFixed(1);

			markdown += `#### ${emoji} ${title} (${groupTotal.toLocaleString()} tokens, ${groupPercentage}%)\n\n`;

			// Sort by token count descending
			const sortedSections = [...groupSections].sort((a, b) => b.tokenCount - a.tokenCount);

			for (const section of sortedSections) {
				const percentage = (section.tokenCount / totalTokens * 100).toFixed(1);
				const priority = section.priority !== undefined ? ` (Priority: ${section.priority})` : '';
				const truncated = section.wasTruncated ? ' ⚠️ *Truncated*' : '';

				markdown += `**${section.section}**${priority}${truncated}\n`;
				markdown += `- **Tokens:** ${section.tokenCount.toLocaleString()} (${percentage}%)\n`;

				if (section.content && section.content.length > 0) {
					const previewLength = 150;
					const contentPreview = section.content.length > previewLength ?
						section.content.substring(0, previewLength) + '...' :
						section.content;
					markdown += `- **Preview:** \`${contentPreview.replace(/\n/g, '\\n')}\`\n`;
				}
				markdown += '\n';
			}
		};

		addSectionGroup('System Instructions', '🔧', systemSections);
		addSectionGroup('Context & Documents', '📄', contextSections);
		addSectionGroup('User Input', '💬', userSections);
		addSectionGroup('Tools & Functions', '🛠️', toolSections);
		if (otherSections.length > 0) {
			addSectionGroup('Other', '📎', otherSections);
		}

		// Add optimization suggestions
		if (this.tokenUsageInfo.isNearLimit) {
			markdown += `\n### 💡 Optimization Suggestions\n\n`;
			markdown += `Your prompt is using ${usagePercentage.toFixed(1)}% of available tokens. Consider:\n\n`;
			markdown += `- **Reduce context size:** Focus on specific files or code sections\n`;
			markdown += `- **Use targeted queries:** Be more specific about what you need\n`;
			markdown += `- **Remove unnecessary history:** Clear old conversation context\n`;
			markdown += `- **Consider smaller scope:** Break large requests into smaller parts\n`;
		}

		return new MarkdownString(markdown);
	}

	/**
	 * Creates a compact single-line summary suitable for inline display
	 */
	toCompactString(): string {
		const { totalTokens, maxTokens, usagePercentage, isNearLimit } = this.tokenUsageInfo;
		const warning = isNearLimit ? '⚠️ ' : '';
		return `${warning}${totalTokens.toLocaleString()}/${maxTokens.toLocaleString()} tokens (${usagePercentage.toFixed(1)}%)`;
	}

	/**
	 * Creates a formatted markdown representation with actionable command links
	 * Command links appear based on token usage thresholds to help users manage token consumption
	 */
	toMarkdownWithActions(): MarkdownString {
		const { totalTokens, maxTokens, usagePercentage, sections, model } = this.tokenUsageInfo;

		let markdown = '';

		// Usage overview with visual bar
		const barLength = 20;
		const filledLength = Math.round(barLength * usagePercentage / 100);
		const emptyLength = barLength - filledLength;
		const usageBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);

		// Determine status and icon
		let statusIcon = '🟢';
		let statusText = 'Optimal';
		if (usagePercentage >= 95) {
			statusIcon = '⛔';
			statusText = 'Critical';
		} else if (usagePercentage >= 80) {
			statusIcon = '⚠️';
			statusText = 'Warning';
		} else if (usagePercentage >= 60) {
			statusIcon = '🟡';
			statusText = 'Caution';
		}

		markdown += `${statusIcon} **Token Usage: ${statusText}** \`${usageBar}\` ${usagePercentage.toFixed(1)}%\n\n`;
		markdown += `**${totalTokens.toLocaleString()}** / **${maxTokens.toLocaleString()}** tokens (${model})\n\n`;

		// Show top token consumers
		const topSections = [...sections]
			.sort((a: IPromptSectionTokenUsage, b: IPromptSectionTokenUsage) => b.tokenCount - a.tokenCount)
			.slice(0, 3); // Show top 3 consumers

		if (topSections.length > 0) {
			markdown += `**Top Token Consumers:**\n`;
			for (const section of topSections) {
				const percentage = (section.tokenCount / totalTokens * 100).toFixed(0);
				const truncatedIndicator = section.wasTruncated ? ' ⚠️' : '';
				markdown += `• ${section.section}: ${section.tokenCount.toLocaleString()} (${percentage}%)${truncatedIndicator}\n`;
			}
			markdown += '\n';
		}

		// Add actionable command links based on thresholds
		if (usagePercentage >= 95) {
			// Critical: Require immediate action
			markdown += `### ⛔ Critical Token Usage - Immediate Action Required\n\n`;
			markdown += `Your token usage is at critical levels. Choose an action:\n\n`;
			markdown += `- [🗜️ Compact Context](command:github.copilot.chat.compactContext) - Summarize conversation history\n`;
			markdown += `- [🗑️ Clear History](command:github.copilot.chat.clearHistory) - Reset conversation\n`;
			markdown += `- [📊 View Detailed Usage](command:github.copilot.chat.showDetailedTokenUsage) - Analyze consumption\n`;
		} else if (usagePercentage >= 80) {
			// Warning: Recommend actions
			markdown += `### ⚠️ Approaching Token Limit\n\n`;
			markdown += `Consider taking action to improve performance:\n\n`;
			markdown += `- [🗜️ Compact Context](command:github.copilot.chat.compactContext) - Summarize history to reduce tokens\n`;
			markdown += `- [🤖 Use Subagent](command:github.copilot.chat.delegateToSubagent) - Delegate task to focused agent\n`;
			markdown += `- [✏️ Simplify Query](command:github.copilot.chat.simplifyQuery) - Get help rephrasing\n`;
			markdown += `- [📊 View Details](command:github.copilot.chat.showDetailedTokenUsage) - See full breakdown\n`;
		} else if (usagePercentage >= 60) {
			// Caution: Monitor usage
			markdown += `### 🟡 Moderate Token Usage\n\n`;
			markdown += `Token usage is moderate. Available actions:\n\n`;
			markdown += `- [📊 View Detailed Usage](command:github.copilot.chat.showDetailedTokenUsage) - Analyze consumption\n`;
			markdown += `- [✏️ Simplify Query](command:github.copilot.chat.simplifyQuery) - Optimize your queries\n`;
		} else {
			// Optimal: Just provide info
			markdown += `💡 *Tip: You're using tokens efficiently. [View detailed breakdown](command:github.copilot.chat.showDetailedTokenUsage) for insights.*\n`;
		}

		return new MarkdownString(markdown, true); // supportHtml = true to enable command links
	}
}
