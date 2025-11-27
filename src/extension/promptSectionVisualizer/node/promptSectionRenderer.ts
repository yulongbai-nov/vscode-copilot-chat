/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPromptSectionRenderer, PromptRendererCommandButtonPart, PromptRendererDividerPart, PromptRendererEmptyStatePart, PromptRendererHeaderPart, PromptRendererLoadMorePart, PromptRendererPart, PromptRendererProgressPart, PromptRendererSectionPart, PromptRendererWarningPart, TokenBreakdownSummary } from '../common/rendering/promptSectionRenderer';
import { PromptSection, RenderOptions } from '../common/types';

/**
 * Default implementation of the prompt section renderer that emits semantic parts
 * which can then be adapted to native chat streams or webview DOM updates.
 */
export class PromptSectionRenderer implements IPromptSectionRenderer {
	public readonly _serviceBrand: undefined;

	public async *renderSections(sections: PromptSection[], options: RenderOptions): AsyncIterable<PromptRendererPart> {
		const header = this._createHeaderPart(sections, options);
		yield header;

		if (!sections.length) {
			yield this._createEmptyStatePart();

			if (options.showActions) {
				yield this._createDividerPart('global');
				yield this._createGlobalAddSectionPart();
			}

			return;
		}

		const sectionsToRender = this._applyPagination(sections, options);
		const showProgress = sectionsToRender.length > 10;

		if (showProgress) {
			yield this._createProgressPart(`Rendering ${sectionsToRender.length} sections...`, 0);
		}

		const batchSize = 5;
		for (let i = 0; i < sectionsToRender.length; i += batchSize) {
			if (showProgress && i > 0) {
				const percentage = Math.round((i / sectionsToRender.length) * 100);
				yield this._createProgressPart(`Rendering sections... ${percentage}% complete`, percentage);
			}

			const batch = sectionsToRender.slice(i, Math.min(i + batchSize, sectionsToRender.length));
			for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
				const section = batch[batchIndex];
				const sectionPart = this._createSectionPart(section, i + batchIndex, options);
				yield sectionPart;

				if (sectionPart.warningLevel && sectionPart.warningLevel !== 'normal') {
					yield this._createWarningPart(sectionPart);
				}

				if (options.showActions && !sectionPart.isCollapsed) {
					yield* this._createSectionCommandParts(sectionPart.id, sectionPart.isCollapsed);
				}

				yield this._createDividerPart('section', sectionPart.id);
			}

			if (i + batchSize < sectionsToRender.length) {
				await Promise.resolve();
			}
		}

		if (options.maxSections && sections.length > sectionsToRender.length) {
			yield this._createLoadMorePart(sections.length - sectionsToRender.length);
		}

