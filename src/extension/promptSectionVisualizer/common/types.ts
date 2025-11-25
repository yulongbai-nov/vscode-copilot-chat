/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CodeBlock } from '../../prompt/common/conversation';
import { TokenizerType } from '../../../util/common/tokenizer';

/**
 * Represents a parsed prompt section with XML-like tags
 */
export interface PromptSection {
	/** Unique identifier for the section */
	id: string;
	/** XML tag name (e.g., "context", "instructions") */
	tagName: string;
	/** Section content */
	content: string;
	/** Rich content representation for rendering */
	renderedContent?: RenderedContent;
	/** Start position in original prompt */
	startIndex: number;
	/** End position in original prompt */
	endIndex: number;
	/** Calculated token count */
	tokenCount: number;
	/** Token breakdown (content vs tags) */
	tokenBreakdown?: {
		content: number;
		tags: number;
	};
	/** Warning level based on token count */
	warningLevel?: 'normal' | 'warning' | 'critical';
	/** Current editing state */
	isEditing: boolean;
	/** Collapse state for UI */
	isCollapsed: boolean;
	/** Whether section contains rich content */
	hasRenderableElements: boolean;
	/** Optional metadata */
	metadata?: SectionMetadata;
}

/**
 * Rich content representation for rendering
 */
export interface RenderedContent {
	type: 'markdown' | 'code' | 'list' | 'mixed';
	elements: RenderableElement[];
	htmlRepresentation: string;
	plainTextFallback: string;
}

/**
 * Individual renderable elements within content
 */
export interface RenderableElement {
	type: 'text' | 'code_block' | 'inline_code' | 'list_item' | 'emphasis' | 'link';
	content: string;
	language?: string;
	startIndex: number;
	endIndex: number;
	metadata?: Record<string, unknown>;
}

/**
 * Section metadata for enhanced functionality
 */
export interface SectionMetadata {
	createdAt: Date;
	lastModified: Date;
	customAttributes: Record<string, string>;
	validationRules?: ValidationRule[];
}

/**
 * Validation rule for section content
 */
export interface ValidationRule {
	type: 'required' | 'maxLength' | 'pattern';
	value: unknown;
	message: string;
}

/**
 * Overall state of the visualizer
 */
export interface VisualizerState {
	sections: PromptSection[];
	totalTokens: number;
	tokenBreakdown?: {
		content: number;
		tags: number;
		overhead: number;
	};
	isEnabled: boolean;
	currentLanguageModel: string;
	/**
	 * @deprecated Custom theming is replaced by VS Code's automatic theme support.
	 * The native Chat API automatically applies the current VS Code theme.
	 * This property is maintained for backward compatibility but is no longer used.
	 */
	uiTheme: 'light' | 'dark' | 'high-contrast';
}

/**
 * Parser configuration and results
 */
export interface ParserConfig {
	allowedTags: string[];
	maxNestingDepth: number;
	strictMode: boolean;
	customTagPatterns?: RegExp[];
}

/**
 * Result of parsing a prompt
 */
export interface ParseResult {
	sections: PromptSection[];
	errors: ParseError[];
	hasValidStructure: boolean;
}

/**
 * Parse error information
 */
export interface ParseError {
	type: 'MALFORMED_TAG' | 'UNCLOSED_TAG' | 'INVALID_NESTING';
	message: string;
	position: number;
}

/**
 * Token usage tracking information
 */
export interface TokenUsageMetrics {
	perSection: Map<string, number>;
	total: number;
	breakdown: {
		content: number;
		tags: number;
		overhead: number;
	};
	efficiency: number; // tokens per character ratio
}

/**
 * Tokenization endpoint configuration
 */
export interface TokenizationEndpoint {
	readonly tokenizer: TokenizerType;
}

/**
 * Token usage information
 */
export interface TokenUsageInfo {
	sectionTokens: Map<string, number>;
	totalTokens: number;
	lastUpdated: Date;
	tokenizationEndpoint: TokenizationEndpoint;
}

/**
 * Content detection result
 * Integrates with existing CodeBlock interface from conversation.ts
 */
export interface ContentDetectionResult {
	hasRenderableContent: boolean;
	elements: RenderableElement[];
	/** Code blocks extracted using the existing CodeBlock interface pattern from conversation.ts */
	codeBlocks: CodeBlock[];
	plainTextFallback: string;
}

/**
 * Validation result interface
 */
export interface ValidationResult {
	isValid: boolean;
	errors: string[];
	warnings: string[];
}
/**
 * Render options for native chat rendering
 */
export interface RenderOptions {
	/** Show action buttons for each section */
	showActions: boolean;

	/** Enable collapse/expand functionality */
	enableCollapse: boolean;

	/** Show token breakdown details */
	showTokenBreakdown: boolean;

	/** Render mode */
	mode: 'standalone' | 'inline';

	/** Maximum sections to render before pagination */
	maxSections?: number;
}

/**
 * Options used by section editors (shape defined by concrete editor implementation).
 */
export type SectionEditorOptions = Readonly<Record<string, unknown>>;
