/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IFeatureFlagService, INativeChatRenderer, IPromptStateManager, IPromptVisualizerController } from '../common/services';
import { RenderOptions } from '../common/types';
import { PromptSectionVisualizerProvider } from './promptSectionVisualizerProvider';

/**
 * Controller that manages hybrid mode support for the Prompt Section Visualizer
 * Handles mode detection and switching between inline chat and standalone webview modes
 */
export class PromptVisualizerController extends Disposable implements IPromptVisualizerController {
	declare readonly _serviceBrand: undefined;
	private _currentMode: 'inline' | 'standalone' = 'standalone';
	private _provider?: PromptSectionVisualizerProvider;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IPromptStateManager private readonly _stateManager: IPromptStateManager,
		@INativeChatRenderer private readonly _nativeRenderer: INativeChatRenderer,
		@IFeatureFlagService private readonly _featureFlagService: IFeatureFlagService
	) {
		super();
		this._initializeMode();
		this._setupConfigurationListener();
	}

	/**
	 * Initialize the mode based on configuration
	 */
	private _initializeMode(): void {
		try {
			// Get the configured render mode
			const configuredMode = this._featureFlagService.getRenderMode();

			// Determine effective mode
			if (configuredMode === 'auto') {
				// Auto-detect based on context (default to standalone for now)
				this._currentMode = 'standalone';
				this._logService.info('PromptVisualizerController: Auto mode detected, defaulting to standalone');
			} else {
				this._currentMode = configuredMode;
				this._logService.info(`PromptVisualizerController: Mode set to ${this._currentMode}`);
			}
		} catch (error) {
			this._logService.error('Failed to initialize mode', error);
			this._currentMode = 'standalone'; // Fallback to standalone
		}
	}

	/**
	 * Setup configuration listener to detect mode changes
	 */
	private _setupConfigurationListener(): void {
		this._register(
			this._featureFlagService.onConfigurationChanged((useNativeRendering, renderMode) => {
				this._logService.info(
					`Configuration changed: useNativeRendering=${useNativeRendering}, renderMode=${renderMode}`
				);

				// Update current mode based on configuration
				if (renderMode === 'auto') {
					// Auto-detect based on current context
					this._currentMode = this._detectMode();
				} else {
					this._currentMode = renderMode;
				}

				this._logService.info(`Mode updated to: ${this._currentMode}`);
			})
		);
	}

	/**
	 * Detect the appropriate mode based on context
	 * @param context Optional context hint ('chat' or 'standalone')
	 * @returns The detected mode
	 */
	private _detectMode(context?: 'chat' | 'standalone'): 'inline' | 'standalone' {
		try {
			// If context is provided, use it
			if (context === 'chat') {
				return 'inline';
			} else if (context === 'standalone') {
				return 'standalone';
			}

			// Use feature flag service to determine effective mode
			const effectiveMode = this._featureFlagService.getEffectiveRenderMode(context);
			this._logService.trace(`Detected mode: ${effectiveMode} (context: ${context || 'none'})`);
			return effectiveMode;
		} catch (error) {
			this._logService.error('Error detecting mode', error);
			return 'standalone'; // Fallback
		}
	}

	/**
	 * Get the current render mode
	 */
	public getCurrentMode(): 'inline' | 'standalone' {
		return this._currentMode;
	}

	/**
	 * Switch between inline and standalone modes
	 * @param mode The mode to switch to
	 * @param persist Whether to persist the mode to configuration
	 */
	public async switchMode(mode: 'inline' | 'standalone', persist: boolean = false): Promise<void> {
		try {
			this._logService.info(`Switching mode from ${this._currentMode} to ${mode}`);

			// Update current mode
			this._currentMode = mode;

			// Persist to configuration if requested
			if (persist) {
				const config = vscode.workspace.getConfiguration('github.copilot.chat.promptSectionVisualizer');
				await config.update('renderMode', mode, vscode.ConfigurationTarget.Global);
				this._logService.info(`Mode persisted to configuration: ${mode}`);
			}

			// Notify user
			vscode.window.showInformationMessage(
				`Prompt Visualizer mode switched to: ${mode === 'inline' ? 'Inline Chat' : 'Standalone Panel'}`
			);
		} catch (error) {
			this._logService.error('Failed to switch mode', error);
			vscode.window.showErrorMessage(
				`Failed to switch mode: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Set the provider instance for standalone mode
	 */
	public setProvider(provider: PromptSectionVisualizerProvider): void {
		this._provider = provider;
		this._logService.trace('Provider set for controller');
	}

	/**
	 * Render in standalone webview panel mode
	 * Uses the existing PromptSectionVisualizerProvider with native components where possible
	 */
	public async renderStandalone(): Promise<void> {
		try {
			this._logService.trace('Rendering in standalone mode');

			if (!this._provider) {
				this._logService.warn('Provider not set, cannot render in standalone mode');
				vscode.window.showWarningMessage(
					'Prompt Visualizer provider not initialized. Please try again.'
				);
				return;
			}

			// Show the provider's webview
			this._provider.show();

			// Get current state and update the provider
			const state = this._stateManager.getCurrentState();
			const prompt = state.sections
				.map(s => `<${s.tagName}>${s.content}</${s.tagName}>`)
				.join('\n');

			this._provider.updatePrompt(prompt);

			this._logService.info('Standalone mode rendering completed');
		} catch (error) {
			this._logService.error('Failed to render in standalone mode', error);
			vscode.window.showErrorMessage(
				`Failed to render visualizer: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Render inline in chat mode
	 * Uses NativeChatRenderer to stream sections to chat
	 * @param stream The chat response stream to render to
	 * @param options Optional render options
	 */
	public async renderInline(
		stream: vscode.ChatResponseStream,
		options?: Partial<RenderOptions>
	): Promise<void> {
		try {
			this._logService.trace('Rendering in inline chat mode');

			// Get current state
			const state = this._stateManager.getCurrentState();

			if (state.sections.length === 0) {
				stream.markdown(
					'No prompt sections found. Please provide a prompt with XML-like tags (e.g., `<context>...</context>`).'
				);
				this._logService.warn('No sections to render in inline mode');
				return;
			}

			// Prepare render options
			const renderOptions: RenderOptions = {
				showActions: true,
				enableCollapse: true,
				showTokenBreakdown: true,
				mode: 'inline',
				...options
			};

			// Use NativeChatRenderer to render sections
			await this._nativeRenderer.renderSections(state.sections, stream, renderOptions);

			this._logService.info(`Inline mode rendering completed: ${state.sections.length} sections`);
		} catch (error) {
			this._logService.error('Failed to render in inline mode', error);
			stream.markdown(
				`❌ Failed to render visualizer: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Render using the current mode
	 * @param stream Optional chat response stream for inline mode
	 * @param options Optional render options
	 */
	public async render(
		stream?: vscode.ChatResponseStream,
		options?: Partial<RenderOptions>
	): Promise<void> {
		try {
			if (this._currentMode === 'inline') {
				if (!stream) {
					this._logService.warn('Inline mode requires a chat response stream');
					vscode.window.showWarningMessage(
						'Cannot render in inline mode without a chat context. Switching to standalone mode.'
					);
					await this.renderStandalone();
					return;
				}
				await this.renderInline(stream, options);
			} else {
				await this.renderStandalone();
			}
		} catch (error) {
			this._logService.error('Failed to render', error);
			throw error;
		}
	}

	/**
	 * Handle chat context and follow-up interactions for inline mode
	 * @param context The chat context
	 * @param request The chat request
	 */
	public async handleChatContext(
		context: vscode.ChatContext,
		request: vscode.ChatRequest
	): Promise<void> {
		try {
			this._logService.trace('Handling chat context for inline mode');

			// Extract prompt from chat context if available
			// This will be used to update the visualizer state
			const prompt = request.prompt.trim();

			if (prompt) {
				this._stateManager.updatePrompt(prompt);
				this._logService.trace('Prompt updated from chat context');
			}

			// Handle follow-up interactions based on request
			// This can be extended to handle specific follow-up commands
		} catch (error) {
			this._logService.error('Failed to handle chat context', error);
		}
	}

	/**
	 * Sync section edit back to chat for inline mode
	 * This is called when a section is edited in inline mode
	 * @param sectionId The ID of the section that was edited
	 * @param newContent The new content for the section
	 */
	public syncSectionEditToChat(sectionId: string, newContent: string): void {
		try {
			// Update the section in state manager
			this._stateManager.updateSection(sectionId, newContent);

			// In inline mode, the state change will trigger a re-render through the chat participant
			// In standalone mode, the provider will handle the update
			this._logService.trace(
				`Controller: Section ${sectionId} edit synced (mode: ${this._currentMode})`
			);
		} catch (error) {
			this._logService.error('Failed to sync section edit to chat', error);
		}
	}

	/**
	 * Handle chat input changes for inline mode
	 * This is called when the chat input changes and needs to be synced to the visualizer
	 * @param content The new chat input content
	 */
	public handleChatInputChange(content: string): void {
		try {
			// Update the visualizer state with the new content
			this._stateManager.updatePrompt(content);

			this._logService.trace(
				`Controller: Chat input change handled (mode: ${this._currentMode})`
			);
		} catch (error) {
			this._logService.error('Failed to handle chat input change', error);
		}
	}

	override dispose(): void {
		super.dispose();
		this._logService.info('PromptVisualizerController disposed');
	}
}
