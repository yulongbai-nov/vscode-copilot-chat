/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISectionParserService } from '../common/services';
import { ParseError, ParserConfig, ParseResult, PromptSection, ValidationResult } from '../common/types';

/**
 * Service implementation for parsing XML-like tags in prompts
 */
export class SectionParserService implements ISectionParserService {
	declare readonly _serviceBrand: undefined;

	private readonly defaultConfig: ParserConfig = {
		allowedTags: [], // Empty means all tags are allowed
		maxNestingDepth: 10,
		strictMode: false,
		customTagPatterns: []
	};

	private config: ParserConfig;

	constructor(config?: Partial<ParserConfig>) {
		this.config = { ...this.defaultConfig, ...config };
	}

	/**
	 * Parse a prompt string into sections
	 */
	parsePrompt(prompt: string): ParseResult {
		const sections: PromptSection[] = [];
		const errors: ParseError[] = [];

		if (!prompt || prompt.trim().length === 0) {
			return { sections, errors, hasValidStructure: true };
		}

		try {
			// Parse XML-like tags with support for nested structures
			const parseResult = this.parseXMLTags(prompt);
			sections.push(...parseResult.sections);
			errors.push(...parseResult.errors);

			// If no valid sections found, treat entire prompt as single section
			if (sections.length === 0 && prompt.trim()) {
				sections.push(this.createFallbackSection(prompt));
			}

			// Validate nesting depth
			this.validateNestingDepth(sections, errors);

			// Validate allowed tags if configured
			this.validateAllowedTags(sections, errors);

		} catch (error) {
			errors.push({
				type: 'MALFORMED_TAG',
				message: `Parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				position: 0
			});

			// Fallback to single section on critical error
			if (sections.length === 0) {
				sections.push(this.createFallbackSection(prompt));
			}
		}

		return {
			sections,
			errors,
			hasValidStructure: errors.length === 0
		};
	}

	/**
	 * Validate XML structure of content
	 */
	validateXMLStructure(content: string): ValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];

		if (!content || content.trim().length === 0) {
			return { isValid: true, errors, warnings };
		}

		try {
			// Check for basic XML structure issues
			this.validateBasicXMLStructure(content, errors, warnings);

			// Check for malformed tags
			this.validateTagStructure(content, errors, warnings);

			// Check for proper nesting
			this.validateNesting(content, errors, warnings);

			// Check for invalid characters in tag names
			this.validateTagNames(content, errors, warnings);

		} catch (error) {
			errors.push(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings
		};
	}

	/**
	 * Reconstruct prompt from sections
	 */
	reconstructPrompt(sections: PromptSection[]): string {
		if (!sections || sections.length === 0) {
			return '';
		}

		return this.reconstructPromptWithOptions(sections, {
			preserveOrder: false, // Use current section order, not original
			includeWhitespace: true,
			validateStructure: true
		});
	}

	/**
	 * Reconstruct prompt with advanced options for content integrity
	 */
	private reconstructPromptWithOptions(
		sections: PromptSection[],
		options: {
			preserveOrder?: boolean;
			includeWhitespace?: boolean;
			validateStructure?: boolean;
		}
	): string {
		const { preserveOrder = false, includeWhitespace = true, validateStructure = true } = options;

		// Sort sections if preserveOrder is true, otherwise use current array order
		const orderedSections = preserveOrder
			? [...sections].sort((a, b) => a.startIndex - b.startIndex)
			: sections;

		// Validate structure before reconstruction if requested
		if (validateStructure) {
			const validationErrors = this.validateSectionStructure(orderedSections);
			if (validationErrors.length > 0) {
				console.warn('Section structure validation failed:', validationErrors);
			}
		}

		// Handle special case for single fallback section
		if (orderedSections.length === 1 && orderedSections[0].tagName === 'prompt') {
			return orderedSections[0].content;
		}

		// Reconstruct sections with proper formatting
		const reconstructedSections = orderedSections.map(section => {
			return this.reconstructSection(section, includeWhitespace);
		});

		// Join sections with appropriate spacing
		return reconstructedSections.join(includeWhitespace ? '\n\n' : '\n');
	}

	/**
	 * Reconstruct a single section with proper formatting
	 */
	private reconstructSection(section: PromptSection, includeWhitespace: boolean): string {
		const content = section.content.trim();

		if (!content) {
			// Empty section
			return `<${section.tagName}></${section.tagName}>`;
		}

		if (includeWhitespace) {
			// Multi-line format with proper indentation
			const lines = content.split('\n');
			const indentedContent = lines.length > 1
				? '\n' + content + '\n'
				: content;
			return `<${section.tagName}>${indentedContent}</${section.tagName}>`;
		} else {
			// Compact format
			return `<${section.tagName}>${content}</${section.tagName}>`;
		}
	}

	/**
	 * Validate section structure for reconstruction
	 */
	private validateSectionStructure(sections: PromptSection[]): string[] {
		const errors: string[] = [];

		// Check for duplicate IDs
		const ids = sections.map(s => s.id);
		const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
		if (duplicateIds.length > 0) {
			errors.push(`Duplicate section IDs found: ${duplicateIds.join(', ')}`);
		}

		// Check for invalid tag names
		for (const section of sections) {
			if (!section.tagName || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(section.tagName)) {
				errors.push(`Invalid tag name: '${section.tagName}' in section ${section.id}`);
			}
		}

		// Check for content integrity
		for (const section of sections) {
			if (section.content === null || section.content === undefined) {
				errors.push(`Section ${section.id} has null or undefined content`);
			}
		}

		return errors;
	}

	/**
	 * Update section content and maintain integrity
	 */
	updateSectionContent(sections: PromptSection[], sectionId: string, newContent: string): PromptSection[] {
		return sections.map(section => {
			if (section.id === sectionId) {
				return {
					...section,
					content: newContent,
					metadata: {
						createdAt: section.metadata?.createdAt || new Date(),
						lastModified: new Date(),
						customAttributes: section.metadata?.customAttributes || {},
						validationRules: section.metadata?.validationRules
					}
				};
			}
			return section;
		});
	}

	/**
	 * Reorder sections while maintaining content integrity
	 */
	reorderSections(sections: PromptSection[], newOrder: string[]): PromptSection[] {
		// Validate that all section IDs are present
		const sectionIds = sections.map(s => s.id);
		const missingIds = newOrder.filter(id => !sectionIds.includes(id));
		const extraIds = sectionIds.filter(id => !newOrder.includes(id));

		if (missingIds.length > 0 || extraIds.length > 0) {
			throw new Error(`Invalid reorder: missing IDs [${missingIds.join(', ')}], extra IDs [${extraIds.join(', ')}]`);
		}

		// Create a map for quick lookup
		const sectionMap = new Map(sections.map(s => [s.id, s]));

		// Return sections in new order
		return newOrder.map(id => {
			const section = sectionMap.get(id);
			if (!section) {
				throw new Error(`Section with ID '${id}' not found`);
			}
			return section;
		});
	}

	/**
	 * Parse XML-like tags from prompt text
	 */
	private parseXMLTags(prompt: string): { sections: PromptSection[]; errors: ParseError[] } {
		const sections: PromptSection[] = [];
		const errors: ParseError[] = [];
		const tagStack: Array<{ tagName: string; startIndex: number; openTagEnd: number }> = [];

		// Enhanced regex to match XML-like tags with attributes support
		const tagRegex = /<\/?(\w+)(?:\s+[^>]*)?>/g;
		const matches: Array<{ match: RegExpExecArray; isClosing: boolean; tagName: string }> = [];

		let match;
		while ((match = tagRegex.exec(prompt)) !== null) {
			const fullMatch = match[0];
			const tagName = match[1];
			const isClosing = fullMatch.startsWith('</');

			matches.push({ match, isClosing, tagName });
		}

		// Process matches to build sections
		let sectionIndex = 0;
		for (const { match, isClosing, tagName } of matches) {
			const position = match.index;

			if (isClosing) {
				// Find matching opening tag
				const openingTagIndex = this.findMatchingOpeningTag(tagStack, tagName);

				if (openingTagIndex === -1) {
					errors.push({
						type: 'UNCLOSED_TAG',
						message: `Closing tag </${tagName}> found without matching opening tag`,
						position
					});
					continue;
				}

				// Extract the matching opening tag
				const openingTag = tagStack.splice(openingTagIndex, 1)[0];
				const contentStart = openingTag.openTagEnd;
				const contentEnd = position;
				const content = prompt.substring(contentStart, contentEnd);

				// Create section
				sections.push({
					id: `section-${sectionIndex++}`,
					tagName: openingTag.tagName,
					content: content.trim(),
					startIndex: openingTag.startIndex,
					endIndex: position + match[0].length,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				});

			} else {
				// Opening tag
				tagStack.push({
					tagName,
					startIndex: position,
					openTagEnd: position + match[0].length
				});
			}
		}

		// Check for unclosed tags
		for (const unclosedTag of tagStack) {
			errors.push({
				type: 'UNCLOSED_TAG',
				message: `Opening tag <${unclosedTag.tagName}> is not closed`,
				position: unclosedTag.startIndex
			});
		}

		return { sections, errors };
	}

	/**
	 * Find matching opening tag in the stack
	 */
	private findMatchingOpeningTag(tagStack: Array<{ tagName: string; startIndex: number; openTagEnd: number }>, tagName: string): number {
		// Find the most recent matching opening tag (LIFO for proper nesting)
		for (let i = tagStack.length - 1; i >= 0; i--) {
			if (tagStack[i].tagName === tagName) {
				return i;
			}
		}
		return -1;
	}

	/**
	 * Create a fallback section for content without XML tags
	 */
	private createFallbackSection(prompt: string): PromptSection {
		return {
			id: 'section-0',
			tagName: 'prompt',
			content: prompt.trim(),
			startIndex: 0,
			endIndex: prompt.length,
			tokenCount: 0,
			isEditing: false,
			isCollapsed: false,
			hasRenderableElements: false
		};
	}

	/**
	 * Validate nesting depth doesn't exceed configured maximum
	 */
	private validateNestingDepth(sections: PromptSection[], errors: ParseError[]): void {
		// For now, we'll implement a simple check based on section overlap
		// A more sophisticated implementation would track actual nesting during parsing
		const maxDepth = this.config.maxNestingDepth;


		for (const section of sections) {
			// Count overlapping sections as nested
			const overlappingSections = sections.filter(other =>
				other !== section &&
				other.startIndex < section.endIndex &&
				other.endIndex > section.startIndex
			);

			if (overlappingSections.length >= maxDepth) {
				errors.push({
					type: 'INVALID_NESTING',
					message: `Nesting depth exceeds maximum of ${maxDepth} levels`,
					position: section.startIndex
				});
			}
		}
	}

	/**
	 * Validate that only allowed tags are used
	 */
	private validateAllowedTags(sections: PromptSection[], errors: ParseError[]): void {
		if (this.config.allowedTags.length === 0) {
			return; // All tags allowed
		}

		for (const section of sections) {
			if (section.tagName !== 'prompt' && !this.config.allowedTags.includes(section.tagName)) {
				errors.push({
					type: 'MALFORMED_TAG',
					message: `Tag '${section.tagName}' is not in the allowed tags list`,
					position: section.startIndex
				});
			}
		}
	}

	/**
	 * Validate basic XML structure
	 */
	private validateBasicXMLStructure(content: string, errors: string[], warnings: string[]): void {
		// Check for unescaped angle brackets in content
		const unescapedBrackets = content.match(/[^<]*<(?![\/\w])[^>]*>/g);
		if (unescapedBrackets) {
			warnings.push('Found potential unescaped angle brackets that may not be valid XML tags');
		}

		// Check for empty tags
		const emptyTags = content.match(/<(\w+)>\s*<\/\1>/g);
		if (emptyTags) {
			warnings.push(`Found empty tags: ${emptyTags.join(', ')}`);
		}
	}

	/**
	 * Validate tag structure for malformed tags
	 */
	private validateTagStructure(content: string, errors: string[], warnings: string[]): void {
		// Check for malformed opening tags
		const malformedOpening = content.match(/<\w+[^>]*(?<!>)$/gm);
		if (malformedOpening) {
			errors.push('Found malformed opening tags (missing closing >)');
		}

		// Check for malformed closing tags
		const malformedClosing = content.match(/<\/\w+[^>]*(?<!>)$/gm);
		if (malformedClosing) {
			errors.push('Found malformed closing tags (missing closing >)');
		}

		// Check for tags with invalid characters
		const invalidTagChars = content.match(/<[\/]?[^a-zA-Z0-9\s\/>][^>]*>/g);
		if (invalidTagChars) {
			errors.push('Found tags with invalid characters in tag names');
		}

		// Check for self-closing tags (not typically used in our XML-like format)
		const selfClosingTags = content.match(/<\w+[^>]*\/>/g);
		if (selfClosingTags) {
			warnings.push(`Found self-closing tags: ${selfClosingTags.join(', ')} - these may not be processed correctly`);
		}
	}

	/**
	 * Validate proper nesting structure
	 */
	private validateNesting(content: string, errors: string[], warnings: string[]): void {
		const tagStack: string[] = [];
		const tagRegex = /<\/?(\w+)(?:\s+[^>]*)?>/g;
		let match;

		while ((match = tagRegex.exec(content)) !== null) {
			const fullMatch = match[0];
			const tagName = match[1];
			const isClosing = fullMatch.startsWith('</');

			if (isClosing) {
				if (tagStack.length === 0) {
					errors.push(`Closing tag </${tagName}> found without matching opening tag`);
				} else {
					const lastOpenTag = tagStack.pop();
					if (lastOpenTag !== tagName) {
						errors.push(`Mismatched tags: expected </${lastOpenTag}> but found </${tagName}>`);
						// Try to recover by putting the tag back
						tagStack.push(lastOpenTag!);
					}
				}
			} else {
				tagStack.push(tagName);
			}
		}

		// Check for unclosed tags
		if (tagStack.length > 0) {
			errors.push(`Unclosed tags found: ${tagStack.map(tag => `<${tag}>`).join(', ')}`);
		}
	}

	/**
	 * Validate tag names for invalid characters
	 */
	private validateTagNames(content: string, errors: string[], warnings: string[]): void {
		const tagNameRegex = /<\/?(\w+)/g;
		let match;
		const invalidNames: string[] = [];

		while ((match = tagNameRegex.exec(content)) !== null) {
			const tagName = match[1];

			// Check if tag name starts with a number (invalid in XML)
			if (/^\d/.test(tagName)) {
				invalidNames.push(tagName);
			}

			// Check for reserved XML names (case-insensitive)
			if (/^xml/i.test(tagName)) {
				warnings.push(`Tag name '${tagName}' starts with 'xml' which is reserved`);
			}
		}

		if (invalidNames.length > 0) {
			errors.push(`Invalid tag names (cannot start with numbers): ${invalidNames.join(', ')}`);
		}
	}
}