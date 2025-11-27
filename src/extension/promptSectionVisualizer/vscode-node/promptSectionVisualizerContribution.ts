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
import { IPromptStateManager, IPromptVisualizerChatParticipant, IPromptVisualizerController, ISectionEditorService } from '../common/services';
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
	private _chatParticipant?: IPromptVisualizerChatParticipant;
	private _controller?: IPromptVisualizerController;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext
	) {
		this._initializeController();
		this._registerProvider();
		this._registerCommands();
		this._setupChatIntegration();
		this._registerChatParticipant();
		this._setupConfigurationListener();
	}

	dispose(): void {
		this._disposables.dispose();
	}

	/**
	 * Initialize the controller for hybrid mode support
	 */
	private _initializeController(): void {
		try {
			// Create the controller instance
			this._controller = this._instantiationService.invokeFunction(accessor =>
				accessor.get(IPromptVisualizerController)
			);
			this._disposables.add(this._controller);

			this._logService.info('Prompt Visualizer controller initialized');
		} catch (error) {
			this._logService.error('Failed to initialize controller', error);
		}
	}

	private _registerProvider(): void {
		try {
			// Create the provider instance
			this._provider = this._instantiationService.createInstance(
				PromptSectionVisualizerProvider,
				this._extensionContext.extensionUri
			);

			// Set the provider in the controller for standalone mode
			if (this._controller) {
				this._controller.setProvider(this._provider);
			}

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
		// Register switch mode command
		const switchModeCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.switchMode',
			async () => {
				try {
					// Get the controller
					if (!this._controller) {
						vscode.window.showWarningMessage('Prompt Visualizer controller not initialized.');
						return;
					}

					// Get current mode
					const currentMode = this._controller.getCurrentMode();

					// Prompt user to select new mode
					const newMode = await vscode.window.showQuickPick(
						[
							{
								label: 'Inline Chat',
								description: 'Render sections inline in chat responses',
								value: 'inline' as const
							},
							{
								label: 'Standalone Panel',
								description: 'Render sections in a dedicated webview panel',
								value: 'standalone' as const
							}
						],
						{
							title: 'Select Render Mode',
							placeHolder: `Current mode: ${currentMode === 'inline' ? 'Inline Chat' : 'Standalone Panel'}`
						}
					);

					if (newMode) {
						// Switch mode and persist
						await this._controller.switchMode(newMode.value, true);
					}
				} catch (error) {
					this._logService.error('Failed to switch mode', error);
					vscode.window.showErrorMessage(
						`Failed to switch mode: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		);

		// Register toggle command
		const toggleCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.toggle',
			async () => {
				try {
					// Get current configuration
					const config = vscode.workspace.getConfiguration('github.copilot.chat');
					const currentState = config.get<boolean>('promptSectionVisualizer.enabled', false);
					const newState = !currentState;

					// Toggle the state
					await config.update(
						'promptSectionVisualizer.enabled',
						newState,
						vscode.ConfigurationTarget.Global
					);

					// Show/hide the visualizer view
					if (newState) {
						// Enabling - show the view
						await vscode.commands.executeCommand(
							'github.copilot.promptSectionVisualizer.focus'
						);

						// Show information message
						vscode.window.showInformationMessage(
							'Prompt Section Visualizer enabled. The view will appear in the chat panel.'
						);

						this._logService.info('Prompt Section Visualizer enabled');
					} else {
						// Show information message
						vscode.window.showInformationMessage(
							'Prompt Section Visualizer disabled.'
						);

						this._logService.info('Prompt Section Visualizer disabled');
					}

					// Update context for when clause
					await vscode.commands.executeCommand(
						'setContext',
						'github.copilot.promptSectionVisualizer.enabled',
						newState
					);
				} catch (error) {
					this._logService.error('Failed to toggle Prompt Section Visualizer', error);
					vscode.window.showErrorMessage(
						'Failed to toggle Prompt Section Visualizer. See output for details.'
					);
				}
			}
		);

		// Register refresh command
		const refreshCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.refresh',
			() => {
				try {
					if (this._provider) {
						// Refresh the visualizer by re-parsing the current prompt
						const currentPrompt = this._provider.getEditedPrompt();
						this._provider.updatePrompt(currentPrompt);
						this._logService.info('Prompt Section Visualizer refreshed');

						// Show brief status message
						vscode.window.setStatusBarMessage(
							'$(refresh) Prompt Section Visualizer refreshed',
							3000
						);
					} else {
						this._logService.warn('Cannot refresh: Prompt Section Visualizer provider not initialized');
					}
				} catch (error) {
					this._logService.error('Failed to refresh Prompt Section Visualizer', error);
					vscode.window.showErrorMessage(
						'Failed to refresh Prompt Section Visualizer. See output for details.'
					);
				}
			}
		);

		const showCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.show',
			async () => {
				try {
					await vscode.commands.executeCommand('github.copilot.promptSectionVisualizer.focus');
					if (this._controller) {
						await this._controller.renderStandalone();
					} else {
						this._logService.warn('Prompt Visualizer controller not initialized.');
					}
				} catch (error) {
					this._logService.error('Failed to show Prompt Section Visualizer', error);
					vscode.window.showErrorMessage(
						`Failed to show Prompt Section Visualizer: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		);

		// Register section action commands
		this._registerSectionActionCommands();

		this._disposables.add(switchModeCommand);
		this._disposables.add(toggleCommand);
		this._disposables.add(refreshCommand);
		this._disposables.add(showCommand);

		// Initialize context based on current configuration
		const config = vscode.workspace.getConfiguration('github.copilot.chat');
		const currentState = config.get<boolean>('promptSectionVisualizer.enabled', false);
		vscode.commands.executeCommand(
			'setContext',
			'github.copilot.promptSectionVisualizer.enabled',
			currentState
		);

		this._logService.info('Prompt Section Visualizer commands registered');
	}

	/**
	 * Register section action commands (edit, delete, toggle collapse, add, reorder)
	 */
	private _registerSectionActionCommands(): void {
		// Edit Section command
		const editSectionCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.editSection',
			async (sectionId: string) => {
				try {
					this._logService.trace(`Edit section command invoked for section: ${sectionId}`);

					// Get the state manager and editor service
					const stateManager = this._instantiationService.invokeFunction(accessor =>
						accessor.get(IPromptStateManager)
					);
					const editorService = this._instantiationService.invokeFunction(accessor =>
						accessor.get(ISectionEditorService)
					);

					// Get the current state
					const state = stateManager.getCurrentState();
					const section = state.sections.find(s => s.id === sectionId);

					if (!section) {
						vscode.window.showErrorMessage(`Section with ID "${sectionId}" not found.`);
						this._logService.warn(`Section not found: ${sectionId}`);
						return;
					}

					// Open the editor
					const newContent = await editorService.editSection(section);

					// If content was changed, update the section
					if (newContent !== undefined && newContent !== section.content) {
						stateManager.updateSection(sectionId, newContent);
						this._logService.info(`Section "${section.tagName}" updated successfully`);

						// Trigger re-render by refreshing the provider
						if (this._provider) {
							const updatedPrompt = stateManager.getCurrentState().sections
								.map(s => `<${s.tagName}>${s.content}</${s.tagName}>`)
								.join('\n');
							this._provider.updatePrompt(updatedPrompt);
						}

						// Show success message
						vscode.window.showInformationMessage(
							`Section "${section.tagName}" updated successfully.`
						);
					}
				} catch (error) {
					this._logService.error('Failed to edit section', error);
					vscode.window.showErrorMessage(
						`Failed to edit section: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		);

		// Delete Section command
		const deleteSectionCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.deleteSection',
			async (sectionId: string) => {
				try {
					this._logService.trace(`Delete section command invoked for section: ${sectionId}`);

					// Get the state manager
					const stateManager = this._instantiationService.invokeFunction(accessor =>
						accessor.get(IPromptStateManager)
					);

					// Get the current state
					const state = stateManager.getCurrentState();
					const section = state.sections.find(s => s.id === sectionId);

					if (!section) {
						vscode.window.showErrorMessage(`Section with ID "${sectionId}" not found.`);
						this._logService.warn(`Section not found: ${sectionId}`);
						return;
					}

					// Show confirmation dialog
					const confirmation = await vscode.window.showWarningMessage(
						`Are you sure you want to delete section "<${section.tagName}>"?`,
						{ modal: true },
						'Delete',
						'Cancel'
					);

					if (confirmation !== 'Delete') {
						this._logService.trace('Delete section cancelled by user');
						return;
					}

					// Remove the section
					stateManager.removeSection(sectionId);
					this._logService.info(`Section "${section.tagName}" deleted successfully`);

					// Trigger re-render by refreshing the provider
					if (this._provider) {
						const updatedPrompt = stateManager.getCurrentState().sections
							.map(s => `<${s.tagName}>${s.content}</${s.tagName}>`)
							.join('\n');
						this._provider.updatePrompt(updatedPrompt);
					}

					// Show success message
					vscode.window.showInformationMessage(
						`Section "${section.tagName}" deleted successfully.`
					);
				} catch (error) {
					this._logService.error('Failed to delete section', error);
					vscode.window.showErrorMessage(
						`Failed to delete section: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		);

		// Toggle Collapse command
		const toggleCollapseCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.toggleCollapse',
			async (sectionId: string) => {
				try {
					this._logService.trace(`Toggle collapse command invoked for section: ${sectionId}`);

					// Get the state manager
					const stateManager = this._instantiationService.invokeFunction(accessor =>
						accessor.get(IPromptStateManager)
					);

					// Get the current state
					const state = stateManager.getCurrentState();
					const section = state.sections.find(s => s.id === sectionId);

					if (!section) {
						vscode.window.showErrorMessage(`Section with ID "${sectionId}" not found.`);
						this._logService.warn(`Section not found: ${sectionId}`);
						return;
					}

					// Toggle collapse state
					stateManager.toggleSectionCollapse(sectionId);
					this._logService.info(`Section "${section.tagName}" collapse state toggled`);

					// Trigger re-render by refreshing the provider
					if (this._provider) {
						const updatedPrompt = stateManager.getCurrentState().sections
							.map(s => `<${s.tagName}>${s.content}</${s.tagName}>`)
							.join('\n');
						this._provider.updatePrompt(updatedPrompt);
					}
				} catch (error) {
					this._logService.error('Failed to toggle collapse', error);
					vscode.window.showErrorMessage(
						`Failed to toggle collapse: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		);

		// Add Section command
		const addSectionCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.addSection',
			async () => {
				try {
					this._logService.trace('Add section command invoked');

					// Get the state manager
					const stateManager = this._instantiationService.invokeFunction(accessor =>
						accessor.get(IPromptStateManager)
					);

					// Prompt for tag name
					const tagName = await vscode.window.showInputBox({
						title: 'Add New Section',
						prompt: 'Enter the tag name for the new section',
						placeHolder: 'e.g., context, instructions, examples',
						validateInput: (value) => {
							if (!value || value.trim().length === 0) {
								return 'Tag name cannot be empty';
							}
							if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
								return 'Tag name must start with a letter and contain only letters, numbers, hyphens, and underscores';
							}
							return undefined;
						}
					});

					if (!tagName) {
						this._logService.trace('Add section cancelled: no tag name provided');
						return;
					}

					// Prompt for content
					const content = await vscode.window.showInputBox({
						title: `Add Section: <${tagName}>`,
						prompt: 'Enter the content for the new section',
						placeHolder: 'Enter section content...',
						value: '',
						validateInput: (value) => {
							if (!value || value.trim().length === 0) {
								return 'Section content cannot be empty';
							}
							return undefined;
						}
					});

					if (content === undefined) {
						this._logService.trace('Add section cancelled: no content provided');
						return;
					}

					// Add the section
					stateManager.addSection(tagName, content);
					this._logService.info(`Section "${tagName}" added successfully`);

					// Trigger re-render by refreshing the provider
					if (this._provider) {
						const updatedPrompt = stateManager.getCurrentState().sections
							.map(s => `<${s.tagName}>${s.content}</${s.tagName}>`)
							.join('\n');
						this._provider.updatePrompt(updatedPrompt);
					}

					// Show success message
					vscode.window.showInformationMessage(
						`Section "${tagName}" added successfully.`
					);
				} catch (error) {
					this._logService.error('Failed to add section', error);
					vscode.window.showErrorMessage(
						`Failed to add section: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		);

		// Move Section Up command
		const moveSectionUpCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.moveSectionUp',
			async (sectionId: string) => {
				try {
					this._logService.trace(`Move section up command invoked for section: ${sectionId}`);

					// Get the state manager
					const stateManager = this._instantiationService.invokeFunction(accessor =>
						accessor.get(IPromptStateManager)
					);

					// Get the current state
					const state = stateManager.getCurrentState();
					const sectionIndex = state.sections.findIndex(s => s.id === sectionId);

					if (sectionIndex === -1) {
						vscode.window.showErrorMessage(`Section with ID "${sectionId}" not found.`);
						this._logService.warn(`Section not found: ${sectionId}`);
						return;
					}

					if (sectionIndex === 0) {
						vscode.window.showInformationMessage('Section is already at the top.');
						return;
					}

					// Create new order by swapping with previous section
					const newOrder = state.sections.map(s => s.id);
					[newOrder[sectionIndex - 1], newOrder[sectionIndex]] = [newOrder[sectionIndex], newOrder[sectionIndex - 1]];

					// Reorder sections
					stateManager.reorderSections(newOrder);
					this._logService.info(`Section moved up successfully`);

					// Trigger re-render by refreshing the provider
					if (this._provider) {
						const updatedPrompt = stateManager.getCurrentState().sections
							.map(s => `<${s.tagName}>${s.content}</${s.tagName}>`)
							.join('\n');
						this._provider.updatePrompt(updatedPrompt);
					}

					// Show success message
					vscode.window.showInformationMessage('Section moved up successfully.');
				} catch (error) {
					this._logService.error('Failed to move section up', error);
					vscode.window.showErrorMessage(
						`Failed to move section up: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		);

		// Move Section Down command
		const moveSectionDownCommand = vscode.commands.registerCommand(
			'github.copilot.promptSectionVisualizer.moveSectionDown',
			async (sectionId: string) => {
				try {
					this._logService.trace(`Move section down command invoked for section: ${sectionId}`);

					// Get the state manager
					const stateManager = this._instantiationService.invokeFunction(accessor =>
						accessor.get(IPromptStateManager)
					);

					// Get the current state
					const state = stateManager.getCurrentState();
					const sectionIndex = state.sections.findIndex(s => s.id === sectionId);

					if (sectionIndex === -1) {
						vscode.window.showErrorMessage(`Section with ID "${sectionId}" not found.`);
						this._logService.warn(`Section not found: ${sectionId}`);
						return;
					}

					if (sectionIndex === state.sections.length - 1) {
						vscode.window.showInformationMessage('Section is already at the bottom.');
						return;
					}

					// Create new order by swapping with next section
					const newOrder = state.sections.map(s => s.id);
					[newOrder[sectionIndex], newOrder[sectionIndex + 1]] = [newOrder[sectionIndex + 1], newOrder[sectionIndex]];

					// Reorder sections
					stateManager.reorderSections(newOrder);
					this._logService.info(`Section moved down successfully`);

					// Trigger re-render by refreshing the provider
					if (this._provider) {
						const updatedPrompt = stateManager.getCurrentState().sections
							.map(s => `<${s.tagName}>${s.content}</${s.tagName}>`)
							.join('\n');
						this._provider.updatePrompt(updatedPrompt);
					}

					// Show success message
					vscode.window.showInformationMessage('Section moved down successfully.');
				} catch (error) {
					this._logService.error('Failed to move section down', error);
					vscode.window.showErrorMessage(
						`Failed to move section down: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		);

		// Add all commands to disposables
		this._disposables.add(editSectionCommand);
		this._disposables.add(deleteSectionCommand);
		this._disposables.add(toggleCollapseCommand);
		this._disposables.add(addSectionCommand);
		this._disposables.add(moveSectionUpCommand);
		this._disposables.add(moveSectionDownCommand);

		this._logService.info('Section action commands registered');
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

			// Register chat commands
			const chatCommandDisposables = this._chatIntegrationService.registerChatCommands();
			chatCommandDisposables.forEach(d => this._disposables.add(d));

			// Log available chat commands
			const commandDescriptions = this._chatIntegrationService.getChatCommandDescriptions();
			this._logService.info(
				`Chat commands available: ${commandDescriptions.map(c => c.command).join(', ')}`
			);

			// Note: Chat input monitoring will be implemented in the next phase
			// when we have access to the chat input change events
			this._logService.info('Chat integration service initialized');
		} catch (error) {
			this._logService.error('Failed to setup chat integration', error);
		}
	}

	/**
	 * Register the chat participant for inline chat rendering
	 */
	private _registerChatParticipant(): void {
		try {
			// Create the chat participant instance using the class directly
			this._chatParticipant = this._instantiationService.invokeFunction(accessor => {
				return accessor.get(IPromptVisualizerChatParticipant);
			});
			this._disposables.add(this._chatParticipant);

			// Wire up the chat participant with the chat integration service
			if (this._chatIntegrationService) {
				this._chatIntegrationService.setChatParticipant(this._chatParticipant);
			}

			this._logService.info('Prompt Visualizer chat participant registered');
		} catch (error) {
			this._logService.error('Failed to register chat participant', error);
		}
	}

	/**
	 * Setup configuration listener to keep context in sync
	 */
	private _setupConfigurationListener(): void {
		// Listen for configuration changes
		this._disposables.add(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('github.copilot.chat.promptSectionVisualizer.enabled')) {
					const config = vscode.workspace.getConfiguration('github.copilot.chat');
					const enabled = config.get<boolean>('promptSectionVisualizer.enabled', false);

					// Update context for when clause
					vscode.commands.executeCommand(
						'setContext',
						'github.copilot.promptSectionVisualizer.enabled',
						enabled
					);

					this._logService.info(`Prompt Section Visualizer configuration changed: enabled=${enabled}`);
				}
			})
		);
	}
}
