/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { PromptSectionRenderer } from '../../node/promptSectionRenderer';
import { PromptRendererPart } from '../../common/rendering/promptSectionRenderer';
import { PromptSection, RenderOptions } from '../../common/types';

const defaultOptions: RenderOptions = {
	showActions: true,
	enableCollapse: true,
	showTokenBreakdown: true,
	mode: 'inline'
};

const createSection = (overrides: Partial<PromptSection> = {}): PromptSection => ({
	id: overrides.id ?? 'section-1',
	tagName: overrides.tagName ?? 'context',
	content: overrides.content ?? 'Sample content',
	startIndex: overrides.startIndex ?? 0,
	endIndex: overrides.endIndex ?? (overrides.content?.length ?? 14),
	tokenCount: overrides.tokenCount ?? 42,
	tokenBreakdown: overrides.tokenBreakdown ?? { content: 30, tags: 12 },
	warningLevel: overrides.warningLevel ?? 'normal',
	isEditing: overrides.isEditing ?? false,
	isCollapsed: overrides.isCollapsed ?? false,
	hasRenderableElements: overrides.hasRenderableElements ?? Boolean(overrides.renderedContent),
	renderedContent: overrides.renderedContent,
	metadata: overrides.metadata
});

const collectParts = async (iterable: AsyncIterable<PromptRendererPart>): Promise<PromptRendererPart[]> => {
	const parts: PromptRendererPart[] = [];
	for await (const part of iterable) {
		parts.push(part);
	}
	return parts;
};

describe('PromptSectionRenderer', () => {
	it('emits a header and empty state when no sections exist', async () => {
		const renderer = new PromptSectionRenderer();
		const parts = await collectParts(renderer.renderSections([], defaultOptions));

		expect(parts[0]?.type).toBe('header');
		expect(parts[1]?.type).toBe('emptyState');

		const globalButton = parts.find(part => part.type === 'commandButton' && part.target === 'global');
		expect(globalButton).toBeDefined();
	});

	it('includes token breakdown summary with overhead in header', async () => {
		const renderer = new PromptSectionRenderer();
		const sections = [
			createSection({
				tokenBreakdown: { content: 10, tags: 5 }
			}),
			createSection({
				id: 'section-2',
				tokenBreakdown: { content: 20, tags: 10 }
			})
		];

		const parts = await collectParts(renderer.renderSections(sections, defaultOptions));
		const header = parts[0] as any;

		expect(header.type).toBe('header');
		expect(header.tokenBreakdown).toEqual({ content: 30, tags: 15, overhead: 15 });
		expect(header.markdown).toContain('Overhead: `15` tokens');
	});

	it('includes section, warning, commands, and divider parts for each section', async () => {
		const renderer = new PromptSectionRenderer();
		const section = createSection({
			id: 'sec-1',
			tagName: 'instructions',
			warningLevel: 'warning',
			hasRenderableElements: true,
			renderedContent: {
				type: 'markdown',
				elements: [],
				htmlRepresentation: '<p>Sample</p>',
				plainTextFallback: 'Sample content'
			}
		});
		const parts = await collectParts(renderer.renderSections([section], defaultOptions));

		const sectionPart = parts.find(part => part.type === 'section');
		expect(sectionPart).toBeDefined();
		expect((sectionPart as any).headerMarkdown).toContain('<instructions>');

		const warningPart = parts.find(part => part.type === 'warning');
		expect(warningPart).toBeDefined();
		expect((warningPart as any).message).toContain('Warning');

		const sectionCommands = parts.filter(part => part.type === 'commandButton' && part.target === 'section');
		expect(sectionCommands.length).toBe(3);

		const divider = parts.find(part => part.type === 'divider' && part.scope === 'section');
		expect(divider).toBeDefined();
	});

	it('omits section commands when collapsed', async () => {
		const renderer = new PromptSectionRenderer();
		const section = createSection({ id: 'collapsed', isCollapsed: true });
		const parts = await collectParts(renderer.renderSections([section], defaultOptions));

		const sectionCommands = parts.filter(part => part.type === 'commandButton' && part.target === 'section');
		expect(sectionCommands.length).toBe(0);
	});

	it('emits load-more part when pagination truncates sections', async () => {
		const renderer = new PromptSectionRenderer();
		const sections = [createSection({ id: 's1' }), createSection({ id: 's2' })];
		const options: RenderOptions = { ...defaultOptions, maxSections: 1 };
		const parts = await collectParts(renderer.renderSections(sections, options));

		const loadMore = parts.find(part => part.type === 'loadMore');
		expect(loadMore).toBeDefined();
		expect((loadMore as any).remainingCount).toBe(1);
	});

	it('emits progress parts for large prompts', async () => {
		const renderer = new PromptSectionRenderer();
		const sections = Array.from({ length: 12 }, (_, i) => createSection({ id: `section-${i}` }));
		const parts = await collectParts(renderer.renderSections(sections, defaultOptions));

		const progressParts = parts.filter(part => part.type === 'progress');
		expect(progressParts.length).toBeGreaterThanOrEqual(2);
	});

	it('omits token breakdown per section when disabled', async () => {
		const renderer = new PromptSectionRenderer();
		const section = createSection();
		const options: RenderOptions = { ...defaultOptions, showTokenBreakdown: false };
		const parts = await collectParts(renderer.renderSections([section], options));

		const sectionPart = parts.find(part => part.type === 'section');
		expect(sectionPart).toBeDefined();
		expect((sectionPart as any).tokenBreakdown).toBeUndefined();
	});
});
