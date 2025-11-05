/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CodeBlock } from '../../prompt/common/conversation';
import { IContentRenderer } from '../common/services';
import { ContentDetectionResult, RenderableElement } from '../common/types';

/**
 * Re-export PromptReference for use in other parts of the visualizer.
 * This follows the pattern from conversation.ts which re-exports from @vscode/prompt-tsx.
 *
 * PromptReference can be used to reference specific locations in code or variables
 * in prompt contexts. While not currently used in the visualizer's core rendering,
 * it's available for future enhancements like:
 * - Linking sections to specific code locations
 * - Variable reference tracking within sections
 * - Integration with chat variable system
 */
export { PromptReference } from '../../prompt/common/conversation';

/**
 * Service implementation for rendering rich content
 *
 * Integration with existing codebase patterns:
 * - Uses CodeBlock interface from conversation.ts for code block extraction
 * - Follows PromptReference patterns from @vscode/prompt-tsx (re-exported from conversation.ts)
 * - Leverages existing markdown parsing patterns for content detection
 *
 * This service provides:
 * - Code block extraction compatible with existing CodeBlock interface
 * - Rich content detection (code blocks, lists, emphasis, links)
 * - HTML rendering for view mode with syntax highlighting
 * - Plain text extraction for edit mode
 */
export class ContentRenderer implements IContentRenderer {
	declare readonly _serviceBrand: undefined;

	/**
	 * Extract code blocks using the existing CodeBlock interface pattern
	 */
	extractCodeBlocks(content: string): CodeBlock[] {
		const codeBlocks: CodeBlock[] = [];
		const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
		let match;
		let lastIndex = 0;

		while ((match = codeBlockRegex.exec(content)) !== null) {
			const [fullMatch, language, code] = match;

			// Extract markdown before this code block
			const markdownBeforeBlock = lastIndex < match.index
				? content.substring(lastIndex, match.index).trim()
				: undefined;

			codeBlocks.push({
				code: code.trim(),
				language: language || undefined,
				resource: undefined, // No resource context in prompt sections
				markdownBeforeBlock: markdownBeforeBlock || undefined
			});

			lastIndex = match.index + fullMatch.length;
		}

		return codeBlocks;
	}

	/**
	 * Detect renderable elements in content with enhanced markdown support
	 */
	detectRenderableElements(content: string): RenderableElement[] {
		const elements: RenderableElement[] = [];
		let currentIndex = 0;

		// Extract code blocks first
		const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
		const codeBlockMatches: Array<{ match: RegExpExecArray; fullMatch: string; language: string; code: string }> = [];

		let match;
		while ((match = codeBlockRegex.exec(content)) !== null) {
			const [fullMatch, language, code] = match;
			codeBlockMatches.push({ match, fullMatch, language: language || 'text', code });
		}

		// Process content between code blocks
		codeBlockMatches.forEach((codeBlock) => {
			const matchStart = codeBlock.match.index;

			// Process text before this code block
			if (currentIndex < matchStart) {
				const textContent = content.substring(currentIndex, matchStart);
				this._parseInlineElements(textContent, currentIndex, elements);
			}

			// Add the code block
			elements.push({
				type: 'code_block',
				content: codeBlock.code.trim(),
				language: codeBlock.language,
				startIndex: matchStart,
				endIndex: matchStart + codeBlock.fullMatch.length
			});

			currentIndex = matchStart + codeBlock.fullMatch.length;
		});

		// Process remaining text after last code block
		if (currentIndex < content.length) {
			const textContent = content.substring(currentIndex);
			this._parseInlineElements(textContent, currentIndex, elements);
		}

		// If no elements found, treat entire content as text
		if (elements.length === 0) {
			elements.push({
				type: 'text',
				content: content,
				startIndex: 0,
				endIndex: content.length
			});
		}

		return elements;
	}

	/**
	 * Parse inline markdown elements (emphasis, inline code, links, lists)
	 */
	private _parseInlineElements(text: string, baseIndex: number, elements: RenderableElement[]): void {
		if (!text.trim()) {
			return;
		}

		const lines = text.split('\n');
		let currentLineIndex = 0;

		for (const line of lines) {
			const lineStart = baseIndex + currentLineIndex;
			const trimmedLine = line.trim();

			// Detect list items
			if (/^[-*+]\s/.test(trimmedLine) || /^\d+\.\s/.test(trimmedLine)) {
				const listContent = trimmedLine.replace(/^[-*+]\s/, '').replace(/^\d+\.\s/, '');
				elements.push({
					type: 'list_item',
					content: listContent,
					startIndex: lineStart,
					endIndex: lineStart + line.length
				});
			}
			// Detect inline code
			else if (trimmedLine.includes('`')) {
				this._parseLineWithInlineCode(line, lineStart, elements);
			}
			// Detect emphasis (bold/italic)
			else if (/\*\*.*?\*\*|\*.*?\*|__.*?__|_.*?_/.test(trimmedLine)) {
				elements.push({
					type: 'emphasis',
					content: line,
					startIndex: lineStart,
					endIndex: lineStart + line.length
				});
			}
			// Detect links
			else if (/\[.*?\]\(.*?\)/.test(trimmedLine)) {
				elements.push({
					type: 'link',
					content: line,
					startIndex: lineStart,
					endIndex: lineStart + line.length
				});
			}
			// Plain text
			else if (trimmedLine) {
				elements.push({
					type: 'text',
					content: line,
					startIndex: lineStart,
					endIndex: lineStart + line.length
				});
			}

			currentLineIndex += line.length + 1; // +1 for newline
		}
	}

