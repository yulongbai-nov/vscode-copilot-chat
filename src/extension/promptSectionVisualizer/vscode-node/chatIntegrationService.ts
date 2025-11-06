/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { Schemas } from '../../../util/vs/base/common/network';
import { IFeatureFlagService, IPromptStateManager, IPromptVisualizerChatParticipant } from '../common/services';

/**
 * Service that handles synchronization between chat input and the prompt section visualizer
 * Supports both traditional webview mode and native chat participant mode
 */
export class ChatIntegrationService extends Disposable {
	private readonly _onDidChangeChatInput = this._register(new Emitter<string>());
	public readonly onDidChangeChatInput: Event<string> = this._onDidChangeChatInput.event;

	private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly _debounceDelay = 300; // ms
	private _isUpdatingFromVisualizer = false;
	private _lastChatInputContent = '';
	private _renderMode: 'inline' | 'standalone' = 'standalone';

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IPromptStateManager private readonly _stateManager: IPromptStateManager,
		@IFeatureFlagService private readonly _featureFlagService: IFeatureFlagService
	) {
		super();

		// Initialize render mode
		this._renderMode = this._featureFlagService.getRenderMode() === 'inline' ? 'inline' : 'standalone';

		// Listen to state changes from the visualizer to update chat input
		this._register(this._stateManager.onDidChangeState(() => {
			this._onVisualizerStateChange();
		}));

		// Hook into chat input changes
		this._setupChatInputMonitoring();

		// Listen for configuration changes
		this._register(
			this._featureFlagService.onConfigurationChanged((useNativeRendering, renderMode) => {
				this._renderMode = renderMode === 'inline' ? 'inline' : 'standalone';
				this._logService.info(`ChatIntegrationService: Render mode updated to ${this._renderMode}`);
			})
		);
	}

	/**
	 * Setup monitoring of chat input text documents
	 */
	private _setupChatInputMonitoring(): void {
		// Monitor text document changes for chat input
		this._register(vscode.workspace.onDidChangeTextDocument(e => {
			// Check if this is a chat input document
			if (e.document.uri.scheme === Schemas.vscodeChatInput) {
				this._onChatInputChanged(e.document);
			}
		}));

		// Also monitor when chat input documents are opened
		this._register(vscode.workspace.onDidOpenTextDocument(doc => {
			if (doc.uri.scheme === Schemas.vscodeChatInput) {
				this._onChatInputChanged(doc);
			}
		}));

		this._logService.info('ChatIntegrationService: Chat input monitoring setup complete');
	}

	/**
	 * Handle chat input document changes
	 */
	private _onChatInputChanged(document: vscode.TextDocument): void {
		// Skip if we're currently updating from the visualizer to prevent circular updates
		if (this._isUpdatingFromVisualizer) {
			return;
		}

		const content = document.getText();

		// Skip if content hasn't changed
		if (content === this._lastChatInputContent) {
			return;
		}

		this._lastChatInputContent = content;
		this.updateFromChatInput(content);
	}

	/**
	 * Update the visualizer with new chat input content
	 * This is called when the chat input changes
	 */
	public updateFromChatInput(content: string): void {
		// Debounce updates to prevent excessive parsing
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
		}

		this._debounceTimer = setTimeout(() => {
			try {
				this._stateManager.updatePrompt(content);
				this._logService.trace('ChatIntegrationService: Updated visualizer from chat input');
			} catch (error) {
				this._logService.error('ChatIntegrationService: Failed to update visualizer', error);
			}
		}, this._debounceDelay);
	}

	/**
	 * Get the current prompt from the visualizer
	 * This is called when we need to sync back to chat input
	 */
	public getVisualizerPrompt(): string {
		const state = this._stateManager.getCurrentState();
		// Reconstruct the prompt from sections
		return state.sections.map(s => `<${s.tagName}>${s.content}</${s.tagName}>`).join('\n');
	}

	/**
	 * Handle visualizer state changes and sync back to chat input
	 */
	private _onVisualizerStateChange(): void {
		// When the visualizer state changes (user edits), we need to update the chat input
		const prompt = this.getVisualizerPrompt();

		// Update the last known content to prevent circular updates
		this._lastChatInputContent = prompt;

		// Fire event for external listeners
		this._onDidChangeChatInput.fire(prompt);

		// Only update chat input document in standalone mode
		// In inline mode, the chat participant handles rendering
		if (this._renderMode === 'standalone') {
			this._updateChatInputDocument(prompt);
		}

		this._logService.trace(`ChatIntegrationService: Visualizer state changed, prompt updated (mode: ${this._renderMode})`);
	}

	/**
	 * Update the chat input document with new content
	 */
	private async _updateChatInputDocument(content: string): Promise<void> {
		try {
			// Set flag to prevent circular updates
			this._isUpdatingFromVisualizer = true;

			// Find the active chat input document
			const chatInputDoc = vscode.workspace.textDocuments.find(
				doc => doc.uri.scheme === Schemas.vscodeChatInput
			);

			if (chatInputDoc) {
				// Create a workspace edit to update the document
				const edit = new vscode.WorkspaceEdit();
				const fullRange = new vscode.Range(
					chatInputDoc.positionAt(0),
					chatInputDoc.positionAt(chatInputDoc.getText().length)
				);
				edit.replace(chatInputDoc.uri, fullRange, content);

				// Apply the edit
				const success = await vscode.workspace.applyEdit(edit);

				if (success) {
					this._logService.trace('ChatIntegrationService: Successfully updated chat input document');
				} else {
					this._logService.warn('ChatIntegrationService: Failed to apply edit to chat input document');
				}
			} else {
				this._logService.trace('ChatIntegrationService: No active chat input document found');
			}
		} catch (error) {
			this._logService.error('ChatIntegrationService: Error updating chat input document', error);
		} finally {
			// Reset flag after a short delay to allow the change to propagate
			setTimeout(() => {
				this._isUpdatingFromVisualizer = false;
			}, 100);
		}
	}

	/**
	 * Set the chat participant for integration
	 * This allows the service to coordinate with the chat participant in inline mode
	 */
	public setChatParticipant(_participant: IPromptVisualizerChatParticipant): void {
		// Store reference for potential future use
		this._logService.info('ChatIntegrationService: Chat participant registered');
	}

	/**
	 * Register chat commands for the visualizer
	 * This registers the /visualize-prompt and /edit-section commands in chat
	 */
	public registerChatCommands(): vscode.Disposable[] {
		const disposables: vscode.Disposable[] = [];

		try {
			// Note: Chat commands are registered through the chat participant
			// The participant handles /visualize-prompt and /edit-section commands
			// This method provides a hook for additional command registration if needed

			this._logService.info('ChatIntegrationService: Chat commands registered through participant');

			// Return empty disposables array since commands are handled by the participant
			return disposables;
		} catch (error) {
			this._logService.error('ChatIntegrationService: Failed to register chat commands', error);
			return disposables;
		}
	}

	/**
	 * Get chat command descriptions for help text
	 */
	public getChatCommandDescriptions(): Array<{ command: string; description: string }> {
		return [
			{
				command: '/visualize-prompt',
				description: 'Visualize the current prompt with sections and token counts'
			},
			{
				command: '/edit-section',
				description: 'Edit a specific section by tag name or index'
			}
		];
	}

	/**
	 * Get the current render mode
	 */
	public getRenderMode(): 'inline' | 'standalone' {
		return this._renderMode;
	}

	/**
	 * Check if native rendering is enabled
	 */
	public isNativeRenderingEnabled(): boolean {
		return this._featureFlagService.isNativeRenderingEnabled();
	}

	/**
	 * Sync section edits back to chat input (for inline mode)
	 * This is called when a section is edited in inline mode
	 */
	public syncSectionEditToChatInput(sectionId: string, newContent: string): void {
		try {
			// Update the section in state manager
			this._stateManager.updateSection(sectionId, newContent);

			// In inline mode, we don't need to update the chat input document
			// The chat participant will handle re-rendering
			if (this._renderMode === 'inline') {
				this._logService.trace(`ChatIntegrationService: Section ${sectionId} edited in inline mode`);
				// The state change event will be fired by the state manager
			} else {
				// In standalone mode, update the chat input document
				const prompt = this.getVisualizerPrompt();
				this._updateChatInputDocument(prompt);
			}
		} catch (error) {
			this._logService.error('ChatIntegrationService: Failed to sync section edit', error);
		}
	}

	/**
	 * Handle chat input changes in inline mode
	 * This prevents circular updates when the visualizer updates the chat input
	 */
	public handleChatInputChangeInInlineMode(content: string): void {
		// In inline mode, we need to be more careful about circular updates
		// Only update if the content is actually different
		if (content !== this._lastChatInputContent) {
			this._lastChatInputContent = content;
			this.updateFromChatInput(content);
		}
	}

	/**
	 * Sync section edits back to chat input for inline mode
	 * This is called when a section is edited through the chat participant
	 * @param sectionId The ID of the section that was edited
	 * @param newContent The new content for the section
	 * @param preventCircularUpdate Whether to prevent circular updates (default: true)
	 */
	public syncEditBackToChatInput(
		sectionId: string,
		newContent: string,
		preventCircularUpdate: boolean = true
	): void {
		try {
			// Update the section in state manager
			this._stateManager.updateSection(sectionId, newContent);

			// Get the updated prompt
			const updatedPrompt = this.getVisualizerPrompt();

			// Update last known content to prevent circular updates
			if (preventCircularUpdate) {
				this._lastChatInputContent = updatedPrompt;
			}

			// In inline mode, we don't update the chat input document directly
			// The chat participant will handle re-rendering
			if (this._renderMode === 'inline') {
				this._logService.trace(
					`ChatIntegrationService: Section ${sectionId} synced in inline mode`
				);
				// Fire event for external listeners
				this._onDidChangeChatInput.fire(updatedPrompt);
			} else {
				// In standalone mode, update the chat input document
				this._updateChatInputDocument(updatedPrompt);
			}
		} catch (error) {
			this._logService.error('ChatIntegrationService: Failed to sync edit back to chat input', error);
		}
	}

	/**
	 * Handle chat input changes and sync to visualizer
	 * This is the main entry point for bidirectional sync from chat to visualizer
	 * @param content The new chat input content
	 * @param source The source of the change ('user' | 'visualizer')
	 */
	public handleBidirectionalSync(content: string, source: 'user' | 'visualizer' = 'user'): void {
		try {
			// Prevent circular updates
			if (source === 'visualizer' && this._isUpdatingFromVisualizer) {
				this._logService.trace('ChatIntegrationService: Skipping circular update from visualizer');
				return;
			}

			// Check if content has actually changed
			if (content === this._lastChatInputContent) {
				this._logService.trace('ChatIntegrationService: Content unchanged, skipping sync');
				return;
			}

			// Update last known content
			this._lastChatInputContent = content;

			if (source === 'user') {
				// User changed chat input - update visualizer
				this.updateFromChatInput(content);
			} else {
				// Visualizer changed - update chat input
				if (this._renderMode === 'standalone') {
					this._updateChatInputDocument(content);
				}
				// In inline mode, the chat participant handles rendering
			}

			this._logService.trace(
				`ChatIntegrationService: Bidirectional sync completed (source: ${source}, mode: ${this._renderMode})`
			);
		} catch (error) {
			this._logService.error('ChatIntegrationService: Failed to handle bidirectional sync', error);
		}
	}

	/**
	 * Prevent circular updates during a specific operation
	 * @param operation The operation to execute without triggering circular updates
	 */
	public async withoutCircularUpdates<T>(operation: () => Promise<T>): Promise<T> {
		const wasUpdating = this._isUpdatingFromVisualizer;
		try {
			this._isUpdatingFromVisualizer = true;
			return await operation();
		} finally {
			// Reset flag after a short delay to allow changes to propagate
			setTimeout(() => {
				this._isUpdatingFromVisualizer = wasUpdating;
			}, 100);
		}
	}

	/**
	 * Check if currently updating from visualizer (to prevent circular updates)
	 */
	public isUpdatingFromVisualizer(): boolean {
		return this._isUpdatingFromVisualizer;
	}

	override dispose(): void {
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
		}
		super.dispose();
	}
}
