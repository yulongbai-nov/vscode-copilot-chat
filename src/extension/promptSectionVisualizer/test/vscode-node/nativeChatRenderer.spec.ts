/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { IPromptSectionRenderer, PromptRendererCommandButtonPart, PromptRendererHeaderPart, PromptRendererLoadMorePart, PromptRendererPart, PromptRendererProgressPart, PromptRendererSectionPart, PromptRendererWarningPart } from '../../common/rendering/promptSectionRenderer';
import { PromptSection, RenderOptions } from '../../common/types';
import { NativeChatRenderer } from '../../vscode-node/nativeChatRenderer';

class MockChatResponseStream {
	public markdownParts: string[] = [];
	public warningParts: string[] = [];
	public buttonParts: Array<{ title: string; command: string; arguments?: unknown[] }> = [];
	public progressParts: string[] = [];

	markdown(value: string | vscode.MarkdownString): void {
		this.markdownParts.push(typeof value === 'string' ? value : value.value);
	}

	warning(value: string | vscode.MarkdownString): void {
		this.warningParts.push(typeof value === 'string' ? value : value.value);
	}

	button(part: vscode.ChatResponseCommandButtonPart | vscode.Command): this {
		const { title, command, arguments: args } = 'value' in part ? part.value : part;
		this.buttonParts.push({ title: title ?? '', command, arguments: args });
		return this;
	}

	progress(value: string): void {
		this.progressParts.push(value);
	}

	// Unused members for these tests
	reference(): void { }
	push(): void { }
	anchor(): void { }
	filetree(): void { }
	thinkingProgress(): this { return this; }
	textEdit(): this { return this; }
	notebookEdit(): this { return this; }
	externalEdit(): this { return this; }
	confirmation(): this { return this; }
	detectedParticipant(): void { }
	codeblockUri(): void { }
}

class StubSectionRenderer implements IPromptSectionRenderer {
	public readonly _serviceBrand: undefined;

	constructor(private readonly parts: PromptRendererPart[], private readonly throwOnRender = false) { }

	renderSections(_sections: PromptSection[], _options: RenderOptions): AsyncIterable<PromptRendererPart> {
		const parts = this.parts;
		const throwOnRender = this.throwOnRender;
		return (async function* () {
			if (throwOnRender) {
				throw new Error('Renderer failure');
			}
			for (const part of parts) {
				yield part;
			}
		})();
	}
}

describe('NativeChatRenderer', () => {
	let stream: MockChatResponseStream;

	beforeEach(() => {
		stream = new MockChatResponseStream();
	});

	const defaultOptions: RenderOptions = {
		showActions: true,
		enableCollapse: true,
		showTokenBreakdown: true,
		mode: 'inline'
	};

	const headerPart: PromptRendererHeaderPart = {
		type: 'header',
		title: 'Prompt Section Visualizer',
		sectionCount: 1,
		totalTokens: 42,
		markdown: '## Header\n\n**Total Tokens:** `42`\n\n- Content: `30` tokens\n- Tags: `12` tokens\n- Overhead: `12` tokens\n\n',
		tokenBreakdown: { content: 30, tags: 12, overhead: 12 }
	};

	const sectionPart: PromptRendererSectionPart = {
		type: 'section',
		id: 'sec-1',
		index: 0,
		tagName: 'context',
		headerMarkdown: '### Section Header\n\n',
		isCollapsed: false,
		tokenCount: 42,
		tokenBreakdown: { content: 30, tags: 12 },
		warningLevel: 'warning',
		hasRenderableElements: false,
		contentText: 'Body',
		content: 'Body'
	};

	const warningPart: PromptRendererWarningPart = {
		type: 'warning',
		sectionId: 'sec-1',
		level: 'warning',
		message: 'Warning message',
		tokenBreakdown: { content: 30, tags: 12 }
	};

	const sectionCommand: PromptRendererCommandButtonPart = {
		type: 'commandButton',
		target: 'section',
		title: 'Edit',
		command: 'github.copilot.promptSectionVisualizer.editSection',
		arguments: ['sec-1'],
		sectionId: 'sec-1'
	};

	const globalCommand: PromptRendererCommandButtonPart = {
		type: 'commandButton',
		target: 'global',
		title: 'Add Section',
		command: 'github.copilot.promptSectionVisualizer.addSection'
	};

	const loadMorePart: PromptRendererLoadMorePart = {
		type: 'loadMore',
		remainingCount: 2,
		buttonTitle: 'Load 2 more sections',
		markdown: '**2 more sections...**',
		command: 'github.copilot.promptSectionVisualizer.loadMore'
	};

	const progressPart: PromptRendererProgressPart = {
		type: 'progress',
		message: 'Rendering...'
	};

	it('maps renderer parts to chat response calls', async () => {
		const parts: PromptRendererPart[] = [
			headerPart,
			sectionPart,
			warningPart,
			sectionCommand,
			{ type: 'divider', scope: 'section', sectionId: 'sec-1' },
			loadMorePart,
			progressPart,
			globalCommand
		];
		const renderer = new NativeChatRenderer(new StubSectionRenderer(parts));

		await renderer.renderSections([], stream as unknown as vscode.ChatResponseStream, defaultOptions);

		expect(stream.markdownParts[0]).toContain('## Header');
		expect(stream.markdownParts).toContain('### Section Header\n\n');
		expect(stream.warningParts).toContain('Warning message');
		expect(stream.buttonParts.find(btn => btn.title === 'Edit')).toBeDefined();
		expect(stream.buttonParts.find(btn => btn.title === 'Load 2 more sections')).toBeDefined();
		expect(stream.progressParts).toContain('Rendering...');
	});

	it('renders token breakdown including overhead in header', async () => {
		const parts: PromptRendererPart[] = [headerPart];
		const renderer = new NativeChatRenderer(new StubSectionRenderer(parts));

		await renderer.renderSections([], stream as unknown as vscode.ChatResponseStream, defaultOptions);

		expect(stream.progressParts.some(p => p.includes('Content: 30 tokens'))).toBe(true);
		expect(stream.progressParts.some(p => p.includes('Tags: 12 tokens'))).toBe(true);
		expect(stream.progressParts.some(p => p.includes('Overhead: 12 tokens'))).toBe(true);
		expect(stream.markdownParts.some(p => p.includes('Overhead: `12` tokens'))).toBe(true);
	});

	it('renders action heading once for multiple global commands', async () => {
		const parts: PromptRendererPart[] = [globalCommand, { ...globalCommand, title: 'Another' }];
		const renderer = new NativeChatRenderer(new StubSectionRenderer(parts));

		await renderer.renderSections([], stream as unknown as vscode.ChatResponseStream, defaultOptions);

		const actionHeadingCount = stream.markdownParts.filter(part => part.includes('### Actions')).length;
		expect(actionHeadingCount).toBe(1);
	});

	it('propagates renderer errors to the stream', async () => {
		const renderer = new NativeChatRenderer(new StubSectionRenderer([], true));

		await expect(renderer.renderSections([], stream as unknown as vscode.ChatResponseStream, defaultOptions)).rejects.toThrow('Renderer failure');
		expect(stream.markdownParts.some(part => part.includes('Error rendering sections'))).toBe(true);
	});
});
