/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptMetadata } from '@vscode/prompt-tsx';

/**
 * Represents token usage for a specific section of the prompt
 */
export interface IPromptSectionTokenUsage {
	/** The name/type of the section (e.g., 'system', 'context', 'user-query', 'tools') */
	readonly section: string;
	/** The content of this section (truncated for display if too long) */
	readonly content: string;
	/** Number of tokens consumed by this section */
	readonly tokenCount: number;
	/** Priority of this section in the prompt */
	readonly priority?: number;
	/** Whether this section was truncated due to token limits */
	readonly wasTruncated?: boolean;
}

/**
 * Comprehensive token usage information for the entire prompt
 */
export interface IPromptTokenUsageInfo {
	/** Total tokens used across all sections */
	readonly totalTokens: number;
	/** Maximum tokens available for this model */
	readonly maxTokens: number;
	/** Token usage breakdown by section */
	readonly sections: readonly IPromptSectionTokenUsage[];
	/** Percentage of token budget used */
	readonly usagePercentage: number;
	/** Whether the prompt hit token limits */
	readonly isNearLimit: boolean;
	/** Model being used */
	readonly model: string;
	/** Timestamp when this was calculated */
	readonly timestamp: number;
}

/**
 * Metadata class that stores token usage information for the prompt
 * This gets attached to the RenderPromptResult metadata and can be retrieved
 * by intent invocations to display token usage in the chat UI
 */
export class PromptTokenUsageMetadata extends PromptMetadata {
	constructor(public readonly tokenUsageInfo: IPromptTokenUsageInfo) {
		super();
	}

	/**
	 * Creates a formatted summary of token usage for display
	 */
	formatSummary(): string {
		const { totalTokens, maxTokens, usagePercentage, sections } = this.tokenUsageInfo;

		let summary = `**Token Usage**: ${totalTokens.toLocaleString()}/${maxTokens.toLocaleString()} (${usagePercentage.toFixed(1)}%)\n\n`;

		// Group sections by type
		const systemSections = sections.filter(s => s.section.includes('system') || s.section.includes('safety'));
		const contextSections = sections.filter(s => s.section.includes('context') || s.section.includes('document') || s.section.includes('workspace'));
		const userSections = sections.filter(s => s.section.includes('user') || s.section.includes('query'));
		const toolSections = sections.filter(s => s.section.includes('tool') || s.section.includes('function'));
		const otherSections = sections.filter(s => !systemSections.includes(s) && !contextSections.includes(s) && !userSections.includes(s) && !toolSections.includes(s));

		const addSectionGroup = (title: string, sectionGroup: readonly IPromptSectionTokenUsage[]) => {
			if (sectionGroup.length === 0) {
				return;
			}

			const groupTotal = sectionGroup.reduce((sum, s) => sum + s.tokenCount, 0);
			const groupPercentage = (groupTotal / totalTokens * 100).toFixed(1);

			summary += `**${title}** (${groupTotal.toLocaleString()} tokens, ${groupPercentage}%)\n`;
			for (const section of [...sectionGroup].sort((a, b) => b.tokenCount - a.tokenCount)) {
				const percentage = (section.tokenCount / totalTokens * 100).toFixed(1);
				const truncated = section.wasTruncated ? ' ⚠️ *truncated*' : '';
				summary += `  • ${section.section}: ${section.tokenCount.toLocaleString()} tokens (${percentage}%)${truncated}\n`;
			}
			summary += '\n';
		};

		addSectionGroup('System Instructions', systemSections);
		addSectionGroup('Context & Documents', contextSections);
		addSectionGroup('User Input', userSections);
		addSectionGroup('Tools & Functions', toolSections);
		addSectionGroup('Other', otherSections);

		if (this.tokenUsageInfo.isNearLimit) {
			summary += '\n⚠️ **Warning**: Approaching token limit. Some context may be truncated.';
		}

		return summary.trim();
	}

	/**
	 * Creates a detailed breakdown for debugging/development
	 */
	formatDetailedBreakdown(): string {
		const { tokenUsageInfo } = this;

		let breakdown = `## Detailed Token Usage Report\n\n`;
		breakdown += `**Model**: ${tokenUsageInfo.model}\n`;
		breakdown += `**Total**: ${tokenUsageInfo.totalTokens}/${tokenUsageInfo.maxTokens} tokens (${tokenUsageInfo.usagePercentage.toFixed(2)}%)\n`;
		breakdown += `**Generated**: ${new Date(tokenUsageInfo.timestamp).toLocaleString()}\n\n`;

		// Visual usage bar
		const barLength = 40;
		const filledLength = Math.round(barLength * tokenUsageInfo.usagePercentage / 100);
		const emptyLength = barLength - filledLength;
		const usageBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
		breakdown += `\`${usageBar}\` ${tokenUsageInfo.usagePercentage.toFixed(1)}%\n\n`;

		breakdown += `### Section Breakdown\n\n`;

		for (const section of [...tokenUsageInfo.sections].sort((a, b) => b.tokenCount - a.tokenCount)) {
			const percentage = (section.tokenCount / tokenUsageInfo.totalTokens * 100).toFixed(2);
			breakdown += `**${section.section}**\n`;
			breakdown += `- Tokens: ${section.tokenCount.toLocaleString()} (${percentage}%)\n`;
			if (section.priority !== undefined) {
				breakdown += `- Priority: ${section.priority}\n`;
			}
			if (section.wasTruncated) {
				breakdown += `- ⚠️ Truncated due to token limits\n`;
			}
			if (section.content.length > 0) {
				const displayContent = section.content.length > 200 ?
					section.content.substring(0, 200) + '...' :
					section.content;
				breakdown += `- Content preview: \`${displayContent.replace(/\n/g, '\\n')}\`\n`;
			}
			breakdown += '\n';
		}

		return breakdown;
	}
}

/**
 * Helper to create token usage metadata from sections
 */
export function createTokenUsageMetadata(
	sections: IPromptSectionTokenUsage[],
	maxTokens: number,
	model: string
): PromptTokenUsageMetadata {
	const totalTokens = sections.reduce((sum, section) => sum + section.tokenCount, 0);
	const usagePercentage = (totalTokens / maxTokens) * 100;
	const isNearLimit = usagePercentage > 85; // Consider near limit if >85%

	const tokenUsageInfo: IPromptTokenUsageInfo = {
		totalTokens,
		maxTokens,
		sections,
		usagePercentage,
		isNearLimit,
		model,
		timestamp: Date.now()
	};

	return new PromptTokenUsageMetadata(tokenUsageInfo);
}
