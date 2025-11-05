/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { ChatIntegrationService } from './chatIntegrationService';
import { PromptSectionVisualizerProvider } from './promptSectionVisualizerProvider';

/**
 * Contribution that registers the Prompt Section Visualizer feature
 */
export class PromptSectionVisualizerContribution implements IExtensionContribution {
	readonly id = 'promptSectionVisualizer';

	private readonly _disposables = new DisposableStore();
	private _provider?: PromptSectionVisualizerProvider;
	private _chatIntegrationService?: ChatIntegrationService;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext
	) {
		this._registerProvider();
		this._registerCommands();
		this._setupChatIntegration();
	}

	dispose(): void {
		this._disposables.dispose();
	}

	private _registerProvider(): void {
		try {
			// Create the provider instance
			this._provider = this._instantiationService.createInstance(
				PromptSectionVisualizerProvider,
				this._extensionContext.extensionUri
			);

			// Register the webview view provider
			const registration = vscode.window.registerWebviewViewProvider(
				PromptSectionVisualizerProvider.viewType,
				this._provider,
				{
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			);

			this._disposables.add(registration);
			this._logService.info('Prompt Section Visualizer provider registered');
		} catch (error) {
			this._logService.error('Failed to register Prompt Section Visualizer provider', error);
		}
	}

	private _registerCommands(): void {
		// Register toggle command
		const toggleCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.toggle',
			async () => {
				try {
					// Get current configuration
					const config = vscode.workspace.getConfiguration('github.copilot.chat');
					const currentState = config.get<boolean>('promptSectionVisualizer.enabled', false);

					// Toggle the state
					await config.update(
						'promptSectionVisualizer.enabled',
						!currentState,
						vscode.ConfigurationTarget.Global
					);

					// Show/hide the visualizer view
					if (!currentState) {
						// Enabling - show the view
						await vscode.commands.executeCommand(
							'github.copilot.promptSectionVisualizer.focus'
						);
						this._logService.info('Prompt Section Visualizer enabled');
					} else {
						this._logService.info('Prompt Section Visualizer disabled');
					}
				} catch (error) {
					this._logService.error('Failed to toggle Prompt Section Visualizer', error);
				}
			}
		);

		// Register refresh command
		const refreshCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.refresh',
			() => {
				if (this._provider) {
					// Refresh the visualizer by re-parsing the current prompt
					const currentPrompt = this._provider.getEditedPrompt();
					this._provider.updatePrompt(currentPrompt);
					this._logService.info('Prompt Section Visualizer refreshed');
				}
			}
		);

		this._disposables.add(toggleCommand);
		this._disposables.add(refreshCommand);

		this._logService.info('Prompt Section Visualizer commands registered');
	}

	/**
	 * Get the provider instance for external access
	 */
	public getProvider(): PromptSectionVisualizerProvider | undefined {
		return this._provider;
	}

	/**
	 * Setup chat integration for bidirectional synchronization
	 */
	private _setupChatIntegration(): void {
		try {
			// Create the chat integration service
			this._chatIntegrationService = this._instantiationService.createInstance(ChatIntegrationService);
			this._disposables.add(this._chatIntegrationService);

			// Listen for changes from the visualizer to update chat input
			this._disposables.add(
				this._chatIntegrationService.onDidChangeChatInput((prompt: string) => {
					// This will be used to update the chat input when the visualizer changes
					// For now, we log it. The actual chat input update will be implemented
					// when we have access to the chat input API
					this._logService.trace(`Visualizer prompt changed: ${prompt.substring(0, 100)}...`);
				})
			);

			// Note: Chat input monitoring will be implemented in the next phase
			// when we have access to the chat input change events
			this._logService.info('Chat integration service initialized');
		} catch (error) {
			this._logService.error('Failed to setup chat integration', error);
		}
	}
}