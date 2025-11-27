/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	IPromptSectionRenderer,
	PromptRendererCommandButtonPart,
	PromptRendererDividerPart,
	PromptRendererEmptyStatePart,
	PromptRendererHeaderPart,
	PromptRendererLoadMorePart,
	PromptRendererPart,
	PromptRendererProgressPart,
	PromptRendererSectionPart,
	PromptRendererWarningPart
} from '../common/rendering/promptSectionRenderer';
import { PromptSection, RenderOptions } from '../common/types';

/**
 * Native chat renderer that converts semantic prompt parts into VS Code chat response calls.
 */
export class NativeChatRenderer {
	private _hasRenderedGlobalActions = false;

	constructor(
		@IPromptSectionRenderer private readonly _sectionRenderer: IPromptSectionRenderer
	) { }

	/**
	 * Render sections to a chat response stream with progressive rendering.
	 */
	async renderSections(
		sections: PromptSection[],
		stream: vscode.ChatResponseStream,
		options: RenderOptions
	): Promise<void> {
		this._hasRenderedGlobalActions = false;

		try {
			for await (const part of this._sectionRenderer.renderSections(sections, options)) {
				this._dispatchPart(part, stream);
			}
		} catch (error) {
			stream.markdown('\n\n❌ **Error rendering sections**\n\n');
			stream.markdown(`An error occurred while rendering the prompt sections: ${error instanceof Error ? error.message : String(error)}`);
			throw error;
		}
	}

	private _dispatchPart(part: PromptRendererPart, stream: vscode.ChatResponseStream): void {
		switch (part.type) {
			case 'header':
				this._renderHeaderPart(part, stream);
				break;
			case 'emptyState':
				this._renderEmptyStatePart(part, stream);
				break;
			case 'section':
				this._renderSectionPart(part, stream);
				break;
			case 'warning':
				this._renderWarningPart(part, stream);
				break;
			case 'commandButton':
				this._renderCommandButtonPart(part, stream);
				break;
			case 'divider':
				this._renderDividerPart(part, stream);
				break;
			case 'loadMore':
				this._renderLoadMorePart(part, stream);
				break;
			case 'progress':
				this._renderProgressPart(part, stream);
				break;
		}
	}

	private _renderHeaderPart(part: PromptRendererHeaderPart, stream: vscode.ChatResponseStream): void {
		stream.markdown(part.markdown);

		if (part.tokenBreakdown) {
			const segments: string[] = [
				`Content: ${part.tokenBreakdown.content} tokens`,
				`Tags: ${part.tokenBreakdown.tags} tokens`
			];

			if (typeof part.tokenBreakdown.overhead === 'number') {
				segments.push(`Overhead: ${part.tokenBreakdown.overhead} tokens`);
			}

			stream.progress(`Token Breakdown: ${segments.join(', ')}`);

			let markdown = `- Content: \`${part.tokenBreakdown.content}\` tokens\n- Tags: \`${part.tokenBreakdown.tags}\` tokens`;
			if (typeof part.tokenBreakdown.overhead === 'number') {
				markdown += `\n- Overhead: \`${part.tokenBreakdown.overhead}\` tokens`;
			}
			stream.markdown(`${markdown}\n\n`);
		}
	}

	private _renderEmptyStatePart(part: PromptRendererEmptyStatePart, stream: vscode.ChatResponseStream): void {
		stream.markdown(`\n${part.title}\n\n${part.message}\n\n`);
	}

	private _renderSectionPart(part: PromptRendererSectionPart, stream: vscode.ChatResponseStream): void {
		stream.markdown(part.headerMarkdown);

		if (!part.isCollapsed) {
			stream.markdown(`\n${part.contentText}\n\n`);
		}
	}

	private _renderWarningPart(part: PromptRendererWarningPart, stream: vscode.ChatResponseStream): void {
		stream.warning(part.message);
	}

	private _renderCommandButtonPart(part: PromptRendererCommandButtonPart, stream: vscode.ChatResponseStream): void {
		if (part.target === 'global' && !this._hasRenderedGlobalActions) {
			stream.markdown('\n### Actions\n\n');
			this._hasRenderedGlobalActions = true;
		}

		stream.button({
			title: part.title,
			command: part.command,
			arguments: part.arguments
		});
	}

	private _renderDividerPart(part: PromptRendererDividerPart, stream: vscode.ChatResponseStream): void {
		if (part.scope === 'section') {
			stream.markdown('\n---\n\n');
		} else {
			stream.markdown('\n');
		}
	}

	private _renderLoadMorePart(part: PromptRendererLoadMorePart, stream: vscode.ChatResponseStream): void {
		stream.markdown(`\n${part.markdown}\n\n`);
		stream.button({
			title: part.buttonTitle,
			command: part.command
		});
	}

	private _renderProgressPart(part: PromptRendererProgressPart, stream: vscode.ChatResponseStream): void {
		stream.progress(part.message);
	}
}
