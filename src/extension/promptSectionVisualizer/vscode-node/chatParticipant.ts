/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IPromptStateManager, IPromptVisualizerController } from '../common/services';
import type { RenderOptions } from '../common/types';

type FollowUpState = {
	readonly sectionId: string;
	readonly tagName: string;
};

type PromptVisualizerChatMetadata = {
	readonly command: 'visualize-prompt' | 'edit-section';
	readonly sectionsCount?: number;
	readonly totalTokens?: number;
	readonly error?: string;
};

/**
 * Chat participant that handles visualization requests and renders sections using native chat APIs
 */
export class PromptVisualizerChatParticipant extends Disposable {
	static readonly ID = 'github.copilot.promptVisualizer';
	static readonly NAME = 'Prompt Visualizer';
	static readonly DESCRIPTION = 'Visualize and edit prompt sections';

	private _participant: vscode.ChatParticipant | undefined;
	private readonly _followUpState: Map<string, FollowUpState> = new Map();

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IPromptStateManager private readonly _stateManager: IPromptStateManager,
		@IPromptVisualizerController private readonly _controller: IPromptVisualizerController
	) {
		super();
		this._registerParticipant();
		this._registerFollowUpHandlers();
	}

	/**
	 * Register the chat participant with VS Code
	 */
	private _registerParticipant(): void {
		try {
			// Create and register the chat participant
			this._participant = vscode.chat.createChatParticipant(
				PromptVisualizerChatParticipant.ID,
				this._handleRequest.bind(this)
			);

			// Set participant metadata
			this._participant.iconPath = vscode.Uri.parse('$(symbol-structure)');

			// Register as disposable
			this._register(this._participant);

			this._logService.info('PromptVisualizerChatParticipant registered successfully');
			this._logService.info('Available commands: /visualize-prompt, /edit-section');
		} catch (error) {
			this._logService.error('Failed to register PromptVisualizerChatParticipant', error);
		}
	}

	/**
	 * Handle incoming chat requests
	 */
	private async _handleRequest(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<vscode.ChatResult> {
		try {
			// Parse command from request
			const command = request.command;

			this._logService.trace(`PromptVisualizerChatParticipant: Handling command "${command}"`);

			// Route to appropriate handler
			if (command === 'visualize-prompt' || !command) {
				return await this._handleVisualizePrompt(request, context, stream, token);
			} else if (command === 'edit-section') {
				return await this._handleEditSection(request, stream, token);
			} else {
				// Unknown command
				stream.markdown(`Unknown command: \`${command}\`. Available commands: \`visualize-prompt\`, \`edit-section\``);
				return { metadata: { command } };
			}
		} catch (error) {
			this._logService.error('Error handling chat request', error);
			stream.markdown(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
			return { errorDetails: { message: error instanceof Error ? error.message : String(error) } };
		}
	}

	/**
	 * Handle the /visualize-prompt command
	 */
	private async _handleVisualizePrompt(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<vscode.ChatResult> {
		try {
			this._logService.trace('PromptVisualizerChatParticipant: Handling visualize-prompt command');

			// Get the prompt to visualize
			// If the user provided text in the request, use that
			// Otherwise, use the current state from the state manager
			const promptToVisualize = request.prompt.trim();

			if (!promptToVisualize) {
				// Get current state from state manager
				const currentState = this._stateManager.getCurrentState();
				if (currentState.sections.length === 0) {
					stream.markdown('No prompt sections found. Please provide a prompt with XML-like tags (e.g., `<context>...</context>`).');
					return { metadata: { command: 'visualize-prompt', sectionsCount: 0 } };
				}

				// Use existing sections
				this._logService.trace(`Visualizing ${currentState.sections.length} existing sections`);
			} else {
				// Parse the provided prompt
				this._logService.trace('Parsing provided prompt');
				this._stateManager.updatePrompt(promptToVisualize);
			}

			// Get the current state after parsing
			const state = this._stateManager.getCurrentState();

			if (state.sections.length === 0) {
				stream.markdown('No sections found in the prompt. Please use XML-like tags to structure your prompt (e.g., `<context>...</context>`).');
				return { metadata: { command: 'visualize-prompt', sectionsCount: 0 } };
			}

			// Handle chat context for inline mode
			await this._controller.handleChatContext(context, request);

			// Render sections using the controller's inline mode
			const renderOptions: RenderOptions = {
				showActions: true,
				enableCollapse: true,
				showTokenBreakdown: true,
				mode: 'inline'
			};

			await this._controller.renderInline(stream, renderOptions);

			this._logService.trace(`Successfully visualized ${state.sections.length} sections`);

			const result: vscode.ChatResult = {
				metadata: {
					command: 'visualize-prompt',
					sectionsCount: state.sections.length,
					totalTokens: state.totalTokens
				}
			};

			// Provide follow-up prompts
			this._provideFollowUpPrompts(result, stream);

			return result;
		} catch (error) {
			this._logService.error('Error in _handleVisualizePrompt', error);
			stream.markdown(`❌ Failed to visualize prompt: ${error instanceof Error ? error.message : String(error)}`);
			return {
				errorDetails: {
					message: error instanceof Error ? error.message : String(error)
				}
			};
		}
	}

	/**
	 * Handle the /edit-section command
	 */
	private async _handleEditSection(
		request: vscode.ChatRequest,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<vscode.ChatResult> {
		try {
			this._logService.trace('PromptVisualizerChatParticipant: Handling edit-section command');

			// Parse the request to get section identifier
			const prompt = request.prompt.trim();

			if (!prompt) {
				stream.markdown('Please specify which section to edit. Usage: `/edit-section <section-tag-name>`');
				return { metadata: { command: 'edit-section', error: 'missing-section-id' } };
			}

			// Extract section identifier (tag name or index)
			const sectionIdentifier = prompt.split(/\s+/)[0];

			// Get current state
			const state = this._stateManager.getCurrentState();

			// Find the section by tag name or index
			let section = state.sections.find(s => s.tagName === sectionIdentifier);

			if (!section) {
				// Try to parse as index
				const index = parseInt(sectionIdentifier, 10);
				if (!isNaN(index) && index >= 0 && index < state.sections.length) {
					section = state.sections[index];
				}
			}

			if (!section) {
				stream.markdown(`❌ Section "${sectionIdentifier}" not found. Available sections: ${state.sections.map(s => `\`${s.tagName}\``).join(', ')}`);
				return { metadata: { command: 'edit-section', error: 'section-not-found' } };
			}

			// Show current section content
			stream.markdown(`## Editing Section: \`<${section.tagName}>\`\n\n**Current content:**\n\n`);
			stream.markdown(`\`\`\`\n${section.content}\n\`\`\`\n\n`);

			// Provide edit button
			stream.button({
				title: 'Edit in Editor',
				command: 'github.copilot.promptVisualizer.editSection',
				arguments: [section.id]
			});

			stream.markdown('\n\nClick the button above to edit this section in a dedicated editor.');

			this._logService.trace(`Edit section command completed for section: ${section.tagName}`);

			return {
				metadata: {
					command: 'edit-section',
					sectionId: section.id,
					sectionTagName: section.tagName
				}
			};
		} catch (error) {
			this._logService.error('Error in _handleEditSection', error);
			stream.markdown(`❌ Failed to edit section: ${error instanceof Error ? error.message : String(error)}`);
			return {
				errorDetails: {
					message: error instanceof Error ? error.message : String(error)
				}
			};
		}
	}

	/**
	 * Register follow-up handlers for multi-step interactions
	 */
	private _registerFollowUpHandlers(): void {
		// Listen for state changes to provide follow-up suggestions
		this._register(
			this._stateManager.onDidChangeState((state) => {
				this._logService.trace('State changed, follow-up actions may be available');
			})
		);
	}

	/**
	 * Handle follow-up for Edit action
	 * @internal Reserved for future use when command handlers are fully wired up
	 */
	// @ts-expect-error - Reserved for future use
	private async _handleEditFollowUp(
		sectionId: string,
		newContent: string,
		stream: vscode.ChatResponseStream
	): Promise<void> {
		try {
			// Update the section content
			this._stateManager.updateSection(sectionId, newContent);

			stream.markdown(`✅ Section updated successfully.\n\n`);

			// Provide follow-up actions
			stream.button({
				title: 'Visualize Updated Prompt',
				command: 'github.copilot.promptVisualizer.visualize'
			});

			stream.button({
				title: 'Undo Changes',
				command: 'github.copilot.promptVisualizer.undo'
			});
		} catch (error) {
			stream.markdown(`❌ Failed to update section: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Handle follow-up for Delete action
	 * @internal Reserved for future use when command handlers are fully wired up
	 */
	// @ts-expect-error - Reserved for future use
	private async _handleDeleteFollowUp(
		sectionId: string,
		stream: vscode.ChatResponseStream
	): Promise<void> {
		try {
			// Get section info before deleting
			const state = this._stateManager.getCurrentState();
			const section = state.sections.find(s => s.id === sectionId);

			if (!section) {
				stream.markdown(`❌ Section not found.`);
				return;
			}

			// Ask for confirmation using markdown
			stream.markdown(`⚠️ Are you sure you want to delete section \`<${section.tagName}>\`?\n\n`);

			// Provide confirmation buttons
			stream.button({
				title: 'Confirm Delete',
				command: 'github.copilot.promptVisualizer.confirmDelete',
				arguments: [sectionId]
			});

			stream.button({
				title: 'Cancel',
				command: 'github.copilot.promptVisualizer.cancelDelete'
			});

			// Store state for confirmation
			this._followUpState.set(`delete-${sectionId}`, { sectionId, tagName: section.tagName });
		} catch (error) {
			stream.markdown(`❌ Failed to delete section: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Handle follow-up for Add action
	 * @internal Reserved for future use when command handlers are fully wired up
	 */
	// @ts-expect-error - Reserved for future use
	private async _handleAddFollowUp(
		tagName: string,
		content: string,
		stream: vscode.ChatResponseStream
	): Promise<void> {
		try {
			// Add the new section
			this._stateManager.addSection(tagName, content);

			stream.markdown(`✅ Section \`<${tagName}>\` added successfully.\n\n`);

			// Provide follow-up actions
			stream.button({
				title: 'Visualize Updated Prompt',
				command: 'github.copilot.promptVisualizer.visualize'
			});

			stream.button({
				title: 'Add Another Section',
				command: 'github.copilot.promptVisualizer.addSection'
			});
		} catch (error) {
			stream.markdown(`❌ Failed to add section: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Provide follow-up prompts based on current state
	 */
	private _provideFollowUpPrompts(
		result: vscode.ChatResult,
		stream: vscode.ChatResponseStream
	): void {
		const metadata = result.metadata as PromptVisualizerChatMetadata | undefined;

		if (!metadata || metadata.command !== 'visualize-prompt') {
			return;
		}

		// Provide context-specific follow-up prompts
		if ((metadata.sectionsCount ?? 0) > 0) {
			stream.markdown('\n\n**What would you like to do next?**\n\n');

			stream.button({
				title: 'Edit a Section',
				command: 'github.copilot.promptVisualizer.editSection'
			});

			stream.button({
				title: 'Add New Section',
				command: 'github.copilot.promptVisualizer.addSection'
			});

			stream.button({
				title: 'Delete a Section',
				command: 'github.copilot.promptVisualizer.deleteSection'
			});
		}
	}

	override dispose(): void {
		this._followUpState.clear();
		super.dispose();
		this._logService.info('PromptVisualizerChatParticipant disposed');
	}
}
