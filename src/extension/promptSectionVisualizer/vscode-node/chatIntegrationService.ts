/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../platform/log/common/logService';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IPromptStateManager } from '../common/services';

/**
 * Service that handles synchronization between chat input and the prompt section visualizer
 */
export class ChatIntegrationService extends Disposable {
	private readonly _onDidChangeChatInput = this._register(new Emitter<string>());
	public readonly onDidChangeChatInput: Event<string> = this._onDidChangeChatInput.event;

	private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly _debounceDelay = 300; // ms

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IPromptStateManager private readonly _stateManager: IPromptStateManager
	) {
		super();

		// Listen to state changes from the visualizer to update chat input
		this._register(this._stateManager.onDidChangeState(state => {
			this._onVisualizerStateChange();
		}));
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
	 * Handle visualizer state changes
	 */
	private _onVisualizerStateChange(): void {
		// When the visualizer state changes (user edits), we need to update the chat input
		// This will be implemented when we have access to the chat input API
		const prompt = this.getVisualizerPrompt();
		this._onDidChangeChatInput.fire(prompt);
		this._logService.trace('ChatIntegrationService: Visualizer state changed, prompt updated');
	}

	override dispose(): void {
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
		}
		super.dispose();
	}
}
