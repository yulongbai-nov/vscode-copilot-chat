/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../../platform/log/common/logService';
import { Emitter, Event } from '../../../../util/vs/base/common/event';
import { IChatMLFetcher } from '../../../../platform/chat/common/chatMLFetcher';
import { Raw } from '@vscode/prompt-tsx';
import { IContentRenderer, ISectionParserService, ITokenUsageCalculator } from '../../common/services';
import { ParseResult, PromptSection, TokenizationEndpoint } from '../../common/types';
import { PromptStateManager } from '../../node/promptStateManager';

describe('PromptStateManager', () => {
	let stateManager: PromptStateManager;
	let mockParserService: ISectionParserService;
	let mockTokenCalculator: ITokenUsageCalculator;
	let mockContentRenderer: IContentRenderer;
	let mockExtensionContext: IVSCodeExtensionContext;
	let mockConfigurationService: IConfigurationService;
	let mockLogService: ILogService;
	let workspaceState: Map<string, any>;
	let configValues: Map<string, any>;
	let onLanguageModelChangeEmitter: Emitter<TokenizationEndpoint>;
	let onDidMakeChatMLRequestEmitter: Emitter<{ messages?: Raw.ChatMessage[] }>;
	let mockChatMLFetcher: IChatMLFetcher;

	const createMockSection = (id: string, tagName: string, content: string): PromptSection => ({
		id,
		tagName,
		content,
		startIndex: 0,
		endIndex: content.length,
		tokenCount: 0,
		isEditing: false,
		isCollapsed: false,
		hasRenderableElements: false
	});

	beforeEach(() => {
		// Setup workspace state storage
		workspaceState = new Map();

		// Setup configuration values
		configValues = new Map<string, any>([
			[ConfigKey.PromptSectionVisualizerEnabled.fullyQualifiedId, true],
			[ConfigKey.PromptSectionVisualizerPersistCollapseState.fullyQualifiedId, true],
			[ConfigKey.PromptSectionVisualizerAutoCollapseLargeSections.fullyQualifiedId, false],
			[ConfigKey.PromptSectionVisualizerLargeSectionTokenThreshold.fullyQualifiedId, 500]
		]);

		// Create mock extension context
		mockExtensionContext = {
			workspaceState: {
				get: vi.fn((key: string) => workspaceState.get(key)),
				update: vi.fn((key: string, value: any) => {
					workspaceState.set(key, value);
					return Promise.resolve();
				})
			}
		} as any;

		// Create mock configuration service
		const configChangeEmitter = new Emitter<any>();
		mockConfigurationService = {
			getConfig: vi.fn((key: any) => {
				return configValues.get(key.fullyQualifiedId);
			}),
			setConfig: vi.fn((key: any, value: any) => {
				configValues.set(key.fullyQualifiedId, value);
				return Promise.resolve();
			}),
			onDidChangeConfiguration: configChangeEmitter.event
		} as any;

		// Create mock parser service
		mockParserService = {
			parsePrompt: vi.fn((prompt: string): ParseResult => ({
				sections: [],
				errors: [],
				hasValidStructure: true
			})),
			validateXMLStructure: vi.fn(),
			reconstructPrompt: vi.fn()
		} as any;

		// Create mock token calculator
		onLanguageModelChangeEmitter = new Emitter<TokenizationEndpoint>();
		mockTokenCalculator = {
			calculateSectionTokens: vi.fn().mockResolvedValue(10),
			calculateSectionTokensDebounced: vi.fn().mockResolvedValue(10),
			calculateSectionTokensWithBreakdown: vi.fn().mockResolvedValue({ total: 10, content: 8, tags: 2 }),
			calculateTotalTokens: vi.fn().mockResolvedValue(30),
			calculateTotalTokensDebounced: vi.fn().mockResolvedValue(30),
			calculateTotalTokensWithBreakdown: vi.fn().mockResolvedValue({ total: 30, content: 24, tags: 6, overhead: 6 }),
			clearCache: vi.fn(),
			getCacheStats: vi.fn().mockReturnValue({ size: 0, limit: 100 }),
			getWarningLevel: vi.fn().mockReturnValue('normal'),
			getWarningThresholds: vi.fn().mockReturnValue({ warning: 500, critical: 1000 }),
			onLanguageModelChange: onLanguageModelChangeEmitter.event
		} as any;

		// Create mock chat ML fetcher
		onDidMakeChatMLRequestEmitter = new Emitter<{ messages?: Raw.ChatMessage[] }>();
		mockChatMLFetcher = {
			_serviceBrand: undefined as any,
			onDidMakeChatMLRequest: onDidMakeChatMLRequestEmitter.event as Event<{ model: string; source?: any; tokenCount?: number }>,
			fetchOne: vi.fn(),
			fetchMany: vi.fn()
		};

		// Create mock content renderer
		mockContentRenderer = {
			detectRenderableElements: vi.fn().mockReturnValue([]),
			renderToHTML: vi.fn().mockReturnValue(''),
			extractPlainText: vi.fn().mockReturnValue(''),
			analyzeContent: vi.fn().mockReturnValue({
				hasRenderableContent: false,
				elements: [],
				plainTextFallback: ''
			})
		} as any;

		// Create mock log service
		mockLogService = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn()
		} as any;

		// Create state manager instance
		stateManager = new PromptStateManager(
			mockParserService,
			mockTokenCalculator,
			mockContentRenderer,
			mockExtensionContext,
			mockConfigurationService,
			mockChatMLFetcher,
			mockLogService
		);
	});

	describe('initialization', () => {
		it('should restore enabled state from configuration', () => {
			const state = stateManager.getCurrentState();
			expect(state.isEnabled).toBe(true);
		});

		it('should use disabled state when configuration is false', () => {
			configValues.set(ConfigKey.PromptSectionVisualizerEnabled.fullyQualifiedId, false);

			const newStateManager = new PromptStateManager(
				mockParserService,
				mockTokenCalculator,
				mockContentRenderer,
				mockExtensionContext,
				mockConfigurationService,
				mockChatMLFetcher,
				mockLogService
			);

			const state = newStateManager.getCurrentState();
			expect(state.isEnabled).toBe(false);
		});
	});

	describe('collapse state persistence', () => {
		it('should persist collapse state when toggling', () => {
			const sections = [
				createMockSection('1', 'context', 'Hello'),
				createMockSection('2', 'instructions', 'World')
			];

			(mockParserService.parsePrompt as any).mockReturnValue({
				sections,
				errors: [],
				hasValidStructure: true
			});

			stateManager.updatePrompt('<context>Hello</context><instructions>World</instructions>');
			stateManager.toggleSectionCollapse('1');

			expect(mockExtensionContext.workspaceState.update).toHaveBeenCalledWith(
				'promptSectionVisualizer.collapseState',
				expect.objectContaining({ context: true })
			);
		});

		it('should restore collapse state when loading sections', () => {
			// Set up persisted collapse state
			workspaceState.set('promptSectionVisualizer.collapseState', {
				context: true,
				instructions: false
			});

			const sections = [
				createMockSection('1', 'context', 'Hello'),
				createMockSection('2', 'instructions', 'World')
			];

			(mockParserService.parsePrompt as any).mockReturnValue({
				sections,
				errors: [],
				hasValidStructure: true
			});

			stateManager.updatePrompt('<context>Hello</context><instructions>World</instructions>');

			const state = stateManager.getCurrentState();
			expect(state.sections[0].isCollapsed).toBe(true);
			expect(state.sections[1].isCollapsed).toBe(false);
		});

		it('should not persist when persistCollapseState is disabled', () => {
			configValues.set(ConfigKey.PromptSectionVisualizerPersistCollapseState.fullyQualifiedId, false);

			const sections = [createMockSection('1', 'context', 'Hello')];
			(mockParserService.parsePrompt as any).mockReturnValue({
				sections,
				errors: [],
				hasValidStructure: true
			});

			stateManager.updatePrompt('<context>Hello</context>');

			// Clear previous calls
			vi.mocked(mockExtensionContext.workspaceState.update).mockClear();

			stateManager.toggleSectionCollapse('1');

			expect(mockExtensionContext.workspaceState.update).not.toHaveBeenCalled();
		});

		it('should not restore when persistCollapseState is disabled', () => {
			configValues.set(ConfigKey.PromptSectionVisualizerPersistCollapseState.fullyQualifiedId, false);
			workspaceState.set('promptSectionVisualizer.collapseState', { context: true });

			const sections = [createMockSection('1', 'context', 'Hello')];
			(mockParserService.parsePrompt as any).mockReturnValue({
				sections,
				errors: [],
				hasValidStructure: true
			});

			stateManager.updatePrompt('<context>Hello</context>');

			const state = stateManager.getCurrentState();
			expect(state.sections[0].isCollapsed).toBe(false);
		});
	});

	describe('patch events', () => {
		it('emits sectionAdded and sectionUpdated patches when adding a section', async () => {
			const patches: any[] = [];
			stateManager.onDidApplyPatch(patch => patches.push(patch));

			stateManager.addSection('context', 'Hello world');

			expect(patches.some(patch => patch.type === 'sectionAdded')).toBe(true);

			// Allow async token recalculation to finish to capture sectionUpdated patch
			await Promise.resolve();
			expect(patches.some(patch => patch.type === 'sectionUpdated')).toBe(true);
		});

		it('emits sectionRemoved patch when removing a section', async () => {
			stateManager.addSection('context', 'Hello world');
			await Promise.resolve();

			const patches: any[] = [];
			stateManager.onDidApplyPatch(patch => patches.push(patch));

			const sectionId = stateManager.getCurrentState().sections[0]?.id ?? '';
			stateManager.removeSection(sectionId);

			expect(patches).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: 'sectionRemoved', sectionId })
				])
			);
		});

		it('emits sectionsReordered patch when order changes', () => {
			stateManager.addSection('context', 'First');
			stateManager.addSection('instructions', 'Second');

			const patches: any[] = [];
			stateManager.onDidApplyPatch(patch => patches.push(patch));

			const currentOrder = stateManager.getCurrentState().sections.map(section => section.id);
			const reordered = [...currentOrder].reverse();

			stateManager.reorderSections(reordered);

			expect(patches).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: 'sectionsReordered', order: reordered })
				])
			);
		});
	});

	describe('auto-collapse large sections', () => {
		it('should auto-collapse sections exceeding token threshold', () => {
			configValues.set(ConfigKey.PromptSectionVisualizerAutoCollapseLargeSections.fullyQualifiedId, true);
			configValues.set(ConfigKey.PromptSectionVisualizerLargeSectionTokenThreshold.fullyQualifiedId, 100);

			const sections = [
				{ ...createMockSection('1', 'context', 'Small'), tokenCount: 50 },
				{ ...createMockSection('2', 'instructions', 'Large'), tokenCount: 150 }
			];

			(mockParserService.parsePrompt as any).mockReturnValue({
				sections,
				errors: [],
				hasValidStructure: true
			});

			stateManager.updatePrompt('<context>Small</context><instructions>Large</instructions>');

			const state = stateManager.getCurrentState();
			expect(state.sections[0].isCollapsed).toBe(false);
			expect(state.sections[1].isCollapsed).toBe(true);
		});

		it('should not auto-collapse when feature is disabled', () => {
			configValues.set(ConfigKey.PromptSectionVisualizerAutoCollapseLargeSections.fullyQualifiedId, false);

			const sections = [
				{ ...createMockSection('1', 'context', 'Large'), tokenCount: 1000 }
			];

			(mockParserService.parsePrompt as any).mockReturnValue({
				sections,
				errors: [],
				hasValidStructure: true
			});

			stateManager.updatePrompt('<context>Large</context>');

			const state = stateManager.getCurrentState();
			expect(state.sections[0].isCollapsed).toBe(false);
		});

		it('should respect persisted state over auto-collapse', () => {
			configValues.set(ConfigKey.PromptSectionVisualizerAutoCollapseLargeSections.fullyQualifiedId, true);
			configValues.set(ConfigKey.PromptSectionVisualizerLargeSectionTokenThreshold.fullyQualifiedId, 100);

			// Persisted state says context should be collapsed
			workspaceState.set('promptSectionVisualizer.collapseState', { context: true });

			const sections = [
				{ ...createMockSection('1', 'context', 'Small'), tokenCount: 50 }
			];

			(mockParserService.parsePrompt as any).mockReturnValue({
				sections,
				errors: [],
				hasValidStructure: true
			});

			stateManager.updatePrompt('<context>Small</context>');

			const state = stateManager.getCurrentState();
			// Persisted state takes precedence
			expect(state.sections[0].isCollapsed).toBe(true);
		});
	});

	describe('setEnabled', () => {
		it('should update enabled state and persist to configuration', async () => {
			await stateManager.setEnabled(false);

			expect(mockConfigurationService.setConfig).toHaveBeenCalledWith(
				ConfigKey.PromptSectionVisualizerEnabled,
				false
			);

			const state = stateManager.getCurrentState();
			expect(state.isEnabled).toBe(false);
		});

		it('should fire state change event', async () => {
			const stateChangeSpy = vi.fn();
			stateManager.onDidChangeState(stateChangeSpy);

			await stateManager.setEnabled(false);

			expect(stateChangeSpy).toHaveBeenCalled();
		});
	});

	describe('isEnabled', () => {
		it('should return current enabled state', () => {
			expect(stateManager.isEnabled()).toBe(true);
		});

		it('should return false when disabled', async () => {
			await stateManager.setEnabled(false);
			expect(stateManager.isEnabled()).toBe(false);
		});
	});

	describe('section operations', () => {
		beforeEach(() => {
			const sections = [
				createMockSection('1', 'context', 'Hello'),
				createMockSection('2', 'instructions', 'World')
			];

			(mockParserService.parsePrompt as any).mockReturnValue({
				sections,
				errors: [],
				hasValidStructure: true
			});

			stateManager.updatePrompt('<context>Hello</context><instructions>World</instructions>');
		});

		it('should toggle section collapse state', () => {
			stateManager.toggleSectionCollapse('1');

			const state = stateManager.getCurrentState();
			expect(state.sections[0].isCollapsed).toBe(true);

			stateManager.toggleSectionCollapse('1');
			expect(stateManager.getCurrentState().sections[0].isCollapsed).toBe(false);
		});

		it('should update section content', () => {
			stateManager.updateSection('1', 'Updated content');

			const state = stateManager.getCurrentState();
			expect(state.sections[0].content).toBe('Updated content');
		});

		it('should add new section', () => {
			stateManager.addSection('examples', 'Example content');

			const state = stateManager.getCurrentState();
			expect(state.sections).toHaveLength(3);
			expect(state.sections[2].tagName).toBe('examples');
			expect(state.sections[2].content).toBe('Example content');
		});

		it('should remove section', () => {
			stateManager.removeSection('1');

			const state = stateManager.getCurrentState();
			expect(state.sections).toHaveLength(1);
			expect(state.sections[0].id).toBe('2');
		});

		it('should reorder sections', () => {
			stateManager.reorderSections(['2', '1']);

			const state = stateManager.getCurrentState();
			expect(state.sections[0].id).toBe('2');
			expect(state.sections[1].id).toBe('1');
		});
	});

	describe('disposal', () => {
		it('should dispose without errors', () => {
			expect(() => stateManager.dispose()).not.toThrow();
		});
	});
});
