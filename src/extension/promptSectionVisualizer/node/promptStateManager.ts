/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { TokenizerType } from '../../../util/common/tokenizer';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IContentRenderer, IPromptStateManager, ISectionParserService, ITokenUsageCalculator } from '../common/services';
import { PromptSection, PromptStatePatch, TokenizationEndpoint, VisualizerState } from '../common/types';
import { ErrorHandler } from './errorHandler';
import { VisualizerTelemetryService } from './telemetryService';

// Storage keys for workspace state
const COLLAPSE_STATE_KEY = 'promptSectionVisualizer.collapseState';

/**
 * Stored collapse state for sections
 */
interface StoredCollapseState {
	[sectionId: string]: boolean;
}

/**
 * Service implementation for managing prompt state
 */
export class PromptStateManager extends Disposable implements IPromptStateManager {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<VisualizerState>();
	public readonly onDidChangeState: Event<VisualizerState> = this._onDidChangeState.event;
	private readonly _onDidApplyPatch = new Emitter<PromptStatePatch>();
	public readonly onDidApplyPatch: Event<PromptStatePatch> = this._onDidApplyPatch.event;

	private _state: VisualizerState = {
		sections: [],
		totalTokens: 0,
		isEnabled: true,
		currentLanguageModel: 'gpt-4',
		uiTheme: 'dark'
	};

	private readonly _errorHandler: ErrorHandler;
	private readonly _telemetryService?: VisualizerTelemetryService;

