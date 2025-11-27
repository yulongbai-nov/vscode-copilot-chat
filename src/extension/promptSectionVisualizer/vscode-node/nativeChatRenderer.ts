/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IContentRenderer, ISectionParserService, ITokenUsageCalculator } from '../common/services';
import { PromptSection, RenderOptions } from '../common/types';

/**
 * Native chat renderer that converts prompt sections into VS Code chat response parts
 */
export class NativeChatRenderer {
	constructor(
		// @ts-expect-error - Will be used in future iterations for advanced rendering
		@ISectionParserService private readonly _parserService: ISectionParserService,
		// @ts-expect-error - Will be used in future iterations for token calculation
		@ITokenUsageCalculator private readonly _tokenCalculator: ITokenUsageCalculator,
		// @ts-expect-error - Will be used in future iterations for rich content rendering
		@IContentRenderer private readonly _contentRenderer: IContentRenderer
	) { }

	/**
	 * Render sections to a chat response stream with progressive rendering
	 */
	async renderSections(
		sections: PromptSection[],
		stream: vscode.ChatResponseStream,
		options: RenderOptions
	): Promise<void> {
		try {
			// Render header with total tokens
			await this._renderHeader(sections, stream, options);

			// Determine sections to render based on pagination
			const sectionsToRender = options.maxSections
				? sections.slice(0, options.maxSections)
				: sections;

			// Show progress for large prompts
			const showProgress = sectionsToRender.length > 10;
			if (showProgress) {
				stream.progress(`Rendering ${sectionsToRender.length} sections...`);
			}

			// Progressive rendering: render sections in batches to avoid blocking
			const batchSize = 5; // Render 5 sections at a time
			for (let i = 0; i < sectionsToRender.length; i += batchSize) {
				const batch = sectionsToRender.slice(i, Math.min(i + batchSize, sectionsToRender.length));

				// Update progress
				if (showProgress && i > 0) {
					const progress = Math.round((i / sectionsToRender.length) * 100);
					stream.progress(`Rendering sections... ${progress}% complete`);
				}

				// Render each section in the batch
				for (const section of batch) {
					await this._renderSection(section, stream, options);
				}

				// Allow UI to update between batches
				if (i + batchSize < sectionsToRender.length) {
					await new Promise(resolve => setTimeout(resolve, 0));
				}
			}

			// Render "Load More" if there are more sections
			if (options.maxSections && sections.length > options.maxSections) {
				this._renderLoadMore(sections.length - options.maxSections, stream);
			}

			// Render footer with actions
			await this._renderFooter(stream, options);
		} catch (error) {
			// Error handling: render error message
			stream.markdown('\n\n❌ **Error rendering sections**\n\n');
			stream.markdown(`An error occurred while rendering the prompt sections: ${error instanceof Error ? error.message : String(error)}`);
			throw error;
		}
	}

	/**
	 * Render header with total token count
	 */
	private async _renderHeader(
		sections: PromptSection[],
		stream: vscode.ChatResponseStream,
		options: RenderOptions
	): Promise<void> {
		const totalTokens = sections.reduce((sum, section) => sum + section.tokenCount, 0);
		stream.markdown(`## Prompt Section Visualizer\n\n**Total Tokens:** \`${totalTokens}\`\n\n`);

		if (options.showTokenBreakdown) {
			const contentTokens = sections.reduce(
				(sum, section) => sum + (section.tokenBreakdown?.content || 0),
				0
			);
			const tagTokens = sections.reduce(
				(sum, section) => sum + (section.tokenBreakdown?.tags || 0),
				0
			);

			// Use ChatResponseProgressPart for token breakdown display
			stream.progress(`Token Breakdown: Content: ${contentTokens} tokens, Tags: ${tagTokens} tokens`);
			stream.markdown(`- Content: \`${contentTokens}\` tokens\n- Tags: \`${tagTokens}\` tokens\n\n`);
		}
	}

