/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IPromptStateManager } from '../common/services';
import { VisualizerState } from '../common/types';

type PromptSectionVisualizerMessage =
	| { type: 'updateSection'; sectionId: string; content: string }
	| { type: 'reorderSections'; newOrder: string[] }
	| { type: 'addSection'; tagName: string; content: string; position?: number }
	| { type: 'removeSection'; sectionId: string }
	| { type: 'toggleCollapse'; sectionId: string }
	| { type: 'switchMode'; sectionId: string; mode: 'view' | 'edit' }
	| { type: 'ready' };

/**
 * WebView provider for the Prompt Section Visualizer
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
	 */
	public updatePrompt(prompt: string): void {
		this._stateManager.updatePrompt(prompt);
	}

	/**
	 * Get the current edited prompt
	 */
	public getEditedPrompt(): string {
		const state = this._stateManager.getCurrentState();
		// This would be implemented by the state manager to reconstruct the prompt
		return state.sections.map(s => `<${s.tagName}>${s.content}</${s.tagName}>`).join('\n');
	}

	/**
	 * Show the visualizer panel
	 */
	public show(): void {
		if (this._view) {
			this._view.show?.(true);
		}
	}

	/**
	 * Hide the visualizer panel
	 */
	public hide(): void {
		if (this._view) {
			this._view.show?.(false);
		}
	}

	private _updateWebview(state: VisualizerState): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'updateState',
				state: state
			});
		}
	}

	private _handleWebviewMessage(rawMessage: unknown): void {
		if (!isPromptSectionVisualizerMessage(rawMessage)) {
			this._logService.warn('Unknown message type from webview');
			return;
		}

		const message = rawMessage;
		switch (message.type) {
			case 'updateSection':
				this._stateManager.updateSection(message.sectionId, message.content);
				break;
			case 'reorderSections':
				this._stateManager.reorderSections(message.newOrder);
				break;
			case 'addSection':
				this._stateManager.addSection(message.tagName, message.content, message.position);
				break;
			case 'removeSection':
				this._stateManager.removeSection(message.sectionId);
				break;
			case 'toggleCollapse':
				this._stateManager.toggleSectionCollapse(message.sectionId);
				break;
			case 'switchMode':
				this._stateManager.switchSectionMode(message.sectionId, message.mode);
				break;
			case 'ready':
				// Webview is ready, send current state
				this._updateWebview(this._stateManager.getCurrentState());
				break;
			default:
				this._logService.warn(`Unknown message type from webview: ${(message as { type: string }).type}`);
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'promptSectionVisualizer.js'));

		// Do the same for the stylesheet.
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'promptSectionVisualizer.css'));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">
				<title>Prompt Section Visualizer</title>
			</head>
			<body>
				<div id="root">
					<div class="loading">Loading...</div>
				</div>
				<script nonce="${nonce}" src="${scriptUri}"></script>
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

function isPromptSectionVisualizerMessage(message: unknown): message is PromptSectionVisualizerMessage {
	if (!message || typeof message !== 'object') {
		return false;
	}

	const candidate = message as { type?: unknown };
	switch (candidate.type) {
		case 'updateSection':
			return typeof (candidate as { sectionId?: unknown }).sectionId === 'string'
				&& typeof (candidate as { content?: unknown }).content === 'string';
		case 'reorderSections':
			return Array.isArray((candidate as { newOrder?: unknown }).newOrder);
		case 'addSection': {
			const { tagName, content } = candidate as { tagName?: unknown; content?: unknown };
			return typeof tagName === 'string' && typeof content === 'string';
		}
		case 'removeSection':
		case 'toggleCollapse': {
			const { sectionId } = candidate as { sectionId?: unknown };
			return typeof sectionId === 'string';
		}
		case 'switchMode': {
			const { sectionId, mode } = candidate as { sectionId?: unknown; mode?: unknown };
			return typeof sectionId === 'string' && (mode === 'view' || mode === 'edit');
		}
		case 'ready':
			return true;
		default:
			return false;
	}
}
