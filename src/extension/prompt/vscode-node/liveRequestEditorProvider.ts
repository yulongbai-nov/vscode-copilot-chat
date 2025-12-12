/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { EditableChatRequest, LiveRequestOverrideScope, LiveRequestSessionKey } from '../common/liveRequestEditorModel';
import { ILiveRequestEditorService, LiveRequestEditorMode, LiveRequestMetadataEvent, PromptInterceptionAction, PromptInterceptionState } from '../common/liveRequestEditorService';
import { LIVE_REQUEST_EDITOR_VISIBLE_CONTEXT_KEY } from './liveRequestEditorContextKeys';

type InspectorExtraSection = 'requestOptions' | 'telemetry' | 'rawRequest';

type WebviewMessage =
	| { type: 'setMode'; mode: LiveRequestEditorMode }
	| { type: 'beginAutoOverrideCapture' }
	| { type: 'clearAutoOverrides'; scope?: LiveRequestOverrideScope }
	| { type: 'editSection'; sectionId: string; content: string }
	| { type: 'deleteSection'; sectionId: string }
	| { type: 'restoreSection'; sectionId: string }
	| { type: 'resetRequest' }
	| { type: 'resumeSend' }
	| { type: 'cancelIntercept' }
	| { type: 'command'; command: string; args?: unknown[] }
	| { type: 'selectSession'; sessionKey: string }
	| { type: 'showOverrideDiff'; slotIndex: number; scope: LiveRequestOverrideScope; sessionKey?: string };

