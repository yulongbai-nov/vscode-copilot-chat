/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { EditableChatRequest, LiveRequestSessionKey } from '../common/liveRequestEditorModel';
import { ILiveRequestEditorService, LiveRequestMetadataEvent } from '../common/liveRequestEditorService';

interface WebviewStatePayload {
	readonly label?: string;
	readonly content: string;
}

export class LiveRequestPayloadProvider extends Disposable implements vscode.WebviewViewProvider {
	public static readonly viewType = 'github.copilot.liveRequestPayload';

	private _view?: vscode.WebviewView;
	private readonly _requests = new Map<string, EditableChatRequest>();
	private _activeSessionKey?: string;
	private _metadata?: LiveRequestMetadataEvent['metadata'];
	private _lockedToSelection = false;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		@ILogService private readonly _logService: ILogService,
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService
	) {
		super();
		this._register(this._liveRequestEditorService.onDidChange(request => this._handleRequestUpdated(request)));
		this._register(this._liveRequestEditorService.onDidRemoveRequest(key => this._handleRequestRemoved(key)));
		this._register(this._liveRequestEditorService.onDidChangeMetadata(event => this._handleMetadataChanged(event)));
	}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};
		webviewView.webview.html = this._getHtml(webviewView.webview);
		this._register(webviewView.webview.onDidReceiveMessage(message => this._handleWebviewMessage(message)));
		this._postState();
	}

	private _handleRequestUpdated(request: EditableChatRequest): void {
		const key = this._toKey(request.sessionId, request.location);
		this._requests.set(key, request);
		if (this._lockedToSelection && this._activeSessionKey && this._activeSessionKey !== key) {
			return;
		}
		const incomingTimestamp = this._getTimestamp(request);
		const active = this._activeSessionKey ? this._requests.get(this._activeSessionKey) : undefined;
		const activeTimestamp = active ? this._getTimestamp(active) : 0;
		if (!this._activeSessionKey || (!this._lockedToSelection && incomingTimestamp >= activeTimestamp)) {
			this._activeSessionKey = key;
		}
		this._postState();
	}

	private _handleRequestRemoved(key: LiveRequestSessionKey): void {
		const composite = this._toKey(key.sessionId, key.location);
		this._requests.delete(composite);
		if (this._activeSessionKey === composite) {
			this._activeSessionKey = undefined;
			if (this._metadata && this._metadata.sessionId === key.sessionId && this._metadata.location === key.location) {
				this._metadata = undefined;
			}
		}
		this._postState();
	}

	public setActiveSession(sessionKey?: { sessionId?: string; location?: number } | string): void {
		if (!sessionKey) {
			this._lockedToSelection = false;
			this._activeSessionKey = undefined;
			this._postState();
			return;
		}
		let composite: string | undefined;
		if (typeof sessionKey === 'string') {
			composite = sessionKey;
		} else if (sessionKey.sessionId && typeof sessionKey.location === 'number') {
			composite = this._toKey(sessionKey.sessionId, sessionKey.location as ChatLocation);
		}
		if (!composite) {
			return;
		}
		this._lockedToSelection = true;
		this._activeSessionKey = composite;
		this._postState();
	}

	private _handleMetadataChanged(event: LiveRequestMetadataEvent): void {
		if (event.metadata) {
			this._metadata = event.metadata;
			if (!this._lockedToSelection) {
				this._activeSessionKey = this._toKey(event.metadata.sessionId, event.metadata.location as ChatLocation);
			}
		} else if (
			this._metadata &&
			this._metadata.sessionId === event.key.sessionId &&
			this._metadata.location === event.key.location
		) {
			this._metadata = undefined;
			if (this._activeSessionKey === this._toKey(event.key.sessionId, event.key.location)) {
				this._activeSessionKey = undefined;
			}
		}
		this._postState();
	}

	private async _handleWebviewMessage(message: unknown): Promise<void> {
		if (typeof message !== 'object' || !message) {
			return;
		}
		const typed = message as { type?: string; content?: string };
		if (typed.type === 'copy' && typeof typed.content === 'string') {
			try {
				await vscode.env.clipboard.writeText(typed.content);
				vscode.window.setStatusBarMessage('Payload copied to clipboard', 1500);
			} catch (error) {
				this._logService.error('LiveRequestPayloadProvider: failed to copy payload', error);
			}
		}
		if (typed.type === 'openInEditor' && typeof typed.content === 'string') {
			try {
				const document = await vscode.workspace.openTextDocument({
					content: typed.content,
					language: 'json'
				});
				await vscode.window.showTextDocument(document, { preview: true });
			} catch (error) {
				this._logService.error('LiveRequestPayloadProvider: failed to open payload in editor', error);
			}
		}
	}

	private _postState(): void {
		if (!this._view) {
			return;
		}
		const active = this._getActiveRequest();
		const state: WebviewStatePayload = active
			? { label: this._buildLabel(active), content: JSON.stringify(active.messages ?? [], undefined, 2) }
			: { content: '// No active live request found.' };

		this._view.webview.postMessage({ type: 'state', payload: state }).then(undefined, error =>
			this._logService.error('LiveRequestPayloadProvider: failed to post payload state', error)
		);
	}

	private _getActiveRequest(): EditableChatRequest | undefined {
		if (this._activeSessionKey) {
			const request = this._requests.get(this._activeSessionKey);
			if (request) {
				return request;
			}
		}

		if (this._metadata) {
			const request = this._requests.get(this._toKey(this._metadata.sessionId, this._metadata.location as ChatLocation));
			if (request) {
				this._activeSessionKey = this._toKey(request.sessionId, request.location);
				return request;
			}
		}

		let candidate: EditableChatRequest | undefined;
		let latest = 0;
		for (const request of this._requests.values()) {
			const updated = request.metadata.lastUpdated ?? request.metadata.createdAt ?? 0;
			if (updated >= latest) {
				candidate = request;
				latest = updated;
			}
		}
		if (candidate) {
			this._activeSessionKey = this._toKey(candidate.sessionId, candidate.location);
		}
		return candidate;
	}

	private _getTimestamp(request: EditableChatRequest): number {
		return request.metadata?.lastUpdated ?? request.metadata?.createdAt ?? 0;
	}

	private _buildLabel(request: EditableChatRequest): string {
		const sessionSuffix = request.sessionId.slice(-6);
		const requestId = request.metadata.requestId;
		const parts = [
			request.debugName || 'Live request',
			`session ${sessionSuffix}`,
			requestId ? `request ${requestId.slice(-6)}` : undefined,
			request.location
		].filter(Boolean);
		return parts.join(' • ');
	}

	private _getHtml(webview: vscode.Webview): string {
		const nonce = this._nonce();
		return /* html */ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8" />
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource
			} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
					<meta name="viewport" content="width=device-width, initial-scale=1.0" />
					<title>Live Request Payload</title>
					<style>
						:root {
							color-scheme: light dark;
						}
						body {
							margin: 0;
							font-family: var(--vscode-font-family);
							font-size: var(--vscode-font-size);
							color: var(--vscode-foreground);
							background-color: var(--vscode-editor-background);
						}
						.container {
							padding: 8px;
							box-sizing: border-box;
							height: 100vh;
							display: flex;
							flex-direction: column;
							gap: 8px;
						}
						.header {
							display: flex;
							align-items: center;
							justify-content: space-between;
							gap: 8px;
						}
						.title {
							font-weight: 600;
						}
						.subtitle {
							color: var(--vscode-descriptionForeground);
							font-size: 12px;
							margin-top: 2px;
						}
						.actions {
							display: flex;
							gap: 6px;
						}
						button {
							background: var(--vscode-button-secondaryBackground);
							color: var(--vscode-button-secondaryForeground);
							border: 1px solid var(--vscode-button-border, transparent);
							border-radius: 4px;
							padding: 4px 8px;
							cursor: pointer;
						}
						button:hover {
							background: var(--vscode-button-secondaryHoverBackground);
						}
						pre {
							margin: 0;
							padding: 8px;
							background: var(--vscode-editorWidget-background);
							border: 1px solid var(--vscode-panel-border);
							border-radius: 6px;
							white-space: pre;
							overflow: auto;
							user-select: text;
							font-family: var(--vscode-editor-font-family, monospace);
							font-size: 12px;
							flex: 1;
						}
					</style>
				</head>
				<body>
					<div class="container">
						<div class="header">
							<div>
								<div class="title">Raw Payload</div>
								<div class="subtitle" id="subtitle"></div>
							</div>
							<div class="actions">
								<button id="copy" title="Copy payload to clipboard">Copy</button>
								<button id="open" title="Open payload in an editor">Open in editor</button>
							</div>
						</div>
						<pre id="payload">// No active live request found.</pre>
					</div>
					<script nonce="${nonce}">
						const vscode = acquireVsCodeApi();
						const payloadEl = document.getElementById('payload');
						const subtitle = document.getElementById('subtitle');
						window.addEventListener('message', event => {
							if (event.data?.type !== 'state') {
								return;
							}
							const payload = event.data.payload;
							payloadEl.textContent = payload?.content ?? '// No active live request found.';
							subtitle.textContent = payload?.label ?? 'Awaiting an intercepted chat request...';
						});
						document.getElementById('copy')?.addEventListener('click', () => {
							vscode.postMessage({ type: 'copy', content: payloadEl.textContent ?? '' });
						});
						document.getElementById('open')?.addEventListener('click', () => {
							vscode.postMessage({ type: 'openInEditor', content: payloadEl.textContent ?? '' });
						});
					</script>
				</body>
			</html>
		`;
	}

	private _nonce(): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let value = '';
		for (let i = 0; i < 16; i++) {
			value += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return value;
	}

	private _toKey(sessionId: string, location: ChatLocation): string {
		return `${sessionId}::${location}`;
	}
}
