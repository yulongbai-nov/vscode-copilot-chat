/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { CodeBlock } from '../../prompt/common/conversation';
import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/vs/base/common/event';
import { IDisposable } from '../../../util/vs/base/common/lifecycle';
import {
	ContentDetectionResult,
	RenderOptions,
	ParseResult,
	PromptSection,
	RenderableElement,
	SectionEditorOptions,
	TokenizationEndpoint,
	ValidationResult,
	VisualizerState,
	PromptStatePatch
} from './types';
export {
	IPromptSectionRenderer,
	PromptRendererPart,
	PromptRendererHeaderPart,
	PromptRendererSectionPart,
	PromptRendererWarningPart,
	PromptRendererCommandButtonPart,
	PromptRendererDividerPart,
	PromptRendererLoadMorePart,
	PromptRendererProgressPart,
	PromptRendererEmptyStatePart,
	TokenBreakdownSummary,
	TokenBreakdown
} from './rendering/promptSectionRenderer';

export type SectionEditorState = Readonly<Record<string, unknown>>;

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
	 * Event fired with granular patches whenever sections are mutated.
	 */
	readonly onDidApplyPatch: Event<PromptStatePatch>;

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

/**
 * Service for managing feature flags
 */
export const IFeatureFlagService = createServiceIdentifier<IFeatureFlagService>('IFeatureFlagService');
export interface IFeatureFlagService {
	readonly _serviceBrand: undefined;

	/**
	 * Check if native rendering is enabled
	 */
	isNativeRenderingEnabled(): boolean;

	/**
	 * Get the current render mode
	 */
	getRenderMode(): 'inline' | 'standalone' | 'auto';

	/**
	 * Check if the visualizer is enabled
	 */
	isVisualizerEnabled(): boolean;

	/**
	 * Determine the effective render mode based on configuration and context
	 */
	getEffectiveRenderMode(context?: 'chat' | 'standalone'): 'inline' | 'standalone';

	/**
	 * Listen for configuration changes
	 */
	onConfigurationChanged(
		callback: (useNativeRendering: boolean, renderMode: 'inline' | 'standalone' | 'auto') => void
	): vscode.Disposable;
}

/**
 * Service for rendering sections using native chat APIs
 */
export const INativeChatRenderer = createServiceIdentifier<INativeChatRenderer>('INativeChatRenderer');
export interface INativeChatRenderer {
	readonly _serviceBrand: undefined;

	/**
	 * Render sections to a chat response stream
	 */
	renderSections(
		sections: PromptSection[],
		stream: vscode.ChatResponseStream,
		options: RenderOptions
	): Promise<void>;
}

/**
 * Chat participant for prompt visualization
 */
export const IPromptVisualizerChatParticipant = createServiceIdentifier<IPromptVisualizerChatParticipant>('IPromptVisualizerChatParticipant');
export interface IPromptVisualizerChatParticipant extends IDisposable {
	readonly _serviceBrand: undefined;
}

/**
 * Service for editing prompt sections
 */
export const ISectionEditorService = createServiceIdentifier<ISectionEditorService>('ISectionEditorService');
export interface ISectionEditorService extends IDisposable {
	readonly _serviceBrand: undefined;

	/**
	 * Edit a section using the configured editor mode
	 */
	editSection(section: PromptSection, options?: SectionEditorOptions): Promise<string | undefined>;

	/**
	 * Edit section in a temporary document
	 */
	editSectionInDocument(section: PromptSection, options: SectionEditorOptions): Promise<string | undefined>;

	/**
	 * Edit section inline using quick input
	 */
	editSectionInline(section: PromptSection, options: SectionEditorOptions): Promise<string | undefined>;

	/**
	 * Save editor state for a section
	 */
	saveEditorState(sectionId: string, editor: vscode.TextEditor): void;

	/**
	 * Restore editor state for a section
	 */
	restoreEditorState(sectionId: string, editor: vscode.TextEditor): void;

	/**
	 * Get editor state for a section
	 */
	getEditorState(sectionId: string): SectionEditorState | undefined;

	/**
	 * Clear editor state for a section
	 */
	clearEditorState(sectionId: string): void;

	/**
	 * Undo last edit for a section
	 */
	undoEdit(sectionId: string): Promise<boolean>;

	/**
	 * Redo last undone edit for a section
	 */
	redoEdit(sectionId: string): Promise<boolean>;

	/**
	 * Check if undo is available for a section
	 */
	canUndo(sectionId: string): boolean;

	/**
	 * Check if redo is available for a section
	 */
	canRedo(sectionId: string): boolean;
}

/**
 * Controller for managing hybrid mode support (inline vs standalone)
 */
export const IPromptVisualizerController = createServiceIdentifier<IPromptVisualizerController>('IPromptVisualizerController');
export interface IPromptVisualizerController extends IDisposable {
	readonly _serviceBrand: undefined;

	/**
	 * Get the current render mode
	 */
	getCurrentMode(): 'inline' | 'standalone';

	/**
	 * Switch between inline and standalone modes
	 */
	switchMode(mode: 'inline' | 'standalone', persist?: boolean): Promise<void>;

	/**
	 * Set the provider instance for standalone mode
	 */
	setProvider(provider: vscode.WebviewViewProvider): void;

	/**
	 * Render in standalone webview panel mode
	 */
	renderStandalone(): Promise<void>;

	/**
	 * Render inline in chat mode
	 */
	renderInline(stream: vscode.ChatResponseStream, options?: RenderOptions): Promise<void>;

	/**
	 * Render using the current mode
	 */
	render(stream?: vscode.ChatResponseStream, options?: RenderOptions): Promise<void>;

	/**
	 * Handle chat context and follow-up interactions
	 */
	handleChatContext(context: vscode.ChatContext, request: vscode.ChatRequest): Promise<void>;

	/**
	 * Sync section edit back to chat for inline mode
	 */
	syncSectionEditToChat(sectionId: string, newContent: string): void;

	/**
	 * Handle chat input changes for inline mode
	 */
	handleChatInputChange(content: string): void;
}