	/**
	 * Parse a line containing inline code elements
	 */
	private _parseLineWithInlineCode(line: string, lineStart: number, elements: RenderableElement[]): void {
		const inlineCodeRegex = /`([^`]+)`/g;
		let lastIndex = 0;
		let match;

		while ((match = inlineCodeRegex.exec(line)) !== null) {
			// Add text before inline code
			if (lastIndex < match.index) {
				const textBefore = line.substring(lastIndex, match.index);
				if (textBefore.trim()) {
					elements.push({
						type: 'text',
						content: textBefore,
						startIndex: lineStart + lastIndex,
						endIndex: lineStart + match.index
					});
				}
			}

			// Add inline code
			elements.push({
				type: 'inline_code',
				content: match[1],
				startIndex: lineStart + match.index,
				endIndex: lineStart + match.index + match[0].length
			});

			lastIndex = match.index + match[0].length;
		}

		// Add remaining text
		if (lastIndex < line.length) {
			const textAfter = line.substring(lastIndex);
			if (textAfter.trim()) {
				elements.push({
					type: 'text',
					content: textAfter,
					startIndex: lineStart + lastIndex,
					endIndex: lineStart + line.length
				});
			}
		}
	}

	/**
	 * Render elements to HTML with enhanced syntax highlighting and formatting
	 */
	renderToHTML(elements: RenderableElement[]): string {
		return elements.map(element => {
			switch (element.type) {
				case 'code_block':
					return this._renderCodeBlock(element);
				case 'inline_code':
					return `<code class="inline-code">${this._escapeHtml(element.content)}</code>`;
				case 'list_item':
					return `<li>${this._renderInlineFormatting(element.content)}</li>`;
				case 'emphasis':
					return `<p>${this._renderInlineFormatting(element.content)}</p>`;
				case 'link':
					return `<p>${this._renderLinks(element.content)}</p>`;
				case 'text':
				default:
					return `<p>${this._escapeHtml(element.content)}</p>`;
			}
		}).join('\n');
	}

	/**
	 * Render a code block with language header and syntax highlighting support
	 */
	private _renderCodeBlock(element: RenderableElement): string {
		const language = element.language || 'text';
		const languageLabel = this._getLanguageLabel(language);

		return `
			<div class="code-block-container" data-language="${language}">
				<div class="code-block-header">
					<span class="code-block-language">${languageLabel}</span>
				</div>
				<pre><code class="language-${language}" data-language="${language}">${this._escapeHtml(element.content)}</code></pre>
			</div>
		`.trim();
	}

	/**
	 * Get a friendly label for a language identifier
	 */
	private _getLanguageLabel(language: string): string {
		const languageLabels: Record<string, string> = {
			'ts': 'TypeScript',
			'typescript': 'TypeScript',
			'js': 'JavaScript',
			'javascript': 'JavaScript',
			'py': 'Python',
			'python': 'Python',
			'java': 'Java',
			'cpp': 'C++',
			'c': 'C',
			'cs': 'C#',
			'csharp': 'C#',
			'go': 'Go',
			'rust': 'Rust',
			'rb': 'Ruby',
			'ruby': 'Ruby',
			'php': 'PHP',
			'swift': 'Swift',
			'kotlin': 'Kotlin',
			'sql': 'SQL',
			'html': 'HTML',
			'css': 'CSS',
			'json': 'JSON',
			'xml': 'XML',
			'yaml': 'YAML',
			'yml': 'YAML',
			'md': 'Markdown',
			'markdown': 'Markdown',
			'sh': 'Shell',
			'bash': 'Bash',
			'powershell': 'PowerShell',
			'text': 'Plain Text'
		};

		return languageLabels[language.toLowerCase()] || language.toUpperCase();
	}

	/**
	 * Render inline formatting (bold, italic)
	 */
	private _renderInlineFormatting(text: string): string {
		let result = this._escapeHtml(text);

		// Bold: **text** or __text__
		result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
		result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');

		// Italic: *text* or _text_
		result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
		result = result.replace(/_(.+?)_/g, '<em>$1</em>');

		// Inline code: `code`
		result = result.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

		return result;
	}

	/**
	 * Render markdown links
	 */
	private _renderLinks(text: string): string {
		const escaped = this._escapeHtml(text);
		// Match [text](url) pattern
		return escaped.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="markdown-link">$1</a>');
	}

	/**
	 * Extract plain text from elements
	 */
	extractPlainText(elements: RenderableElement[]): string {
		return elements.map(element => element.content).join('\n');
	}

	/**
	 * Detect content and return analysis with CodeBlock integration
	 */
	analyzeContent(content: string): ContentDetectionResult {
		const elements = this.detectRenderableElements(content);
		const hasRenderableContent = elements.some(e => e.type !== 'text');
		const codeBlocks = this.extractCodeBlocks(content);

		return {
			hasRenderableContent,
			elements,
			codeBlocks,
			plainTextFallback: this.extractPlainText(elements)
		};
	}

	private _escapeHtml(text: string): string {
		// Simple HTML escaping for server-side rendering
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}
}

