/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IPromptStateManager } from '../common/services';
import { VisualizerState } from '../common/types';

/**
 * WebView provider for the Prompt Section Visualizer
 *
 * @deprecated This custom WebView implementation is deprecated and will be removed in a future version.
 * The Prompt Section Visualizer now uses VS Code's native Chat API for rendering (NativeChatRenderer)
 * and the PromptVisualizerChatParticipant for chat integration.
 *
 * Migration Guide:
 * ----------------
 *
 * ### For Users:
 * - The visualizer now integrates directly with VS Code's Copilot Chat interface
 * - Use the `/visualize-prompt` command in chat to visualize prompt sections
 * - Use the `/edit-section` command in chat to edit specific sections
 * - All existing features (token counting, section management) are preserved
 * - The new implementation provides better visual consistency and accessibility
 *
 * ### For Developers:
 * - Replace usage of `PromptSectionVisualizerProvider` with `PromptVisualizerController`
 * - Use `NativeChatRenderer` for rendering sections with native chat components
 * - Use `PromptVisualizerChatParticipant` for chat command handling
 * - Custom WebView message passing is replaced by VS Code command system
 * - See design.md for detailed architecture and migration path
 *
 * ### Key Changes:
 * 1. Rendering: Custom HTML/CSS/JS → ChatResponseMarkdownPart, ChatResponseCommandButtonPart, etc.
 * 2. Editing: Custom WebView inputs → VS Code native editor or inline chat widgets
 * 3. Actions: WebView messages → VS Code commands (github.copilot.promptVisualizer.*)
 * 4. Theming: Custom CSS variables → Automatic VS Code theme support
 * 5. Accessibility: Custom ARIA → Built-in VS Code accessibility features
 *
 * ### Benefits:
 * - ~1700 lines of code removed (custom HTML/CSS/JS)
 * - Automatic theme support (light, dark, high contrast)
 * - Built-in accessibility (screen readers, keyboard navigation)
 * - Visual consistency with Copilot Chat interface
 * - Reduced maintenance burden
 *
 * This class is maintained for backward compatibility during the transition period.
 * It will be removed once the feature flag `github.copilot.promptVisualizer.useNativeRendering`
 * is enabled by default and the gradual rollout is complete.
 */