	/**
	 * Render a single section using native chat components with error recovery
	 */
	private async _renderSection(
		section: PromptSection,
		stream: vscode.ChatResponseStream,
		options: RenderOptions
	): Promise<void> {
		try {
			// Section header with markdown
			const headerMarkdown = this._createSectionHeader(section, options);
			stream.markdown(headerMarkdown);

			// Token warning if needed
			if (section.warningLevel === 'warning' || section.warningLevel === 'critical') {
				const warningMessage = this._createTokenWarning(section);
				stream.warning(warningMessage);
			}

			// Section content (only if not collapsed)
			if (!section.isCollapsed) {
				if (section.hasRenderableElements && section.renderedContent) {
					// Render rich content
					await this._renderRichContent(section, stream);
				} else {
					// Render plain content
					stream.markdown(`\n${section.content}\n\n`);
				}

				// Action buttons
				if (options.showActions) {
					this._renderActionButtons(section, stream);
				}
			}

			stream.markdown('\n---\n\n');
		} catch (error) {
			// Error recovery: render a fallback for this section
			stream.markdown(`\n⚠️ Error rendering section \`<${section.tagName}>\`: ${error instanceof Error ? error.message : String(error)}\n\n`);
			stream.markdown(`**Content (plain text):**\n\n\`\`\`\n${section.content.substring(0, 500)}${section.content.length > 500 ? '...' : ''}\n\`\`\`\n\n`);
			stream.markdown('\n---\n\n');
		}
	}

	/**
	 * Create section header markdown
	 */
	private _createSectionHeader(section: PromptSection, options: RenderOptions): string {
		const collapseIcon = section.isCollapsed ? '▶' : '▼';
		const tokenBadge = `\`${section.tokenCount} tokens\``;

		let header = `### ${collapseIcon} \`<${section.tagName}>\` ${tokenBadge}`;

		if (options.showTokenBreakdown && section.tokenBreakdown) {
			header += ` (content: \`${section.tokenBreakdown.content}\`, tags: \`${section.tokenBreakdown.tags}\`)`;
		}

		return header + '\n\n';
	}

	/**
	 * Create token warning message
	 */
	private _createTokenWarning(section: PromptSection): string {
		const level = section.warningLevel === 'critical' ? 'Critical' : 'Warning';
		let message = `${level}: Section "${section.tagName}" has high token usage (${section.tokenCount} tokens)`;

		// Include token breakdown if available
		if (section.tokenBreakdown) {
			message += ` - Content: ${section.tokenBreakdown.content} tokens, Tags: ${section.tokenBreakdown.tags} tokens`;
		}

		return message;
	}

	/**
	 * Render rich content (code blocks, lists, etc.)
	 */
	private async _renderRichContent(
		section: PromptSection,
		stream: vscode.ChatResponseStream
	): Promise<void> {
		if (!section.renderedContent) {
			stream.markdown(`\n${section.content}\n\n`);
			return;
		}

		// Use the plain text fallback for now
		// In future iterations, we can parse and render individual elements
		stream.markdown(`\n${section.renderedContent.plainTextFallback}\n\n`);
	}

	/**
	 * Render action buttons using ChatResponseCommandButtonPart
	 */
	private _renderActionButtons(section: PromptSection, stream: vscode.ChatResponseStream): void {
		// Edit button
		stream.button({
			title: 'Edit',
			command: 'github.copilot.promptVisualizer.editSection',
			arguments: [section.id]
		});

		// Delete button
		stream.button({
			title: 'Delete',
			command: 'github.copilot.promptVisualizer.deleteSection',
			arguments: [section.id]
		});

		// Collapse/Expand button
		stream.button({
			title: section.isCollapsed ? 'Expand' : 'Collapse',
			command: 'github.copilot.promptVisualizer.toggleCollapse',
			arguments: [section.id]
		});
	}

	/**
	 * Render "Load More" button for pagination
	 */
	private _renderLoadMore(remainingCount: number, stream: vscode.ChatResponseStream): void {
		stream.markdown(`\n**${remainingCount} more sections...**\n\n`);
		stream.button({
			title: `Load ${remainingCount} more sections`,
			command: 'github.copilot.promptVisualizer.loadMore'
		});
	}

	/**
	 * Render footer with global actions
	 */
	private async _renderFooter(
		stream: vscode.ChatResponseStream,
		options: RenderOptions
	): Promise<void> {
		if (options.showActions) {
			stream.markdown('\n### Actions\n\n');
			stream.button({
				title: 'Add Section',
				command: 'github.copilot.promptVisualizer.addSection'
			});
		}
	}
}