		if (options.showActions) {
			yield this._createDividerPart('global');
			yield this._createGlobalAddSectionPart();
		}
	}

	private _createHeaderPart(sections: PromptSection[], options: RenderOptions): PromptRendererHeaderPart {
		const totalTokens = sections.reduce((sum, section) => sum + (section.tokenCount || 0), 0);
		const sectionCount = sections.length;
		const title = 'Prompt Section Visualizer';
		const tokenBreakdown = options.showTokenBreakdown
			? this._computeTokenBreakdown(sections)
			: undefined;

		let markdown = `## ${title}\n\n**Total Tokens:** \`${totalTokens}\`\n\n`;

		if (tokenBreakdown) {
			markdown += `- Content: \`${tokenBreakdown.content}\` tokens\n`;
			markdown += `- Tags: \`${tokenBreakdown.tags}\` tokens\n`;
			if (typeof tokenBreakdown.overhead === 'number') {
				markdown += `- Overhead: \`${tokenBreakdown.overhead}\` tokens\n`;
			}
			markdown += '\n';
		}

		return {
			type: 'header',
			title,
			sectionCount,
			totalTokens,
			markdown,
			tokenBreakdown
		};
	}

	private _createEmptyStatePart(): PromptRendererEmptyStatePart {
		return {
			type: 'emptyState',
			title: 'No prompt sections found.',
			message: 'Paste a prompt with XML-like tags (for example, <context>...</context>) to visualize it here.'
		};
	}

	private _createSectionPart(section: PromptSection, index: number, options: RenderOptions): PromptRendererSectionPart {
		const tokenBadge = `${section.tokenCount} tokens`;
		const collapseIcon = section.isCollapsed ? '▶' : '▼';
		let headerMarkdown = `### ${collapseIcon} \`<${section.tagName}>\` \`${tokenBadge}\``;

		const tokenBreakdown = options.showTokenBreakdown ? section.tokenBreakdown : undefined;
		if (tokenBreakdown) {
			headerMarkdown += ` (content: \`${tokenBreakdown.content}\`, tags: \`${tokenBreakdown.tags}\`)`;
		}

		headerMarkdown += '\n\n';

		const contentText = section.content;

		return {
			type: 'section',
			id: section.id,
			index,
			tagName: section.tagName,
			headerMarkdown,
			isCollapsed: section.isCollapsed,
			tokenCount: section.tokenCount,
			tokenBreakdown,
			warningLevel: section.warningLevel,
			hasRenderableElements: section.hasRenderableElements,
			renderedContent: section.renderedContent,
			contentText,
			content: section.content
		};
	}

	private _createWarningPart(section: PromptRendererSectionPart): PromptRendererWarningPart {
		const levelLabel = section.warningLevel === 'critical' ? 'Critical' : 'Warning';
		let message = `${levelLabel}: Section "${section.tagName}" has high token usage (${section.tokenCount} tokens)`;

		if (section.tokenBreakdown) {
			message += ` - Content: ${section.tokenBreakdown.content} tokens, Tags: ${section.tokenBreakdown.tags} tokens`;
		}

		return {
			type: 'warning',
			sectionId: section.id,
			level: section.warningLevel === 'critical' ? 'critical' : 'warning',
			message,
			tokenBreakdown: section.tokenBreakdown
		};
	}

	private *_createSectionCommandParts(sectionId: string, isCollapsed: boolean): Iterable<PromptRendererCommandButtonPart> {
		if (isCollapsed) {
			return;
		}

		yield {
			type: 'commandButton',
			target: 'section',
			title: 'Edit',
			command: 'github.copilot.promptVisualizer.editSection',
			arguments: [sectionId],
			sectionId
		};

		yield {
			type: 'commandButton',
			target: 'section',
			title: 'Delete',
			command: 'github.copilot.promptVisualizer.deleteSection',
			arguments: [sectionId],
			sectionId
		};

		yield {
			type: 'commandButton',
			target: 'section',
			title: isCollapsed ? 'Expand' : 'Collapse',
			command: 'github.copilot.promptVisualizer.toggleCollapse',
			arguments: [sectionId],
			sectionId
		};
	}

	private _createDividerPart(scope: PromptRendererDividerPart['scope'], sectionId?: string): PromptRendererDividerPart {
		return {
			type: 'divider',
			scope,
			sectionId
		};
	}

	private _createLoadMorePart(remainingCount: number): PromptRendererLoadMorePart {
		return {
			type: 'loadMore',
			remainingCount,
			buttonTitle: `Load ${remainingCount} more sections`,
			markdown: `**${remainingCount} more sections...**`,
			command: 'github.copilot.promptVisualizer.loadMore'
		};
	}

	private _createGlobalAddSectionPart(): PromptRendererCommandButtonPart {
		return {
			type: 'commandButton',
			target: 'global',
			title: 'Add Section',
			command: 'github.copilot.promptVisualizer.addSection'
		};
	}

	private _createProgressPart(message: string, percentage?: number): PromptRendererProgressPart {
		return {
			type: 'progress',
			message,
			percentage
		};
	}

	private _applyPagination(sections: PromptSection[], options: RenderOptions): PromptSection[] {
		if (!options.maxSections) {
			return sections;
		}

		return sections.slice(0, options.maxSections);
	}

	private _computeTokenBreakdown(sections: PromptSection[]): TokenBreakdownSummary {
		const breakdown = sections.reduce(
			(acc, section) => {
				if (section.tokenBreakdown) {
					acc.content += section.tokenBreakdown.content;
					acc.tags += section.tokenBreakdown.tags;
				}
				return acc;
			},
			{ content: 0, tags: 0 }
		);

		return {
			content: breakdown.content,
			tags: breakdown.tags,
			overhead: breakdown.tags
		};
	}
}
