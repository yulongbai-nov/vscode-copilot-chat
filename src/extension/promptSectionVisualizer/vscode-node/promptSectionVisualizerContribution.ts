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

		// Register test command (config-gated for development/testing)
		const loadTestPromptCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.loadTestPrompt',
			async () => {
				try {
					if (!this._provider) {
						vscode.window.showErrorMessage('Prompt Section Visualizer is not initialized');
						return;
					}

					// Show input box for test prompt
					const prompt = await vscode.window.showInputBox({
						prompt: 'Paste your test prompt with XML tags (e.g., <context>...</context><instructions>...</instructions>)',
						placeHolder: '<context>Your context here</context><instructions>Your instructions here</instructions>',
						ignoreFocusOut: true,
						validateInput: (value) => {
							if (!value || value.trim().length === 0) {
								return 'Prompt cannot be empty';
							}
							// Basic validation for XML-like tags
							if (!value.includes('<') || !value.includes('>')) {
								return 'Prompt should contain XML-like tags (e.g., <context>...</context>)';
							}
							return null;
						}
					});

					if (prompt) {
						// Show the visualizer view first
						await vscode.commands.executeCommand(
							'github.copilot.promptSectionVisualizer.focus'
						);

						// Load the prompt into the visualizer
						this._provider.updatePrompt(prompt);
						this._logService.info('Test prompt loaded into visualizer');
						vscode.window.showInformationMessage('Test prompt loaded successfully!');
					}
				} catch (error) {
					this._logService.error('Failed to load test prompt', error);
					vscode.window.showErrorMessage('Failed to load test prompt. See logs for details.');
				}
			}
		);

		this._disposables.add(toggleCommand);
		this._disposables.add(refreshCommand);
		this._disposables.add(loadTestPromptCommand);

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
					// Update chat input when visualizer changes
					this._updateChatInput(prompt);
				})
			);

			// Monitor chat input changes
			this._monitorChatInput();

			this._logService.info('Chat integration service initialized');
		} catch (error) {
			this._logService.error('Failed to setup chat integration', error);
		}
	}

	/**
	 * Monitor chat input for changes and sync to visualizer
	 *
	 * Note: This implementation uses VS Code's proposed/internal chat APIs.
	 * The actual API access may vary depending on VS Code version and API availability.
	 */
	private _monitorChatInput(): void {
		try {
			// TODO: Implement chat input monitoring when APIs are available
			//
			// Expected implementation:
			// 1. Access the chat widget service (IChatWidgetService or similar)
			// 2. Get the active chat widget
			// 3. Listen to input changes on the chat widget
			// 4. Call this._chatIntegrationService.updateFromChatInput(content)
			//
			// Example (pseudo-code):
			// const chatWidgetService = this._instantiationService.get(IChatWidgetService);
			// const activeWidget = chatWidgetService.getActiveWidget();
			// if (activeWidget) {
			//   this._disposables.add(
			//     activeWidget.input.onDidChange((content) => {
			//       this._chatIntegrationService.updateFromChatInput(content);
			//     })
			//   );
			// }

			this._logService.info('Chat input monitoring setup (placeholder - requires chat API access)');
		} catch (error) {
			this._logService.warn(`Chat input monitoring not available: ${error}`);
		}
	}

	/**
	 * Update chat input with content from visualizer
	 *
	 * Note: This implementation uses VS Code's proposed/internal chat APIs.
	 * The actual API access may vary depending on VS Code version and API availability.
	 */
	private _updateChatInput(prompt: string): void {
		try {
			// TODO: Implement chat input update when APIs are available
			//
			// Expected implementation:
			// 1. Access the chat widget service
			// 2. Get the active chat widget
			// 3. Update the input field with the new prompt
			//
			// Example (pseudo-code):
			// const chatWidgetService = this._instantiationService.get(IChatWidgetService);
			// const activeWidget = chatWidgetService.getActiveWidget();
			// if (activeWidget) {
			//   activeWidget.input.setValue(prompt);
			// }

			this._logService.trace(`Visualizer prompt changed (update pending): ${prompt.substring(0, 100)}...`);
		} catch (error) {
			this._logService.warn(`Chat input update not available: ${error}`);
		}
	}
}