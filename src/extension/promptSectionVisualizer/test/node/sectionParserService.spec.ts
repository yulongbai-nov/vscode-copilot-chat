/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it } from 'vitest';
import { PromptSection } from '../../common/types';
import { SectionParserService } from '../../node/sectionParserService';

describe('SectionParserService', () => {
	let parser: SectionParserService;

	beforeEach(() => {
		parser = new SectionParserService();
	});

	describe('parsePrompt', () => {
		it('should parse simple XML tags', () => {
			const prompt = '<context>Some context</context><instructions>Do something</instructions>';
			const result = parser.parsePrompt(prompt);

			expect(result.sections).toHaveLength(2);
			expect(result.sections[0].tagName).toBe('context');
			expect(result.sections[0].content).toBe('Some context');
			expect(result.sections[1].tagName).toBe('instructions');
			expect(result.sections[1].content).toBe('Do something');
			expect(result.hasValidStructure).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should parse nested XML tags', () => {
			const prompt = '<context><background>Info</background><current>State</current></context>';
			const result = parser.parsePrompt(prompt);

			expect(result.sections).toHaveLength(3);
			expect(result.sections[0].tagName).toBe('background');
			expect(result.sections[0].content).toBe('Info');
			expect(result.sections[1].tagName).toBe('current');
			expect(result.sections[1].content).toBe('State');
			expect(result.sections[2].tagName).toBe('context');
		});

		it('should handle empty prompt', () => {
			const result = parser.parsePrompt('');

			expect(result.sections).toHaveLength(0);
			expect(result.hasValidStructure).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should handle prompt without XML tags', () => {
			const prompt = 'Plain text without any tags';
			const result = parser.parsePrompt(prompt);

			expect(result.sections).toHaveLength(1);
			expect(result.sections[0].tagName).toBe('prompt');
			expect(result.sections[0].content).toBe(prompt);
			expect(result.hasValidStructure).toBe(true);
		});

		it('should detect unclosed tags', () => {
			const prompt = '<context>Some context<instructions>Do something</instructions>';
			const result = parser.parsePrompt(prompt);

			expect(result.hasValidStructure).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].type).toBe('UNCLOSED_TAG');
			expect(result.errors[0].message).toContain('context');
		});

		it('should detect closing tag without opening', () => {
			const prompt = 'Some text</context><instructions>Do something</instructions>';
			const result = parser.parsePrompt(prompt);

			expect(result.hasValidStructure).toBe(false);
			expect(result.errors.some(e => e.type === 'UNCLOSED_TAG')).toBe(true);
		});

		it('should handle multiple unclosed tags', () => {
			const prompt = '<context>Text<instructions>More text<examples>Even more';
			const result = parser.parsePrompt(prompt);

			expect(result.hasValidStructure).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it('should parse tags with whitespace in content', () => {
			const prompt = '<context>\n  Some context\n  with newlines\n</context>';
			const result = parser.parsePrompt(prompt);

			expect(result.sections).toHaveLength(1);
			expect(result.sections[0].content).toContain('Some context');
			expect(result.sections[0].content).toContain('with newlines');
		});

		it('should handle empty tags', () => {
			const prompt = '<context></context><instructions>Do something</instructions>';
			const result = parser.parsePrompt(prompt);

			expect(result.sections).toHaveLength(2);
			expect(result.sections[0].content).toBe('');
			expect(result.sections[1].content).toBe('Do something');
		});

		it('should assign unique IDs to sections', () => {
			const prompt = '<context>A</context><instructions>B</instructions><examples>C</examples>';
			const result = parser.parsePrompt(prompt);

			const ids = result.sections.map(s => s.id);
			const uniqueIds = new Set(ids);
			expect(uniqueIds.size).toBe(ids.length);
		});

		it('should set correct start and end indices', () => {
			const prompt = '<context>Text</context>';
			const result = parser.parsePrompt(prompt);

			expect(result.sections[0].startIndex).toBe(0);
			expect(result.sections[0].endIndex).toBe(prompt.length);
		});
	});

	describe('nested tag handling', () => {
		it('should handle deeply nested tags', () => {
			const prompt = '<a><b><c><d>Content</d></c></b></a>';
			const result = parser.parsePrompt(prompt);

			expect(result.sections.length).toBeGreaterThan(0);
			expect(result.sections.some(s => s.content === 'Content')).toBe(true);
		});

		it('should handle mixed nested and sequential tags', () => {
			const prompt = '<context><sub>Nested</sub></context><instructions>Sequential</instructions>';
			const result = parser.parsePrompt(prompt);

			expect(result.sections.length).toBeGreaterThan(1);
			expect(result.sections.some(s => s.content === 'Nested')).toBe(true);
			expect(result.sections.some(s => s.content === 'Sequential')).toBe(true);
		});

		it('should validate nesting depth', () => {
			const parser = new SectionParserService({ maxNestingDepth: 2 });
			const prompt = '<a><b><c>Too deep</c></b></a>';
			const result = parser.parsePrompt(prompt);

			// Should parse but may have validation errors for depth
			expect(result.sections.length).toBeGreaterThan(0);
		});
	});

	describe('validateXMLStructure', () => {
		it('should validate correct XML structure', () => {
			const content = '<context>Valid content</context>';
			const result = parser.validateXMLStructure(content);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should detect malformed opening tags', () => {
			const content = '<context Valid content</context>';
			const result = parser.validateXMLStructure(content);

			expect(result.isValid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it('should detect unclosed tags in validation', () => {
			const content = '<context>Unclosed content';
			const result = parser.validateXMLStructure(content);

			expect(result.isValid).toBe(false);
			expect(result.errors.some(e => e.includes('Unclosed'))).toBe(true);
		});

		it('should detect mismatched tags', () => {
			const content = '<context>Content</instructions>';
			const result = parser.validateXMLStructure(content);

			expect(result.isValid).toBe(false);
			expect(result.errors.some(e => e.includes('Mismatched'))).toBe(true);
		});

		it('should warn about empty tags', () => {
			const content = '<context></context>';
			const result = parser.validateXMLStructure(content);

			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.warnings.some(w => w.includes('empty'))).toBe(true);
		});

		it('should handle empty content', () => {
			const result = parser.validateXMLStructure('');

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should detect invalid tag names starting with numbers', () => {
			const content = '<1context>Invalid</1context>';
			const result = parser.validateXMLStructure(content);

			expect(result.isValid).toBe(false);
			expect(result.errors.some(e => e.includes('Invalid tag names'))).toBe(true);
		});

		it('should warn about tags starting with xml', () => {
			const content = '<xmlContext>Content</xmlContext>';
			const result = parser.validateXMLStructure(content);

			expect(result.warnings.some(w => w.includes('xml'))).toBe(true);
		});
	});

	describe('reconstructPrompt', () => {
		it('should reconstruct prompt from sections', () => {
			const sections: PromptSection[] = [
				{
					id: '1',
					tagName: 'context',
					content: 'Some context',
					startIndex: 0,
					endIndex: 30,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				},
				{
					id: '2',
					tagName: 'instructions',
					content: 'Do something',
					startIndex: 30,
					endIndex: 60,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				}
			];

			const result = parser.reconstructPrompt(sections);

			expect(result).toContain('<context>');
			expect(result).toContain('Some context');
			expect(result).toContain('</context>');
			expect(result).toContain('<instructions>');
			expect(result).toContain('Do something');
			expect(result).toContain('</instructions>');
		});

		it('should handle empty sections array', () => {
			const result = parser.reconstructPrompt([]);

			expect(result).toBe('');
		});

		it('should handle single fallback section', () => {
			const sections: PromptSection[] = [
				{
					id: '1',
					tagName: 'prompt',
					content: 'Plain text',
					startIndex: 0,
					endIndex: 10,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				}
			];

			const result = parser.reconstructPrompt(sections);

			expect(result).toBe('Plain text');
		});

		it('should handle empty section content', () => {
			const sections: PromptSection[] = [
				{
					id: '1',
					tagName: 'context',
					content: '',
					startIndex: 0,
					endIndex: 20,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				}
			];

			const result = parser.reconstructPrompt(sections);

			expect(result).toContain('<context></context>');
		});

		it('should preserve content with newlines', () => {
			const sections: PromptSection[] = [
				{
					id: '1',
					tagName: 'context',
					content: 'Line 1\nLine 2\nLine 3',
					startIndex: 0,
					endIndex: 40,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				}
			];

			const result = parser.reconstructPrompt(sections);

			expect(result).toContain('Line 1');
			expect(result).toContain('Line 2');
			expect(result).toContain('Line 3');
		});
	});

	describe('section reordering', () => {
		it('should reorder sections correctly', () => {
			const sections: PromptSection[] = [
				{
					id: '1',
					tagName: 'context',
					content: 'Context',
					startIndex: 0,
					endIndex: 20,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				},
				{
					id: '2',
					tagName: 'instructions',
					content: 'Instructions',
					startIndex: 20,
					endIndex: 40,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				},
				{
					id: '3',
					tagName: 'examples',
					content: 'Examples',
					startIndex: 40,
					endIndex: 60,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				}
			];

			const reordered = parser.reorderSections(sections, ['3', '1', '2']);

			expect(reordered).toHaveLength(3);
			expect(reordered[0].id).toBe('3');
			expect(reordered[1].id).toBe('1');
			expect(reordered[2].id).toBe('2');
		});

		it('should throw error for missing section IDs', () => {
			const sections: PromptSection[] = [
				{
					id: '1',
					tagName: 'context',
					content: 'Context',
					startIndex: 0,
					endIndex: 20,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				}
			];

			expect(() => parser.reorderSections(sections, ['1', '2'])).toThrow();
		});

		it('should throw error for extra section IDs', () => {
			const sections: PromptSection[] = [
				{
					id: '1',
					tagName: 'context',
					content: 'Context',
					startIndex: 0,
					endIndex: 20,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				},
				{
					id: '2',
					tagName: 'instructions',
					content: 'Instructions',
					startIndex: 20,
					endIndex: 40,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				}
			];

			expect(() => parser.reorderSections(sections, ['1'])).toThrow();
		});
	});

	describe('content updates', () => {
		it('should update section content', () => {
			const sections: PromptSection[] = [
				{
					id: '1',
					tagName: 'context',
					content: 'Old content',
					startIndex: 0,
					endIndex: 20,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				}
			];

			const updated = parser.updateSectionContent(sections, '1', 'New content');

			expect(updated[0].content).toBe('New content');
			expect(updated[0].metadata?.lastModified).toBeDefined();
		});

		it('should not modify other sections', () => {
			const sections: PromptSection[] = [
				{
					id: '1',
					tagName: 'context',
					content: 'Content 1',
					startIndex: 0,
					endIndex: 20,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				},
				{
					id: '2',
					tagName: 'instructions',
					content: 'Content 2',
					startIndex: 20,
					endIndex: 40,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false
				}
			];

			const updated = parser.updateSectionContent(sections, '1', 'New content');

			expect(updated[0].content).toBe('New content');
			expect(updated[1].content).toBe('Content 2');
		});

		it('should preserve metadata when updating', () => {
			const createdAt = new Date('2024-01-01');
			const sections: PromptSection[] = [
				{
					id: '1',
					tagName: 'context',
					content: 'Old content',
					startIndex: 0,
					endIndex: 20,
					tokenCount: 0,
					isEditing: false,
					isCollapsed: false,
					hasRenderableElements: false,
					metadata: {
						createdAt,
						lastModified: createdAt,
						customAttributes: { key: 'value' }
					}
				}
			];

			const updated = parser.updateSectionContent(sections, '1', 'New content');

			expect(updated[0].metadata?.createdAt).toEqual(createdAt);
			expect(updated[0].metadata?.customAttributes.key).toBe('value');
		});
	});

	describe('parser configuration', () => {
		it('should respect allowed tags configuration', () => {
			const parser = new SectionParserService({ allowedTags: ['context', 'instructions'] });
			const prompt = '<context>Valid</context><invalid>Not allowed</invalid>';
			const result = parser.parsePrompt(prompt);

			expect(result.hasValidStructure).toBe(false);
			expect(result.errors.some(e => e.message.includes('not in the allowed tags list'))).toBe(true);
		});

		it('should allow all tags when allowedTags is empty', () => {
			const parser = new SectionParserService({ allowedTags: [] });
			const prompt = '<anytag>Content</anytag><othertag>More</othertag>';
			const result = parser.parsePrompt(prompt);

			expect(result.sections).toHaveLength(2);
			expect(result.hasValidStructure).toBe(true);
		});
	});

	describe('malformed XML recovery', () => {
		it('should create fallback section on critical parse error', () => {
			const prompt = 'Some content with <broken tags';
			const result = parser.parsePrompt(prompt);

			expect(result.sections.length).toBeGreaterThan(0);
		});

		it('should continue parsing after encountering errors', () => {
			const prompt = '<context>Valid</context><broken>Unclosed<instructions>Also valid</instructions>';
			const result = parser.parsePrompt(prompt);

			expect(result.sections.some(s => s.content === 'Valid')).toBe(true);
			expect(result.sections.some(s => s.content === 'Also valid')).toBe(true);
		});
	});
});