export class PromptSectionVisualizerProvider extends Disposable implements vscode.WebviewViewProvider {
	public static readonly viewType = 'github.copilot.promptSectionVisualizer';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		@ILogService private readonly _logService: ILogService,
		@IPromptStateManager private readonly _stateManager: IPromptStateManager
	) {
		super();

		// Listen to state changes
		this._register(this._stateManager.onDidChangeState(state => {
			this._updateWebview(state);
		}));
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview
		this._register(webviewView.webview.onDidReceiveMessage(message => {
			this._handleWebviewMessage(message);
		}));

		// Send initial state
		this._updateWebview(this._stateManager.getCurrentState());
	}

	/**
	 * Update prompt content from external source (e.g., chat input)
	 * @deprecated Use PromptVisualizerController.renderInline() with NativeChatRenderer instead
	 */
	public updatePrompt(prompt: string): void {
		this._stateManager.updatePrompt(prompt);
	}

	/**
	 * Get the current edited prompt
	 * @deprecated Use IPromptStateManager.getCurrentState() directly instead
	 */
	public getEditedPrompt(): string {
		const state = this._stateManager.getCurrentState();
		// This would be implemented by the state manager to reconstruct the prompt
		return state.sections.map(s => `<${s.tagName}>${s.content}</${s.tagName}>`).join('\n');
	}

	/**
	 * Show the visualizer panel
	 * @deprecated Use PromptVisualizerController.renderStandalone() or renderInline() instead
	 */
	public show(): void {
		if (this._view) {
			this._view.show?.(true);
		}
	}

	/**
	 * Hide the visualizer panel
	 * @deprecated Panel visibility is now managed by VS Code's chat interface
	 */
	public hide(): void {
		if (this._view) {
			this._view.show?.(false);
		}
	}

	/**
	 * Check if the webview is currently visible
	 * @deprecated Panel visibility is now managed by VS Code's chat interface
	 */
	public isVisible(): boolean {
		return this._view?.visible ?? false;
	}

	/**
	 * Get the current state for rendering
	 */
	public getCurrentState(): VisualizerState {
		return this._stateManager.getCurrentState();
	}

	/**
	 * @deprecated Custom WebView message passing is replaced by VS Code command system.
	 * Use commands like github.copilot.promptVisualizer.editSection instead.
	 *
	 * This method is kept for backward compatibility but no longer sends messages
	 * since the custom WebView UI has been removed and replaced with a migration notice.
	 */
	private _updateWebview(state: VisualizerState): void {
		// Custom WebView message passing has been removed
		// The WebView now shows a static migration notice
		this._logService.trace('WebView update skipped - custom UI has been removed');
	}

	/**
	 * @deprecated Custom WebView message passing is replaced by VS Code command system.
	 * Actions are now handled through registered commands in PromptSectionVisualizerContribution.
	 *
	 * This method is kept for backward compatibility but no longer processes messages
	 * since the custom WebView UI has been removed. All actions should now use VS Code commands:
	 * - github.copilot.promptVisualizer.editSection
	 * - github.copilot.promptVisualizer.deleteSection
	 * - github.copilot.promptVisualizer.addSection
	 * - github.copilot.promptVisualizer.toggleCollapse
	 * - github.copilot.promptVisualizer.moveSectionUp
	 * - github.copilot.promptVisualizer.moveSectionDown
	 */
	private _handleWebviewMessage(message: unknown): void {
		const messageType = typeof (message as { type?: unknown })?.type === 'string'
			? String((message as { type: string }).type)
			: 'unknown';
		// Custom WebView message passing has been removed
		// All actions are now handled through VS Code commands
		this._logService.trace(`Received deprecated webview message: ${messageType}`);
		this._logService.info('WebView message passing is deprecated. Please use VS Code commands instead.');
	}

	/**
	 * @deprecated Custom HTML/CSS/JS rendering is replaced by VS Code's native Chat API.
	 * Use NativeChatRenderer with ChatResponseMarkdownPart, ChatResponseCommandButtonPart, etc.
	 *
	 * The custom files (promptSectionVisualizer.js, promptSectionVisualizer.css) have been removed.
	 * This method now returns a minimal placeholder HTML indicating the feature has been migrated.
	 */
	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Custom WebView files have been removed as part of the migration to native Chat API
		// This provides a minimal placeholder for backward compatibility
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));

		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<title>Prompt Section Visualizer</title>
				<style nonce="${nonce}">
					body {
						padding: 20px;
						font-family: var(--vscode-font-family);
						color: var(--vscode-foreground);
					}
					.migration-notice {
						background: var(--vscode-textBlockQuote-background);
						border-left: 4px solid var(--vscode-textLink-foreground);
						padding: 16px;
						margin: 20px 0;
					}
					.migration-notice h2 {
						margin-top: 0;
						color: var(--vscode-textLink-foreground);
					}
					.migration-notice code {
						background: var(--vscode-textCodeBlock-background);
						padding: 2px 6px;
						border-radius: 3px;
					}
				</style>
			</head>
			<body>
				<div class="migration-notice">
					<h2>⚠️ This view has been migrated</h2>
					<p>The Prompt Section Visualizer now uses VS Code's native Chat API for a better experience.</p>
					<p><strong>To use the visualizer:</strong></p>
					<ul>
						<li>Open Copilot Chat</li>
						<li>Type <code>/visualize-prompt</code> to visualize prompt sections</li>
						<li>Type <code>/edit-section</code> to edit specific sections</li>
					</ul>
					<p>This standalone WebView panel is deprecated and will be removed in a future version.</p>
				</div>
			</body>
			</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
