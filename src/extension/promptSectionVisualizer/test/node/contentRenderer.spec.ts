/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it } from 'vitest';
import { RenderableElement } from '../../common/types';
import { ContentRenderer } from '../../node/contentRenderer';

describe('ContentRenderer', () => {
	let renderer: ContentRenderer;

	beforeEach(() => {
		renderer = new ContentRenderer();
	});

	describe('detectRenderableElements', () => {
		it('should detect code blocks with language', () => {
			const content = '```typescript\nconst x = 1;\n```';
			const elements = renderer.detectRenderableElements(content);

			expect(elements).toHaveLength(1);
			expect(elements[0].type).toBe('code_block');
			expect(elements[0].language).toBe('typescript');
			expect(elements[0].content).toBe('const x = 1;');
		});

		it('should detect code blocks without language', () => {
			const content = '```\nconst x = 1;\n```';
			const elements = renderer.detectRenderableElements(content);

			expect(elements).toHaveLength(1);
			expect(elements[0].type).toBe('code_block');
			expect(elements[0].language).toBe('text');
			expect(elements[0].content).toBe('const x = 1;');
		});

		it('should detect multiple code blocks', () => {
			const content = '```javascript\nconst a = 1;\n```\nSome text\n```python\nprint("hello")\n```';
			const elements = renderer.detectRenderableElements(content);

			const codeBlocks = elements.filter(e => e.type === 'code_block');
			expect(codeBlocks).toHaveLength(2);
			expect(codeBlocks[0].language).toBe('javascript');
			expect(codeBlocks[1].language).toBe('python');
		});

		it('should treat plain text as text element', () => {
			const content = 'Just plain text without any special formatting';
			const elements = renderer.detectRenderableElements(content);

			expect(elements).toHaveLength(1);
			expect(elements[0].type).toBe('text');
			expect(elements[0].content).toBe(content);
		});

		it('should handle empty content', () => {
			const elements = renderer.detectRenderableElements('');

			expect(elements).toHaveLength(1);
			expect(elements[0].type).toBe('text');
			expect(elements[0].content).toBe('');
		});

		it('should set correct start and end indices for code blocks', () => {
			const content = 'Text before\n```js\ncode\n```\nText after';
			const elements = renderer.detectRenderableElements(content);

			const codeBlock = elements.find(e => e.type === 'code_block');
			expect(codeBlock).toBeDefined();
			expect(codeBlock!.startIndex).toBeGreaterThan(0);
			expect(codeBlock!.endIndex).toBeGreaterThan(codeBlock!.startIndex);
		});

		it('should handle code blocks with special characters', () => {
			const content = '```typescript\nconst str = "<tag>";\n```';
			const elements = renderer.detectRenderableElements(content);

			expect(elements[0].type).toBe('code_block');
			expect(elements[0].content).toContain('<tag>');
		});

		it('should handle multiline code blocks', () => {
			const content = '```python\ndef hello():\n    print("world")\n    return True\n```';
			const elements = renderer.detectRenderableElements(content);

			expect(elements[0].type).toBe('code_block');
			expect(elements[0].content).toContain('def hello()');
			expect(elements[0].content).toContain('print("world")');
			expect(elements[0].content).toContain('return True');
		});
	});

	describe('renderToHTML', () => {
		it('should render code block to HTML', () => {
			const elements: RenderableElement[] = [
				{
					type: 'code_block',
					content: 'const x = 1;',
					language: 'javascript',
					startIndex: 0,
					endIndex: 20
				}
			];

			const html = renderer.renderToHTML(elements);

			expect(html).toContain('<pre>');
			expect(html).toContain('<code');
			expect(html).toContain('language-javascript');
			expect(html).toContain('const x = 1;');
			expect(html).toContain('</code>');
			expect(html).toContain('</pre>');
		});

		it('should render text to HTML paragraph', () => {
			const elements: RenderableElement[] = [
				{
					type: 'text',
					content: 'Plain text content',
					startIndex: 0,
					endIndex: 18
				}
			];

			const html = renderer.renderToHTML(elements);

			expect(html).toContain('<p>');
			expect(html).toContain('Plain text content');
			expect(html).toContain('</p>');
		});

		it('should escape HTML in content', () => {
			const elements: RenderableElement[] = [
				{
					type: 'text',
					content: '<script>alert("xss")</script>',
					startIndex: 0,
					endIndex: 30
				}
			];

			const html = renderer.renderToHTML(elements);

			expect(html).not.toContain('<script>');
			expect(html).toContain('&lt;script&gt;');
			expect(html).toContain('&lt;/script&gt;');
		});

		it('should escape special HTML characters', () => {
			const elements: RenderableElement[] = [
				{
					type: 'text',
					content: 'Test & "quotes" <tags>',
					startIndex: 0,
					endIndex: 22
				}
			];

			const html = renderer.renderToHTML(elements);

			expect(html).toContain('&amp;');
			expect(html).toContain('&quot;');
			expect(html).toContain('&lt;');
			expect(html).toContain('&gt;');
		});

		it('should render multiple elements', () => {
			const elements: RenderableElement[] = [
				{
					type: 'text',
					content: 'Some text',
					startIndex: 0,
					endIndex: 9
				},
				{
					type: 'code_block',
					content: 'const x = 1;',
					language: 'javascript',
					startIndex: 10,
					endIndex: 30
				},
				{
					type: 'text',
					content: 'More text',
					startIndex: 31,
					endIndex: 40
				}
			];

			const html = renderer.renderToHTML(elements);

			expect(html).toContain('<p>Some text</p>');
			expect(html).toContain('<pre><code');
			expect(html).toContain('<p>More text</p>');
		});

		it('should handle empty elements array', () => {
			const html = renderer.renderToHTML([]);

			expect(html).toBe('');
		});

		it('should use text language for code blocks without language', () => {
			const elements: RenderableElement[] = [
				{
					type: 'code_block',
					content: 'code without language',
					startIndex: 0,
					endIndex: 21
				}
			];

			const html = renderer.renderToHTML(elements);

			expect(html).toContain('language-text');
		});
	});

	describe('extractPlainText', () => {
		it('should extract plain text from single element', () => {
			const elements: RenderableElement[] = [
				{
					type: 'text',
					content: 'Plain text',
					startIndex: 0,
					endIndex: 10
				}
			];

			const text = renderer.extractPlainText(elements);

			expect(text).toBe('Plain text');
		});

		it('should extract plain text from multiple elements', () => {
			const elements: RenderableElement[] = [
				{
					type: 'text',
					content: 'First',
					startIndex: 0,
					endIndex: 5
				},
				{
					type: 'code_block',
					content: 'code',
					language: 'js',
					startIndex: 6,
					endIndex: 10
				},
				{
					type: 'text',
					content: 'Last',
					startIndex: 11,
					endIndex: 15
				}
			];

			const text = renderer.extractPlainText(elements);

			expect(text).toBe('First\ncode\nLast');
		});

		it('should handle empty elements array', () => {
			const text = renderer.extractPlainText([]);

			expect(text).toBe('');
		});

		it('should preserve code block content', () => {
			const elements: RenderableElement[] = [
				{
					type: 'code_block',
					content: 'const x = 1;\nconst y = 2;',
					language: 'javascript',
					startIndex: 0,
					endIndex: 25
				}
			];

			const text = renderer.extractPlainText(elements);

			expect(text).toContain('const x = 1;');
			expect(text).toContain('const y = 2;');
		});
	});

	describe('analyzeContent', () => {
		it('should detect renderable content with code blocks', () => {
			const content = 'Some text\n```javascript\nconst x = 1;\n```\nMore text';
			const result = renderer.analyzeContent(content);

			expect(result.hasRenderableContent).toBe(true);
			expect(result.elements.some(e => e.type === 'code_block')).toBe(true);
			expect(result.plainTextFallback).toBeDefined();
		});

		it('should not detect renderable content in plain text', () => {
			const content = 'Just plain text without any special formatting';
			const result = renderer.analyzeContent(content);

			expect(result.hasRenderableContent).toBe(false);
			expect(result.elements).toHaveLength(1);
			expect(result.elements[0].type).toBe('text');
		});

		it('should provide plain text fallback', () => {
			const content = '```javascript\nconst x = 1;\n```';
			const result = renderer.analyzeContent(content);

			expect(result.plainTextFallback).toBeDefined();
			expect(result.plainTextFallback).toContain('const x = 1;');
		});

		it('should handle empty content', () => {
			const result = renderer.analyzeContent('');

			expect(result.hasRenderableContent).toBe(false);
			expect(result.elements).toHaveLength(1);
			expect(result.plainTextFallback).toBe('');
		});

		it('should analyze complex content with multiple elements', () => {
			const content = 'Introduction\n```python\nprint("hello")\n```\nExplanation\n```javascript\nconsole.log("world");\n```';
			const result = renderer.analyzeContent(content);

			expect(result.hasRenderableContent).toBe(true);
			expect(result.elements.filter(e => e.type === 'code_block')).toHaveLength(2);
		});

		it('should return consistent elements between detect and analyze', () => {
			const content = '```typescript\nconst x = 1;\n```';
			const detected = renderer.detectRenderableElements(content);
			const analyzed = renderer.analyzeContent(content);

			expect(analyzed.elements).toEqual(detected);
		});

		it('should include CodeBlock array in analysis result', () => {
			// Verifies integration with existing CodeBlock interface from conversation.ts
			const content = 'Example:\n```typescript\nconst x = 1;\n```\nAnother:\n```python\nprint("hello")\n```';
			const result = renderer.analyzeContent(content);

			expect(result.codeBlocks).toBeDefined();
			expect(result.codeBlocks).toHaveLength(2);
			expect(result.codeBlocks[0].code).toBe('const x = 1;');
			expect(result.codeBlocks[0].language).toBe('typescript');
			expect(result.codeBlocks[1].code).toBe('print("hello")');
			expect(result.codeBlocks[1].language).toBe('python');
		});

		it('should return empty codeBlocks array when no code blocks present', () => {
			const content = 'Just plain text without code blocks';
			const result = renderer.analyzeContent(content);

			expect(result.codeBlocks).toBeDefined();
			expect(result.codeBlocks).toHaveLength(0);
		});
	});

	describe('edge cases', () => {
		it('should handle code blocks with empty content', () => {
			const content = '```javascript\n\n```';
			const elements = renderer.detectRenderableElements(content);

			expect(elements[0].type).toBe('code_block');
			expect(elements[0].content).toBe('');
		});

		it('should handle incomplete code blocks', () => {
			const content = '```javascript\nconst x = 1;';
			const elements = renderer.detectRenderableElements(content);

			// Should treat as plain text if not properly closed
			expect(elements.some(e => e.type === 'text')).toBe(true);
		});

		it('should handle nested backticks in code blocks', () => {
			const content = '```markdown\n`inline code`\n```';
			const elements = renderer.detectRenderableElements(content);

			expect(elements[0].type).toBe('code_block');
			expect(elements[0].content).toContain('`inline code`');
		});

		it('should handle very long content', () => {
			const longCode = 'const x = 1;\n'.repeat(1000);
			const content = `\`\`\`javascript\n${longCode}\`\`\``;
			const elements = renderer.detectRenderableElements(content);

			expect(elements[0].type).toBe('code_block');
			expect(elements[0].content.length).toBeGreaterThan(10000);
		});

		it('should handle content with only whitespace', () => {
			const content = '   \n\n   \t\t   ';
			const elements = renderer.detectRenderableElements(content);

			expect(elements).toHaveLength(1);
			expect(elements[0].type).toBe('text');
		});
	});

	describe('enhanced markdown features', () => {
		describe('inline code detection', () => {
			it('should detect inline code', () => {
				const content = 'Use the `console.log()` function';
				const elements = renderer.detectRenderableElements(content);

				const inlineCode = elements.find(e => e.type === 'inline_code');
				expect(inlineCode).toBeDefined();
				expect(inlineCode!.content).toBe('console.log()');
			});

			it('should detect multiple inline code elements', () => {
				const content = 'Use `const` or `let` for variables';
				const elements = renderer.detectRenderableElements(content);

				const inlineCodes = elements.filter(e => e.type === 'inline_code');
				expect(inlineCodes).toHaveLength(2);
				expect(inlineCodes[0].content).toBe('const');
				expect(inlineCodes[1].content).toBe('let');
			});
		});

		describe('list detection', () => {
			it('should detect unordered list items', () => {
				const content = '- First item\n- Second item\n- Third item';
				const elements = renderer.detectRenderableElements(content);

				const listItems = elements.filter(e => e.type === 'list_item');
				expect(listItems).toHaveLength(3);
				expect(listItems[0].content).toBe('First item');
				expect(listItems[1].content).toBe('Second item');
			});

			it('should detect ordered list items', () => {
				const content = '1. First\n2. Second\n3. Third';
				const elements = renderer.detectRenderableElements(content);

				const listItems = elements.filter(e => e.type === 'list_item');
				expect(listItems).toHaveLength(3);
				expect(listItems[0].content).toBe('First');
			});

			it('should detect list items with asterisk', () => {
				const content = '* Item one\n* Item two';
				const elements = renderer.detectRenderableElements(content);

				const listItems = elements.filter(e => e.type === 'list_item');
				expect(listItems).toHaveLength(2);
			});
		});

		describe('emphasis detection', () => {
			it('should detect bold text', () => {
				const content = 'This is **bold** text';
				const elements = renderer.detectRenderableElements(content);

				const emphasis = elements.find(e => e.type === 'emphasis');
				expect(emphasis).toBeDefined();
				expect(emphasis!.content).toContain('**bold**');
			});

			it('should detect italic text', () => {
				const content = 'This is *italic* text';
				const elements = renderer.detectRenderableElements(content);

				const emphasis = elements.find(e => e.type === 'emphasis');
				expect(emphasis).toBeDefined();
			});
		});

		describe('link detection', () => {
			it('should detect markdown links', () => {
				const content = 'Check [this link](https://example.com)';
				const elements = renderer.detectRenderableElements(content);

				const link = elements.find(e => e.type === 'link');
				expect(link).toBeDefined();
				expect(link!.content).toContain('[this link](https://example.com)');
			});
		});

		describe('HTML rendering enhancements', () => {
			it('should render inline code with proper styling', () => {
				const elements: RenderableElement[] = [
					{
						type: 'inline_code',
						content: 'console.log()',
						startIndex: 0,
						endIndex: 10
					}
				];

				const html = renderer.renderToHTML(elements);
				expect(html).toContain('<code class="inline-code">');
				expect(html).toContain('console.log()');
			});

			it('should render list items', () => {
				const elements: RenderableElement[] = [
					{
						type: 'list_item',
						content: 'First item',
						startIndex: 0,
						endIndex: 10
					}
				];

				const html = renderer.renderToHTML(elements);
				expect(html).toContain('<li>');
				expect(html).toContain('First item');
			});

			it('should render code blocks with language header', () => {
				const elements: RenderableElement[] = [
					{
						type: 'code_block',
						content: 'const x = 1;',
						language: 'typescript',
						startIndex: 0,
						endIndex: 10
					}
				];

				const html = renderer.renderToHTML(elements);
				expect(html).toContain('code-block-container');
				expect(html).toContain('code-block-header');
				expect(html).toContain('code-block-language');
				expect(html).toContain('TypeScript');
			});

			it('should render emphasis with inline formatting', () => {
				const elements: RenderableElement[] = [
					{
						type: 'emphasis',
						content: 'This is **bold** text',
						startIndex: 0,
						endIndex: 20
					}
				];

				const html = renderer.renderToHTML(elements);
				expect(html).toContain('<strong>');
				expect(html).toContain('bold');
			});

			it('should render links', () => {
				const elements: RenderableElement[] = [
					{
						type: 'link',
						content: '[example](https://example.com)',
						startIndex: 0,
						endIndex: 30
					}
				];

				const html = renderer.renderToHTML(elements);
				expect(html).toContain('<a href=');
				expect(html).toContain('markdown-link');
			});
		});

		describe('extractCodeBlocks', () => {
			it('should extract code blocks using CodeBlock interface', () => {
				const content = '```typescript\nconst x = 1;\n```';
				const codeBlocks = renderer.extractCodeBlocks(content);

				expect(codeBlocks).toHaveLength(1);
				expect(codeBlocks[0].code).toBe('const x = 1;');
				expect(codeBlocks[0].language).toBe('typescript');
			});

			it('should extract multiple code blocks', () => {
				const content = 'Text\n```js\ncode1\n```\nMore text\n```py\ncode2\n```';
				const codeBlocks = renderer.extractCodeBlocks(content);

				expect(codeBlocks).toHaveLength(2);
				expect(codeBlocks[0].language).toBe('js');
				expect(codeBlocks[1].language).toBe('py');
			});

			it('should include markdown before block', () => {
				const content = 'Here is some code:\n```js\nconst x = 1;\n```';
				const codeBlocks = renderer.extractCodeBlocks(content);

				expect(codeBlocks[0].markdownBeforeBlock).toBe('Here is some code:');
			});

			it('should handle code blocks without language', () => {
				const content = '```\nplain code\n```';
				const codeBlocks = renderer.extractCodeBlocks(content);

				expect(codeBlocks).toHaveLength(1);
				expect(codeBlocks[0].language).toBeUndefined();
			});

			it('should return CodeBlock interface compatible structure', () => {
				// This test verifies integration with existing CodeBlock interface from conversation.ts
				// CodeBlock type: { readonly code: string; readonly language?: string; readonly resource?: URI; readonly markdownBeforeBlock?: string }
				const content = 'Context:\n```typescript\nconst x = 1;\n```';
				const codeBlocks = renderer.extractCodeBlocks(content);

				expect(codeBlocks).toHaveLength(1);

				// Verify all CodeBlock interface properties
				expect(codeBlocks[0]).toHaveProperty('code');
				expect(codeBlocks[0]).toHaveProperty('language');
				expect(codeBlocks[0]).toHaveProperty('resource');
				expect(codeBlocks[0]).toHaveProperty('markdownBeforeBlock');

				// Verify values match expected CodeBlock structure
				expect(typeof codeBlocks[0].code).toBe('string');
				expect(codeBlocks[0].language).toBe('typescript');
				expect(codeBlocks[0].resource).toBeUndefined(); // No resource in prompt sections
				expect(codeBlocks[0].markdownBeforeBlock).toBe('Context:');
			});
		});
	});
});
