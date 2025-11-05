/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { CodeBlock } from '../../prompt/common/conversation';
import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/vs/base/common/event';
import { IDisposable } from '../../../util/vs/base/common/lifecycle';
import {
	ContentDetectionResult,
	ParseResult,
	PromptSection,
	RenderableElement,
	TokenizationEndpoint,
	ValidationResult,
	VisualizerState
} from './types';

/**
 * Service for parsing XML-like tags in prompts
 */
export const ISectionParserService = createServiceIdentifier<ISectionParserService>('ISectionParserService');
export interface ISectionParserService {
	readonly _serviceBrand: undefined;

	/**
	 * Parse a prompt string into sections
	 */
	parsePrompt(prompt: string): ParseResult;

	/**
	 * Validate XML structure of content
	 */
	validateXMLStructure(content: string): ValidationResult;

	/**
	 * Reconstruct prompt from sections
	 */
	reconstructPrompt(sections: PromptSection[]): string;
}

/**
 * Service for calculating token usage
 */
export const ITokenUsageCalculator = createServiceIdentifier<ITokenUsageCalculator>('ITokenUsageCalculator');
export interface ITokenUsageCalculator {
	readonly _serviceBrand: undefined;

	/**
	 * Calculate tokens for a single section with caching
	 */
	calculateSectionTokens(section: PromptSection, endpoint: TokenizationEndpoint): Promise<number>;

	/**
	 * Calculate tokens for a single section with debouncing
	 * Useful for real-time updates as the user types
	 */
	calculateSectionTokensDebounced(section: PromptSection, endpoint: TokenizationEndpoint): Promise<number>;

	/**
	 * Calculate total tokens for all sections with caching
	 */
	calculateTotalTokens(sections: PromptSection[], endpoint: TokenizationEndpoint): Promise<number>;

	/**
	 * Calculate total tokens for all sections with debouncing
	 * Useful for real-time updates as the user types
	 */
	calculateTotalTokensDebounced(sections: PromptSection[], endpoint: TokenizationEndpoint): Promise<number>;

	/**
	 * Clear the token cache manually
	 */
	clearCache(): void;

	/**
	 * Get cache statistics for debugging/monitoring
	 */
	getCacheStats(): { size: number; limit: number };

	/**
	 * Calculate tokens for a single section with breakdown (content vs tags)
	 */
	calculateSectionTokensWithBreakdown(
		section: PromptSection,
		endpoint: TokenizationEndpoint
	): Promise<{ total: number; content: number; tags: number }>;

	/**
	 * Calculate total tokens with breakdown for all sections
	 */
	calculateTotalTokensWithBreakdown(
		sections: PromptSection[],
		endpoint: TokenizationEndpoint
	): Promise<{ total: number; content: number; tags: number; overhead: number }>;

	/**
	 * Get warning level for a token count
	 * @returns 'normal' | 'warning' | 'critical'
	 */
	getWarningLevel(tokenCount: number): 'normal' | 'warning' | 'critical';

	/**
	 * Get warning thresholds for UI display
	 */
	getWarningThresholds(): { warning: number; critical: number };

	/**
	 * Event fired when language model changes
	 */
	readonly onLanguageModelChange: Event<TokenizationEndpoint>;
}

/**
 * Service for rendering rich content
 * Integrates with existing CodeBlock interface from conversation.ts
 */
export const IContentRenderer = createServiceIdentifier<IContentRenderer>('IContentRenderer');
export interface IContentRenderer {
	readonly _serviceBrand: undefined;

	/**
	 * Extract code blocks using the existing CodeBlock interface pattern from conversation.ts
	 * Returns CodeBlock[] with structure: { code: string; language?: string; resource?: URI; markdownBeforeBlock?: string }
	 */
	extractCodeBlocks(content: string): CodeBlock[];

	/**
	 * Detect renderable elements in content
	 */
	detectRenderableElements(content: string): RenderableElement[];

	/**
	 * Render elements to HTML
	 */
	renderToHTML(elements: RenderableElement[]): string;

	/**
	 * Extract plain text from elements
	 */
	extractPlainText(elements: RenderableElement[]): string;

	/**
	 * Detect content and return analysis with CodeBlock integration
	 */
	analyzeContent(content: string): ContentDetectionResult;
}

/**
 * Service for managing prompt state
 */
export const IPromptStateManager = createServiceIdentifier<IPromptStateManager>('IPromptStateManager');
export interface IPromptStateManager extends IDisposable {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when state changes
	 */
	readonly onDidChangeState: Event<VisualizerState>;

	/**
	 * Get current state
	 */
	getCurrentState(): VisualizerState;

	/**
	 * Update a section's content
	 */
	updateSection(sectionId: string, content: string): void;

	/**
	 * Reorder sections
	 */
	reorderSections(newOrder: string[]): void;

	/**
	 * Add a new section
	 */
	addSection(tagName: string, content: string, position?: number): void;

	/**
	 * Remove a section
	 */
	removeSection(sectionId: string): void;

	/**
	 * Toggle section collapse state
	 */
	toggleSectionCollapse(sectionId: string): void;

	/**
	 * Switch section mode between view and edit
	 */
	switchSectionMode(sectionId: string, mode: 'view' | 'edit'): void;

	/**
	 * Update the entire prompt
	 */
	updatePrompt(prompt: string): void;

	/**
	 * Set visualizer enabled state and persist it to configuration
	 */
	setEnabled(enabled: boolean): Promise<void>;

	/**
	 * Get visualizer enabled state
	 */
	isEnabled(): boolean;
}