	constructor(
		@ISectionParserService private readonly _parserService: ISectionParserService,
		@ITokenUsageCalculator private readonly _tokenCalculator: ITokenUsageCalculator,
		@IContentRenderer private readonly _contentRenderer: IContentRenderer,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService logService: ILogService,
		@ITelemetryService telemetryService?: ITelemetryService
	) {
		super();

		this._register(this._onDidChangeState);
		this._register(this._onDidApplyPatch);
		this._errorHandler = new ErrorHandler(logService, telemetryService);
		this._register(this._errorHandler);

		if (telemetryService) {
			this._telemetryService = new VisualizerTelemetryService(telemetryService);
			this._register(this._telemetryService);
		}

		// Listen to token calculator changes
		this._register(this._tokenCalculator.onLanguageModelChange(endpoint => {
			this._recalculateTokens(endpoint);
		}));

		// Listen to configuration changes
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ConfigKey.PromptSectionVisualizerEnabled.fullyQualifiedId)) {
				const enabled = this._configurationService.getConfig(ConfigKey.PromptSectionVisualizerEnabled);
				if (this._state.isEnabled !== enabled) {
					this._state.isEnabled = enabled;

					if (enabled) {
						this._telemetryService?.trackVisualizerEnabled();
					} else {
						this._telemetryService?.trackVisualizerDisabled();
					}
					this._telemetryService?.trackVisualizerToggled(enabled);

					this._fireStateChange();
				}
			}
		}));

		// Restore persisted state
		this._restorePersistedState();
	}

	/**
	 * Get current state
	 */
	getCurrentState(): VisualizerState {
		return { ...this._state };
	}

	/**
	 * Update a section's content
	 */
	updateSection(sectionId: string, content: string): void {
		try {
			const sectionIndex = this._state.sections.findIndex(s => s.id === sectionId);
			if (sectionIndex >= 0) {
				const section = { ...this._state.sections[sectionIndex] };
				section.content = content;

				// Track section edit
				this._telemetryService?.trackSectionEdited(sectionId, content.length);

				// Analyze content for renderability
				try {
					const analysis = this._contentRenderer.analyzeContent(content);
					section.hasRenderableElements = analysis.hasRenderableContent;
					section.renderedContent = analysis.hasRenderableContent ? {
						type: 'mixed',
						elements: analysis.elements,
						htmlRepresentation: this._contentRenderer.renderToHTML(analysis.elements),
						plainTextFallback: analysis.plainTextFallback
					} : undefined;
				} catch (error) {
					this._errorHandler.handleRenderingError(error as Error, sectionId, content);
					section.hasRenderableElements = false;
					section.renderedContent = undefined;
				}

				this._state.sections[sectionIndex] = section;
				this._emitPatch({ type: 'sectionUpdated', section: this._cloneSection(section) });
				this._recalculateTokensForSection(section);
				this._fireStateChange();
			}
		} catch (error) {
			this._errorHandler.handleStateSyncError(error as Error, 'updateSection');
		}
	}

	/**
	 * Reorder sections
	 */
	reorderSections(newOrder: string[]): void {
		const reorderedSections: PromptSection[] = [];

		for (const sectionId of newOrder) {
			const section = this._state.sections.find(s => s.id === sectionId);
			if (section) {
				reorderedSections.push(section);
			}
		}

		// Track reorder event
		this._telemetryService?.trackSectionReordered(reorderedSections.length);

		this._state.sections = reorderedSections;
		this._emitPatch({ type: 'sectionsReordered', order: reorderedSections.map(section => section.id) });
		this._fireStateChange();
	}

	/**
	 * Add a new section
	 */
	addSection(tagName: string, content: string, position?: number): void {
		const newSection: PromptSection = {
			id: `section-${Date.now()}`,
			tagName,
			content,
			startIndex: 0,
			endIndex: content.length,
			tokenCount: 0,
			isEditing: false,
			isCollapsed: false,
			hasRenderableElements: false
		};

		// Analyze content
		const analysis = this._contentRenderer.analyzeContent(content);
		newSection.hasRenderableElements = analysis.hasRenderableContent;
		newSection.renderedContent = analysis.hasRenderableContent ? {
			type: 'mixed',
			elements: analysis.elements,
			htmlRepresentation: this._contentRenderer.renderToHTML(analysis.elements),
			plainTextFallback: analysis.plainTextFallback
		} : undefined;

		let insertIndex: number;
		if (position !== undefined && position >= 0 && position < this._state.sections.length) {
			this._state.sections.splice(position, 0, newSection);
			insertIndex = position;
		} else {
			this._state.sections.push(newSection);
			insertIndex = this._state.sections.length - 1;
		}

		// Track section addition
		this._telemetryService?.trackSectionAdded(tagName);

		this._recalculateTokensForSection(newSection);
		this._emitPatch({ type: 'sectionAdded', section: this._cloneSection(newSection), index: insertIndex });
		this._fireStateChange();
	}

	/**
	 * Remove a section
	 */
	removeSection(sectionId: string): void {
		const index = this._state.sections.findIndex(s => s.id === sectionId);
		if (index >= 0) {
			const section = this._state.sections[index];
			this._telemetryService?.trackSectionDeleted(section.tagName);
			this._state.sections.splice(index, 1);
			this._recalculateAllTokens();
			this._emitPatch({ type: 'sectionRemoved', sectionId });
			this._fireStateChange();
		}
	}

	/**
	 * Toggle section collapse state
	 */
	toggleSectionCollapse(sectionId: string): void {
		const section = this._state.sections.find(s => s.id === sectionId);
		if (section) {
			section.isCollapsed = !section.isCollapsed;

			// Track collapse/expand event
			if (section.isCollapsed) {
				this._telemetryService?.trackSectionCollapsed(section.tagName, section.tokenCount);
			} else {
				this._telemetryService?.trackSectionExpanded(section.tagName, section.tokenCount);
			}

			this._persistCollapseState();
			this._emitPatch({ type: 'sectionCollapseToggled', sectionId, isCollapsed: section.isCollapsed });
			this._fireStateChange();
		}
	}

	/**
	 * Switch section mode between view and edit
	 */
	switchSectionMode(sectionId: string, mode: 'view' | 'edit'): void {
		const section = this._state.sections.find(s => s.id === sectionId);
		if (section) {
			section.isEditing = mode === 'edit';
			this._emitPatch({ type: 'sectionModeChanged', sectionId, mode });
			this._fireStateChange();
		}
	}

	/**
	 * Update the entire prompt
	 */
	async updatePrompt(prompt: string): Promise<void> {
		const startTime = Date.now();
		try {
			const parseResult = this._parserService.parsePrompt(prompt);

			// Track parsing metrics
			const parseDuration = Date.now() - startTime;
			this._telemetryService?.trackParsePerformance(prompt.length, parseResult.sections.length, parseDuration);
			this._telemetryService?.trackSectionParsed(parseResult.sections.length, parseResult.errors.length > 0, parseResult.errors.length);

			// Handle parser errors
			if (parseResult.errors.length > 0) {
				for (const error of parseResult.errors) {
					this._errorHandler.handleParserError(error, prompt);
				}
			}

			// Analyze each section for rich content
			const renderStartTime = Date.now();
			let hasRichContent = false;
			for (const section of parseResult.sections) {
				try {
					const analysis = this._contentRenderer.analyzeContent(section.content);
					section.hasRenderableElements = analysis.hasRenderableContent;
					hasRichContent = hasRichContent || analysis.hasRenderableContent;
					section.renderedContent = analysis.hasRenderableContent ? {
						type: 'mixed',
						elements: analysis.elements,
						htmlRepresentation: this._contentRenderer.renderToHTML(analysis.elements),
						plainTextFallback: analysis.plainTextFallback
					} : undefined;
				} catch (error) {
					this._errorHandler.handleRenderingError(error as Error, section.id, section.content);
					section.hasRenderableElements = false;
					section.renderedContent = undefined;
				}
			}

			// Track rendering performance
			const renderDuration = Date.now() - renderStartTime;
			this._telemetryService?.trackRenderPerformance(parseResult.sections.length, hasRichContent, renderDuration);

			this._state.sections = parseResult.sections;

			// Restore collapse state for the new sections
			this._restoreCollapseState();

			await this._recalculateAllTokens();
			this._emitPatch({
				type: 'stateReset',
				sections: this._state.sections.map(section => this._cloneSection(section))
			});
			this._fireStateChange();
		} catch (error) {
			this._errorHandler.handleStateSyncError(error as Error, 'updatePrompt');
		}
	}

	private async _recalculateTokensForSection(section: PromptSection, retryCount: number = 0): Promise<void> {
		try {
			const endpoint: TokenizationEndpoint = { tokenizer: TokenizerType.CL100K }; // Default tokenizer
			// Use debounced calculation for real-time updates
			const breakdown = await this._tokenCalculator.calculateSectionTokensWithBreakdown(section, endpoint);
			section.tokenCount = breakdown.total;
			section.tokenBreakdown = {
				content: breakdown.content,
				tags: breakdown.tags
			};
			section.warningLevel = this._tokenCalculator.getWarningLevel(breakdown.total);
			this._recalculateTotal();
		} catch (error) {
			const recovery = this._errorHandler.handleTokenizationError(error as Error, section.id, retryCount);
			if (recovery.fallbackData?.shouldRetry && retryCount < 3) {
				// Retry with exponential backoff
				setTimeout(() => {
					this._recalculateTokensForSection(section, retryCount + 1);
				}, Math.pow(2, retryCount) * 100);
			} else {
				// Fallback to character-based estimation
				section.tokenCount = Math.ceil(section.content.length / 4);
				section.warningLevel = this._tokenCalculator.getWarningLevel(section.tokenCount);
				this._recalculateTotal();
			}
		}
		this._emitPatch({ type: 'sectionUpdated', section: this._cloneSection(section) });
		this._fireStateChange();
	}

	private async _recalculateAllTokens(): Promise<void> {
		const startTime = Date.now();
		const endpoint: TokenizationEndpoint = { tokenizer: TokenizerType.CL100K }; // Default tokenizer

		for (const section of this._state.sections) {
			try {
				const breakdown = await this._tokenCalculator.calculateSectionTokensWithBreakdown(section, endpoint);
				section.tokenCount = breakdown.total;
				section.tokenBreakdown = {
					content: breakdown.content,
					tags: breakdown.tags
				};
				section.warningLevel = this._tokenCalculator.getWarningLevel(breakdown.total);
			} catch (error) {
				this._errorHandler.handleTokenizationError(error as Error, section.id);
				section.tokenCount = Math.ceil(section.content.length / 4);
				section.warningLevel = this._tokenCalculator.getWarningLevel(section.tokenCount);
			}
		}

		this._recalculateTotal();

		// Track token calculation performance
		const duration = Date.now() - startTime;
		this._telemetryService?.trackTokenCalculationSuccess(this._state.sections.length, this._state.totalTokens, duration);
	}

	private async _recalculateTokens(endpoint: TokenizationEndpoint): Promise<void> {
		try {
			// Use debounced calculation for real-time updates when language model changes
			this._state.totalTokens = await this._tokenCalculator.calculateTotalTokensDebounced(this._state.sections, endpoint);
			this._fireStateChange();
		} catch (error) {
			// Fallback calculation
			this._recalculateTotal();
		}
	}

	private _recalculateTotal(): void {
		this._state.totalTokens = this._state.sections.reduce((total, section) => total + section.tokenCount, 0);

		// Calculate total breakdown
		let totalContent = 0;
		let totalTags = 0;
		for (const section of this._state.sections) {
			if (section.tokenBreakdown) {
				totalContent += section.tokenBreakdown.content;
				totalTags += section.tokenBreakdown.tags;
			}
		}

		this._state.tokenBreakdown = {
			content: totalContent,
			tags: totalTags,
			overhead: totalTags
		};
	}

	private _fireStateChange(): void {
		this._onDidChangeState.fire({ ...this._state });
	}

	private _emitPatch(patch: PromptStatePatch): void {
		this._onDidApplyPatch.fire(patch);
	}

	private _cloneSection(section: PromptSection): PromptSection {
		return {
			...section,
			tokenBreakdown: section.tokenBreakdown ? { ...section.tokenBreakdown } : undefined,
			renderedContent: section.renderedContent
				? {
					...section.renderedContent,
					elements: Array.isArray(section.renderedContent.elements)
						? section.renderedContent.elements.map(element => ({ ...element }))
						: []
				}
				: undefined,
			metadata: section.metadata
				? {
					...section.metadata,
					createdAt: section.metadata.createdAt ? new Date(section.metadata.createdAt) : undefined,
					lastModified: section.metadata.lastModified ? new Date(section.metadata.lastModified) : undefined,
					customAttributes: { ...section.metadata.customAttributes },
					validationRules: section.metadata.validationRules
						? section.metadata.validationRules.map(rule => ({ ...rule }))
						: undefined
				}
				: undefined
		};
	}

	/**
	 * Restore persisted state from workspace storage and configuration
	 */
	private _restorePersistedState(): void {
		// Restore visualizer enabled state from configuration
		const isEnabled = this._configurationService.getConfig(ConfigKey.PromptSectionVisualizerEnabled);
		this._state.isEnabled = isEnabled;

		// Collapse states will be restored when sections are loaded
		// This happens in updatePrompt() when sections are created
	}

	/**
	 * Persist collapse state for all sections
	 */
	private _persistCollapseState(): void {
		// Check if persistence is enabled in configuration
		const persistEnabled = this._configurationService.getConfig(ConfigKey.PromptSectionVisualizerPersistCollapseState);
		if (!persistEnabled) {
			return;
		}

		const collapseState: StoredCollapseState = {};
		for (const section of this._state.sections) {
			if (section.isCollapsed) {
				// Only store collapsed sections to keep storage minimal
				collapseState[section.tagName] = true;
			}
		}
		this._extensionContext.workspaceState.update(COLLAPSE_STATE_KEY, collapseState);
	}

	/**
	 * Restore collapse state for sections based on their tag names
	 */
	private _restoreCollapseState(): void {
		// Check if persistence is enabled in configuration
		const persistEnabled = this._configurationService.getConfig(ConfigKey.PromptSectionVisualizerPersistCollapseState);
		if (!persistEnabled) {
			return;
		}

		const collapseState = this._extensionContext.workspaceState.get<StoredCollapseState>(COLLAPSE_STATE_KEY);
		if (collapseState) {
			for (const section of this._state.sections) {
				// Restore collapse state based on tag name
				// This allows state to persist even when section IDs change
				if (collapseState[section.tagName]) {
					section.isCollapsed = true;
				}
			}
		}

		// Auto-collapse large sections if enabled
		const autoCollapse = this._configurationService.getConfig(ConfigKey.PromptSectionVisualizerAutoCollapseLargeSections);
		if (autoCollapse) {
			const threshold = this._configurationService.getConfig(ConfigKey.PromptSectionVisualizerLargeSectionTokenThreshold);
			for (const section of this._state.sections) {
				if (section.tokenCount > threshold) {
					section.isCollapsed = true;
				}
			}
		}
	}

	/**
	 * Set visualizer enabled state and persist it to configuration
	 */
	async setEnabled(enabled: boolean): Promise<void> {
		this._state.isEnabled = enabled;

		// Track enabled/disabled event
		if (enabled) {
			this._telemetryService?.trackVisualizerEnabled();
		} else {
			this._telemetryService?.trackVisualizerDisabled();
		}
		this._telemetryService?.trackVisualizerToggled(enabled);

		await this._configurationService.setConfig(ConfigKey.PromptSectionVisualizerEnabled, enabled);
		this._fireStateChange();
	}

	/**
	 * Get visualizer enabled state
	 */
	isEnabled(): boolean {
		return this._state.isEnabled;
	}
}