interface SessionSummaryPayload {
	key: string;
	sessionId: string;
	location: ChatLocation;
	label: string;
	locationLabel: string;
	sessionTail: string;
	isActive: boolean;
	isLatest: boolean;
	model: string;
	isDirty: boolean;
	lastUpdated?: number;
	debugName: string;
	createdAt?: number;
}

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
	private readonly _requests = new Map<string, EditableChatRequest>();
	private _activeSessionKey?: string;
	private _focusCommandAvailable?: boolean;
	private _extraSections: InspectorExtraSection[];
	private _autoOverrideScopePrompted = false;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		@ILogService private readonly _logService: ILogService,
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService
	) {
		super();
		this._interceptionState = this._liveRequestEditorService.getInterceptionState();
		this._setVisibilityContext(false);
		this._extraSections = this._readExtraSectionsSetting();

		// Listen for changes to the live request
		this._register(this._liveRequestEditorService.onDidChange(request => {
			this._handleRequestUpdated(request);
		}));
		this._register(this._liveRequestEditorService.onDidRemoveRequest(key => {
			this._handleRequestRemoved(key);
		}));
		this._register(this._liveRequestEditorService.onDidChangeInterception(state => {
			this._handleInterceptionStateChanged(state);
			this._updateWebview();
		}));
		this._register(this._liveRequestEditorService.onDidChangeMetadata(event => {
			this._handleMetadataChanged(event);
		}));
		this._register(vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('github.copilot.chat.promptInspector.extraSections')) {
				this._extraSections = this._readExtraSectionsSetting();
				this._postStateToWebview();
			}
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
		this._postStateToWebview();
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
				void this._ensureViewVisible();
			}
		} else {
			this._lastInterceptNonce = undefined;
		}
		if (state.mode === 'autoOverride') {
			if (!state.autoOverride?.scope && !this._autoOverrideScopePrompted) {
				this._autoOverrideScopePrompted = true;
				void vscode.commands.executeCommand('github.copilot.liveRequestEditor.configureAutoOverrideScope');
			} else if (state.autoOverride?.scope) {
				this._autoOverrideScopePrompted = false;
			}
		} else {
			this._autoOverrideScopePrompted = false;
		}
	}

	private async _ensureViewVisible(): Promise<void> {
		if (this._view) {
			this.show();
			return;
		}
		if (this._focusCommandAvailable === false) {
			return;
		}
		if (this._focusCommandAvailable === undefined) {
			try {
				const commands = await vscode.commands.getCommands(true);
				this._focusCommandAvailable = commands.includes('github.copilot.liveRequestEditor.focus');
			} catch (error) {
				this._focusCommandAvailable = false;
				this._logService.error('Live Request Editor: failed to enumerate commands for auto-show', error);
				return;
			}
		}
		if (!this._focusCommandAvailable) {
			return;
		}
		try {
			await vscode.commands.executeCommand('github.copilot.liveRequestEditor.focus');
			if (!this._view) {
				this._logService.warn('Live Request Editor: focus command did not instantiate the view during interception.');
			}
		} catch (error) {
			this._focusCommandAvailable = false;
			this._logService.error('Live Request Editor: failed to auto-show on interception', error);
		}
	}

	private async _handleWebviewMessage(message: unknown): Promise<void> {
		const payload = message as WebviewMessage;

		if (!payload?.type) {
			return;
		}

		try {
			switch (payload.type) {
				case 'setMode': {
					const message = payload as { mode?: string };
					if (typeof message.mode === 'string') {
						await this._liveRequestEditorService.setMode(message.mode as LiveRequestEditorMode);
					}
					break;
				}
				case 'beginAutoOverrideCapture':
					if (this._currentRequest) {
						this._liveRequestEditorService.beginAutoOverrideCapture({ sessionId: this._currentRequest.sessionId, location: this._currentRequest.location });
					}
					break;
				case 'clearAutoOverrides': {
					const message = payload as { scope?: LiveRequestOverrideScope };
					await this._liveRequestEditorService.clearAutoOverrides(message.scope);
					break;
				}
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
				case 'showOverrideDiff': {
					const message = payload;
					if (typeof message.slotIndex === 'number') {
						const sessionKey = typeof message.sessionKey === 'string'
							? this._fromCompositeKey(message.sessionKey)
							: this._currentRequest ? { sessionId: this._currentRequest.sessionId, location: this._currentRequest.location } : undefined;
						await this._showOverrideDiff(message.scope, message.slotIndex, sessionKey);
					}
					break;
				}
				case 'selectSession':
					if (typeof payload.sessionKey === 'string') {
						this._activateSessionByKey(payload.sessionKey);
					}
					break;

				default: {
					const exhaustive: never = payload;
					void exhaustive;
					this._logService.trace('Live Request Editor: unhandled message type.');
					break;
				}
			}
		} catch (error) {
			this._logService.error('Live Request Editor: failed to handle webview message', error);
		}
	}


	private _handleRequestUpdated(request: EditableChatRequest): void {
		const key = this._toCompositeKey(request.sessionId, request.location);
		this._requests.set(key, request);
		const pendingCompositeKey = this._getPendingCompositeKey();
		const shouldActivate = !this._activeSessionKey
			|| this._activeSessionKey === key
			|| (pendingCompositeKey !== undefined && pendingCompositeKey === key);
		if (shouldActivate) {
			this._activeSessionKey = key;
			this._currentRequest = request;
		}
		this._postStateToWebview();
	}

	private _handleRequestRemoved(key: LiveRequestSessionKey): void {
		const compositeKey = this._toCompositeKey(key.sessionId, key.location);
		const wasActive = this._activeSessionKey === compositeKey;
		this._requests.delete(compositeKey);
		if (wasActive) {
			const nextKey = this._requests.keys().next().value as string | undefined;
			this._activeSessionKey = nextKey;
			this._currentRequest = nextKey ? this._requests.get(nextKey) : undefined;
		} else if (!this._requests.size) {
			this._activeSessionKey = undefined;
			this._currentRequest = undefined;
		}
		this._postStateToWebview();
	}

	private _activateSessionByKey(compositeKey: string): void {
		if (!compositeKey) {
			return;
		}
		const next = this._requests.get(compositeKey);
		if (!next) {
			this._logService.warn(`Live Request Editor: attempted to select unknown session ${compositeKey}`);
			return;
		}
		this._activeSessionKey = compositeKey;
		this._currentRequest = next;
		this._postStateToWebview();
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
			interception: this._toWebviewInterceptionPayload(),
			sessions: this._getSessionSummaries(),
			activeSessionKey: this._activeSessionKey,
			extraSections: this._extraSections
		}).then(undefined, error => this._logService.error('Live Request Editor: failed to post state', error));
	}

	private _handleMetadataChanged(event: LiveRequestMetadataEvent): void {
		const metadata = event.metadata;
		if (!metadata) {
			return;
		}
		const compositeKey = this._toCompositeKey(metadata.sessionId, metadata.location);
		let request = this._requests.get(compositeKey);
		if (!request) {
			const fetched = this._liveRequestEditorService.getRequest({ sessionId: metadata.sessionId, location: metadata.location });
			if (fetched) {
				request = fetched;
				this._requests.set(compositeKey, fetched);
			}
		}
		if (!request) {
			return;
		}
		request.metadata.requestId = metadata.requestId ?? request.metadata.requestId;
		if (metadata.debugName) {
			(request as EditableChatRequest & { debugName?: string }).debugName = metadata.debugName;
		}
		(request as EditableChatRequest & { model: string }).model = metadata.model;
		request.isDirty = metadata.isDirty;
		request.metadata.createdAt = metadata.createdAt;
		request.metadata.lastUpdated = metadata.lastUpdated;
		request.metadata.tokenCount = metadata.tokenCount;
		request.metadata.maxPromptTokens = metadata.maxPromptTokens;
		if (!this._activeSessionKey) {
			this._activeSessionKey = compositeKey;
		}
		if (this._activeSessionKey === compositeKey) {
			this._currentRequest = request;
		}
		this._postStateToWebview();
	}

	private _readExtraSectionsSetting(): InspectorExtraSection[] {
		const config = vscode.workspace.getConfiguration('github.copilot.chat.promptInspector');
		const value = config.get<string[]>('extraSections', []);
		const allowed: InspectorExtraSection[] = ['telemetry'];
		const allowedSet = new Set(allowed);
		return value.filter((entry): entry is InspectorExtraSection => allowedSet.has(entry as InspectorExtraSection));
	}

	private _getSessionSummaries(): SessionSummaryPayload[] {
		const entries = Array.from(this._requests.values());
		let latestUpdated = 0;
		for (const entry of entries) {
			const updated = entry.metadata?.lastUpdated ?? entry.metadata?.createdAt ?? 0;
			if (updated > latestUpdated) {
				latestUpdated = updated;
			}
		}
		entries.sort((a, b) => {
			const aTime = a.metadata?.lastUpdated ?? a.metadata?.createdAt ?? 0;
			const bTime = b.metadata?.lastUpdated ?? b.metadata?.createdAt ?? 0;
			return bTime - aTime;
		});

		return entries.map(request => {
			const key = this._toCompositeKey(request.sessionId, request.location);
			const locationLabel = this._describeLocation(request.location, request.debugName);
			const sessionTail = request.sessionId.slice(-6);
			return {
				key,
				sessionId: request.sessionId,
				location: request.location,
				locationLabel,
				sessionTail,
				isActive: key === this._activeSessionKey,
				isLatest: !!latestUpdated && (request.metadata?.lastUpdated ?? request.metadata?.createdAt ?? 0) === latestUpdated,
				label: this._describeSession(request),
				model: request.model,
				isDirty: request.isDirty,
				lastUpdated: request.metadata?.lastUpdated ?? request.metadata?.createdAt,
				debugName: request.debugName,
				createdAt: request.metadata?.createdAt
			};
		});
	}

	private _toCompositeKey(sessionId: string, location: ChatLocation): string {
		return `${sessionId}::${location}`;
	}

	private _fromCompositeKey(value: string): LiveRequestSessionKey | undefined {
		const [sessionId, locationPart] = value.split('::');
		if (!sessionId || typeof locationPart !== 'string') {
			return undefined;
		}
		const location = Number(locationPart);
		if (Number.isNaN(location)) {
			return undefined;
		}
		return { sessionId, location: location as ChatLocation };
	}

	private async _showOverrideDiff(scope: LiveRequestOverrideScope, slotIndex: number, sessionKey?: LiveRequestSessionKey): Promise<void> {
		const entry = this._liveRequestEditorService.getAutoOverrideEntry(scope, slotIndex, sessionKey);
		if (!entry) {
			vscode.window.showWarningMessage('Override diff is unavailable for this section.');
			return;
		}
		const originalDoc = await vscode.workspace.openTextDocument({ content: entry.originalContent ?? '', language: 'markdown' });
		const overrideDoc = await vscode.workspace.openTextDocument({ content: entry.deleted ? '' : (entry.overrideContent ?? ''), language: 'markdown' });
		const labelSuffix = entry.scope === 'session' ? 'session override' : `${entry.scope} override`;
		const title = `${entry.label} (${labelSuffix})`;
		await vscode.commands.executeCommand('vscode.diff', originalDoc.uri, overrideDoc.uri, title);
	}

	private _describeSession(request: EditableChatRequest): string {
		const location = this._describeLocation(request.location, request.debugName);
		const name = request.debugName || request.metadata?.intentId || request.sessionId;
		const shortSession = request.sessionId.slice(-6);
		return `${location} · ${name} · …${shortSession}`;
	}

	private _describeLocation(location: ChatLocation, debugName?: string): string {
		const suffix = debugName ? ` (${debugName})` : '';
		switch (location) {
			case ChatLocation.Editor:
				return `Editor${suffix}`;
			case ChatLocation.Terminal:
				return `Terminal${suffix}`;
			case ChatLocation.Notebook:
				return `Notebook${suffix}`;
			case ChatLocation.Panel:
			default:
				return `Panel${suffix}`;
		}
	}

	private _toWebviewInterceptionPayload() {
		const state = this._interceptionState;
		return {
			enabled: state.enabled,
			mode: state.mode,
			paused: state.paused,
			autoOverride: state.autoOverride,
			pending: state.pending ? {
				sessionKey: this._toCompositeKey(state.pending.key.sessionId, state.pending.key.location),
				debugName: state.pending.debugName,
				nonce: state.pending.nonce,
			} : undefined
		};
	}

	private _resolvePendingIntercept(action: PromptInterceptionAction, reason?: string): void {
		const pendingKey = this._interceptionState.pending?.key;
		const fallback = this._currentRequest
			? { sessionId: this._currentRequest.sessionId, location: this._currentRequest.location }
			: undefined;
		const targetKey = pendingKey ?? fallback;
		if (!targetKey) {
			return;
		}
		this._liveRequestEditorService.resolvePendingIntercept(
			targetKey,
			action,
			reason ? { reason } : undefined
		);
	}

	private _getPendingCompositeKey(): string | undefined {
		const pending = this._interceptionState.pending;
		if (!pending) {
			return undefined;
		}
		return this._toCompositeKey(pending.key.sessionId, pending.key.location);
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
