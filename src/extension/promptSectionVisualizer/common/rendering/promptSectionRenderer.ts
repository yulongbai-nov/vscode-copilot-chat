/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../../util/common/services';
import { PromptSection, RenderOptions, RenderedContent } from '../types';

export const IPromptSectionRenderer = createServiceIdentifier<IPromptSectionRenderer>('IPromptSectionRenderer');

export interface IPromptSectionRenderer {
	readonly _serviceBrand: undefined;

	/**
	 * Render prompt sections into semantic parts that downstream adapters can consume.
	 */
	renderSections(sections: PromptSection[], options: RenderOptions): AsyncIterable<PromptRendererPart>;
}

export type PromptRendererPart =
	| PromptRendererHeaderPart
	| PromptRendererSectionPart
	| PromptRendererWarningPart
	| PromptRendererCommandButtonPart
	| PromptRendererDividerPart
	| PromptRendererLoadMorePart
	| PromptRendererProgressPart
	| PromptRendererEmptyStatePart;

export interface PromptRendererHeaderPart {
	type: 'header';
	title: string;
	sectionCount: number;
	totalTokens: number;
	markdown: string;
	tokenBreakdown?: TokenBreakdownSummary;
}

export interface PromptRendererSectionPart {
	type: 'section';
	id: string;
	index: number;
	tagName: string;
	headerMarkdown: string;
	isCollapsed: boolean;
	tokenCount: number;
	tokenBreakdown?: TokenBreakdown;
	warningLevel?: 'normal' | 'warning' | 'critical';
	hasRenderableElements: boolean;
	renderedContent?: RenderedContent;
	contentText: string;
	content: string;
}

export interface PromptRendererWarningPart {
	type: 'warning';
	sectionId: string;
	level: 'warning' | 'critical';
	message: string;
	tokenBreakdown?: TokenBreakdown;
}

export interface PromptRendererCommandButtonPart {
	type: 'commandButton';
	target: 'section' | 'global';
	title: string;
	command: string;
	arguments?: unknown[];
	sectionId?: string;
}

export interface PromptRendererDividerPart {
	type: 'divider';
	scope: 'section' | 'global';
	sectionId?: string;
}

export interface PromptRendererLoadMorePart {
	type: 'loadMore';
	remainingCount: number;
	buttonTitle: string;
	markdown: string;
	command: string;
}

export interface PromptRendererProgressPart {
	type: 'progress';
	message: string;
	percentage?: number;
}

export interface PromptRendererEmptyStatePart {
	type: 'emptyState';
	title: string;
	message: string;
}

export interface TokenBreakdownSummary {
	content: number;
	tags: number;
	overhead?: number;
}

export interface TokenBreakdown {
	content: number;
	tags: number;
}
