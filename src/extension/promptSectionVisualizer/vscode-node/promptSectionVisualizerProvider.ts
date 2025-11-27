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
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		this._register(webviewView.webview.onDidReceiveMessage(message => {
			this._handleWebviewMessage(message);
		}));

		this._postStateToWebview(this._stateManager.getCurrentState());
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
		this._postStateToWebview(state);
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
	private async _handleWebviewMessage(message: unknown): Promise<void> {
		const payload = message as { type?: string; command?: string; args?: unknown[] };

		if (payload?.type === 'command' && typeof payload.command === 'string') {
			try {
				await vscode.commands.executeCommand(payload.command, ...(payload.args ?? []));
			} catch (error) {
				this._logService.error(
					`Prompt visualizer webview failed to execute command ${payload.command}`,
					error
				);
			}
			return;
		}

		this._logService.trace('Prompt visualizer webview message ignored (no handler)');
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<link href="${styleResetUri}" rel="stylesheet">
					<link href="${styleVSCodeUri}" rel="stylesheet">
					<title>Prompt Section Visualizer</title>
					<style>
						:root { color-scheme: light dark; }
						body {
							margin: 0;
							padding: 0;
							font-family: var(--vscode-font-family);
							background: var(--vscode-editor-background);
							color: var(--vscode-foreground);
						}
						#app { padding: 16px; }
						.header {
							display: flex;
							justify-content: space-between;
							align-items: center;
							margin-bottom: 12px;
						}
						.section {
							border: 1px solid var(--vscode-panel-border);
							border-radius: 6px;
							padding: 12px;
							margin-bottom: 12px;
							background: var(--vscode-sideBar-background);
						}
						.section.collapsed .section-content { display: none; }
						.section-header {
							display: flex;
							justify-content: space-between;
							cursor: pointer;
						}
						.section-title { font-weight: 600; }
						.section-content {
							margin-top: 8px;
							white-space: pre-wrap;
							font-family: var(--vscode-editor-font-family);
							font-size: 13px;
						}
						.section-actions, .global-actions {
							display: flex;
							gap: 8px;
							flex-wrap: wrap;
						}
						.section-actions { margin-top: 8px; }
						button.command {
							border: 1px solid var(--vscode-button-secondaryBorder, transparent);
							color: var(--vscode-button-secondaryForeground);
							background: var(--vscode-button-secondaryBackground);
							padding: 4px 8px;
							border-radius: 4px;
							cursor: pointer;
							font-size: 12px;
						}
						.empty-state {
							border: 1px dashed var(--vscode-panel-border);
							padding: 16px;
							text-align: center;
							border-radius: 6px;
							color: var(--vscode-descriptionForeground);
						}
					</style>
				</head>
				<body>
					<div id="app">
						<div class="empty-state">
							<p>Loading prompt sections…</p>
						</div>
					</div>
					<script nonce="${nonce}">
						(function () {
							const vscode = acquireVsCodeApi();
							const app = document.getElementById('app');

							const escapeHtml = (value) => {
								if (!value) {
									return '';
								}
								const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\\'': '&#39;' };
								return value.replace(/[&<>"']/g, m => map[m]);
							};

							const sendCommand = (command, arg) => {
								vscode.postMessage({
									type: 'command',
									command,
									args: typeof arg !== 'undefined' ? [arg] : []
								});
							};

							const render = (state) => {
								if (!state || !Array.isArray(state.sections) || state.sections.length === 0) {
									app.innerHTML = \`
										<div class="empty-state">
											<p>No prompt sections found.</p>
											<p>Paste a prompt with XML-like tags (for example, &lt;context&gt;...&lt;/context&gt;)</p>
										</div>
									\`;
									return;
								}

								const total = state.sections.reduce((sum, section) => sum + (section.tokenCount || 0), 0);

								let html = '';
								html += \`
									<div class="header">
										<div>
											<h2 style="margin:0;">Prompt Section Visualizer</h2>
											<div>Total tokens: <strong>\${total}</strong></div>
										</div>
										<div class="global-actions">
											<button class="command" data-command="github.copilot.promptSectionVisualizer.addSection">Add Section</button>
											<button class="command" data-command="github.copilot.promptSectionVisualizer.refresh">Refresh</button>
										</div>
									</div>
								\`;

								for (const section of state.sections) {
									const collapseIcon = section.isCollapsed ? '▶' : '▼';
									const tokenInfo = section.tokenCount !== undefined ? \`(\${section.tokenCount} tokens)\` : '';
									const warning = section.warningLevel && section.warningLevel !== 'normal'
										? \`<span style="color: var(--vscode-editorWarning-foreground); font-size: 12px;">\${section.warningLevel}</span>\`
										: '';

									html += \`
										<div class="section \${section.isCollapsed ? 'collapsed' : ''}" data-section-id="\${section.id}">
											<div class="section-header" data-toggle="\${section.id}">
												<div class="section-title">\${collapseIcon} &lt;\${section.tagName}&gt; \${tokenInfo}</div>
												<div>\${warning}</div>
											</div>
											<div class="section-content">\${escapeHtml(section.content || '')}</div>
											<div class="section-actions">
												<button class="command" data-command="github.copilot.promptSectionVisualizer.editSection" data-arg="\${section.id}">Edit</button>
												<button class="command" data-command="github.copilot.promptSectionVisualizer.deleteSection" data-arg="\${section.id}">Delete</button>
												<button class="command" data-command="github.copilot.promptSectionVisualizer.moveSectionUp" data-arg="\${section.id}">Move Up</button>
												<button class="command" data-command="github.copilot.promptSectionVisualizer.moveSectionDown" data-arg="\${section.id}">Move Down</button>
											</div>
										</div>
									\`;
								}

								app.innerHTML = html;

								app.querySelectorAll('[data-command]').forEach(node => {
									node.addEventListener('click', event => {
										event.stopPropagation();
										const command = node.getAttribute('data-command');
										const arg = node.getAttribute('data-arg');
										if (command) {
											sendCommand(command, arg ?? undefined);
										}
									});
								});

								app.querySelectorAll('[data-toggle]').forEach(node => {
									node.addEventListener('click', () => {
										const sectionId = node.getAttribute('data-toggle');
										if (sectionId) {
											sendCommand('github.copilot.promptSectionVisualizer.toggleCollapse', sectionId);
										}
									});
								});
							};

							window.addEventListener('message', event => {
								if (event.data?.type === 'stateUpdate') {
									render(event.data.state);
								}
							});
						}());
					</script>
				</body>
			</html>
		`;
	}

	private _postStateToWebview(state: VisualizerState): void {
		if (!this._view) {
			return;
		}

		this._view.webview.postMessage({
			type: 'stateUpdate',
			state
		}).then(undefined, error => this._logService.error('Failed to post prompt visualizer state', error));
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
