/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { EditableChatRequest } from '../common/liveRequestEditorModel';
import { ILiveRequestEditorService, PromptInterceptionAction, PromptInterceptionState } from '../common/liveRequestEditorService';
import { LIVE_REQUEST_EDITOR_VISIBLE_CONTEXT_KEY } from './liveRequestEditorContextKeys';

/**
 * WebView provider for the Live Request Editor / Prompt Inspector panel.
 * Displays the composed ChatML request sections before sending to the LLM,
 * allowing advanced users to inspect and edit individual prompt sections.
 *
 * Security note: The standalone webview bundle renders content via DOM APIs and
 * never injects unescaped user data. All interactive code now lives in
 * src/extension/prompt/webview/vscode/liveRequestEditor/.
 */
export class LiveRequestEditorProvider extends Disposable implements vscode.WebviewViewProvider {
	public static readonly viewType = 'github.copilot.liveRequestEditor';

	private _view?: vscode.WebviewView;
	private _currentRequest?: EditableChatRequest;
	private _interceptionState: PromptInterceptionState;
	private _lastInterceptNonce?: number;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		@ILogService private readonly _logService: ILogService,
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService
	) {
		super();
		this._interceptionState = this._liveRequestEditorService.getInterceptionState();
		this._setVisibilityContext(false);

		// Listen for changes to the live request
		this._register(this._liveRequestEditorService.onDidChange(request => {
			this._currentRequest = request;
			this._updateWebview();
		}));
		this._register(this._liveRequestEditorService.onDidChangeInterception(state => {
			this._handleInterceptionStateChanged(state);
			this._updateWebview();
		}));
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		this._register(webviewView.webview.onDidReceiveMessage(message => {
			this._handleWebviewMessage(message);
		}));
		this._register(webviewView.onDidChangeVisibility(() => this._updateVisibilityContext()));
		this._register(webviewView.onDidDispose(() => this._setVisibilityContext(false)));
		this._updateVisibilityContext();

		// Send initial state if available
		if (this._currentRequest) {
			this._postStateToWebview();
		}
	}

	/**
	 * Show the panel
	 */
	public show(): void {
		if (this._view) {
			this._view.show?.(true);
			this._setVisibilityContext(true);
		}
	}

	/**
	 * Check if the webview is currently visible
	 */
	public isVisible(): boolean {
		return this._view?.visible ?? false;
	}

	/**
	 * Get the current request being edited
	 */
	public getCurrentRequest(): EditableChatRequest | undefined {
		return this._currentRequest;
	}

	private _updateWebview(): void {
		this._postStateToWebview();
	}

	private _updateVisibilityContext(): void {
		this._setVisibilityContext(this.isVisible());
	}

	private _setVisibilityContext(visible: boolean): void {
		void vscode.commands.executeCommand('setContext', LIVE_REQUEST_EDITOR_VISIBLE_CONTEXT_KEY, visible);
	}

	private _handleInterceptionStateChanged(state: PromptInterceptionState): void {
		this._interceptionState = state;
		if (state.pending) {
			if (state.pending.nonce !== this._lastInterceptNonce) {
				this._lastInterceptNonce = state.pending.nonce;
				this.show();
			}
		} else {
			this._lastInterceptNonce = undefined;
		}
	}

	private async _handleWebviewMessage(message: unknown): Promise<void> {
		const payload = message as {
			type?: string;
			command?: string;
			sectionId?: string;
			content?: string;
			args?: unknown[];
		};

		if (!payload?.type) {
			return;
		}

		try {
			switch (payload.type) {
				case 'editSection':
					if (payload.sectionId && payload.content !== undefined && this._currentRequest) {
						this._liveRequestEditorService.updateSectionContent(
							{ sessionId: this._currentRequest.sessionId, location: this._currentRequest.location },
							payload.sectionId,
							payload.content
						);
					}
					break;

				case 'deleteSection':
					if (payload.sectionId && this._currentRequest) {
						this._liveRequestEditorService.deleteSection(
							{ sessionId: this._currentRequest.sessionId, location: this._currentRequest.location },
							payload.sectionId
						);
					}
					break;

				case 'restoreSection':
					if (payload.sectionId && this._currentRequest) {
						this._liveRequestEditorService.restoreSection(
							{ sessionId: this._currentRequest.sessionId, location: this._currentRequest.location },
							payload.sectionId
						);
					}
					break;

				case 'resetRequest':
					if (this._currentRequest) {
						this._liveRequestEditorService.resetRequest(
							{ sessionId: this._currentRequest.sessionId, location: this._currentRequest.location }
						);
					}
					break;

				case 'toggleCollapse':
					if (payload.sectionId && this._currentRequest) {
						const section = this._currentRequest.sections.find(s => s.id === payload.sectionId);
						if (section) {
							section.collapsed = !section.collapsed;
							this._postStateToWebview();
						}
					}
					break;

				case 'resumeSend':
					this._resolvePendingIntercept('resume');
					break;

				case 'cancelIntercept':
					this._resolvePendingIntercept('cancel', 'user');
					break;

				case 'command':
					if (typeof payload.command === 'string') {
						await vscode.commands.executeCommand(payload.command, ...(payload.args ?? []));
					}
					break;

				default:
					this._logService.trace(`Live Request Editor: unhandled message type: ${payload.type}`);
			}
		} catch (error) {
			this._logService.error('Live Request Editor: failed to handle webview message', error);
		}
	}


	private _getHtmlForWebview(webview: vscode.Webview): string {
		const nonce = getNonce();
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleAppUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'liveRequestEditor.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'liveRequestEditorWebview.js'));

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>Live Request Editor</title>
					<link rel="stylesheet" href="${styleResetUri}">
					<link rel="stylesheet" href="${styleVSCodeUri}">
					<link rel="stylesheet" href="${styleAppUri}">
				</head>
				<body>
					<div id="app">
						<div class="empty-state">
							<p><strong>Live Request Editor</strong></p>
							<p>Waiting for a chat request...</p>
							<p style="font-size: 12px;">Start a conversation in the chat panel to inspect and edit the prompt.</p>
						</div>
					</div>
					<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`;
	}

	private _postStateToWebview(): void {
		if (!this._view) {
			return;
		}

		this._view.webview.postMessage({
			type: 'stateUpdate',
			request: this._currentRequest,
			interception: this._toWebviewInterceptionPayload()
		}).then(undefined, error => this._logService.error('Live Request Editor: failed to post state', error));
	}

	private _toWebviewInterceptionPayload() {
		const state = this._interceptionState;
		return {
			enabled: state.enabled,
			pending: state.pending ? {
				debugName: state.pending.debugName,
				nonce: state.pending.nonce,
			} : undefined
		};
	}

	private _resolvePendingIntercept(action: PromptInterceptionAction, reason?: string): void {
		if (!this._currentRequest) {
			return;
		}
		this._liveRequestEditorService.resolvePendingIntercept(
			{ sessionId: this._currentRequest.sessionId, location: this._currentRequest.location },
			action,
			reason ? { reason } : undefined
		);
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
