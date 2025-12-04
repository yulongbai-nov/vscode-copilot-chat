/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { ILiveRequestEditorService, LiveRequestMetadataEvent, LiveRequestMetadataSnapshot } from '../common/liveRequestEditorService';

type SessionMetadataField = 'sessionId' | 'requestId' | 'model' | 'location' | 'interception' | 'dirty';

const DEFAULT_FIELDS: SessionMetadataField[] = ['sessionId', 'requestId'];
const ALLOWED_FIELDS: SessionMetadataField[] = ['sessionId', 'requestId', 'model', 'location', 'interception', 'dirty'];
const FIELD_LABELS: Record<SessionMetadataField, string> = {
	sessionId: 'Session',
	requestId: 'Request',
	model: 'Model',
	location: 'Location',
	interception: 'Interception',
	dirty: 'Dirty'
};
const FIELD_DESCRIPTIONS: Record<SessionMetadataField, string> = {
	sessionId: 'Live conversation identifier',
	requestId: 'Pending request identifier',
	model: 'Model handling the pending request',
	location: 'Chat surface (panel, editor, terminal)',
	interception: 'Prompt interception status',
	dirty: 'Whether pending edits differ from original'
};
export class LiveRequestUsageProvider extends Disposable implements vscode.WebviewViewProvider {
	public static readonly viewType = 'github.copilot.liveRequestUsage';

	private _view?: vscode.WebviewView;
	private _metadata?: LiveRequestMetadataSnapshot;
	private _fields: SessionMetadataField[];

	constructor(
		private readonly _extensionUri: vscode.Uri,
		@ILogService private readonly _logService: ILogService,
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService
	) {
		super();
		this._fields = this._readFieldsConfig();
		this._register(this._liveRequestEditorService.onDidChangeMetadata(event => this._handleMetadata(event)));
		this._register(vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('github.copilot.chat.promptInspector.sessionMetadata.fields')) {
				this._fields = this._readFieldsConfig();
				this._postState();
			}
		}));
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};
		webviewView.webview.html = this._getHtml(webviewView.webview);
		const messageSubscription = webviewView.webview.onDidReceiveMessage(message => this._handleMessage(message));
		this._register(messageSubscription);
		this._postState();
	}

	private _handleMetadata(event: LiveRequestMetadataEvent): void {
		if (event.metadata) {
			this._metadata = event.metadata;
		} else if (this._metadata && this._metadata.sessionId === event.key.sessionId && this._metadata.location === event.key.location) {
			this._metadata = undefined;
		}
		this._postState();
	}

	private _handleMessage(message: unknown): void {
		if (!message || typeof message !== 'object') {
			return;
		}
		const { type } = message as { type?: string };
		if (type === 'copyField') {
			void this._copyField(message as { value?: unknown; label?: unknown; field?: unknown });
			return;
		}
		if (type === 'configureFields') {
			void this._configureFields();
		}
	}

	private _postState(): void {
		if (!this._view) {
			return;
		}
		try {
			this._view.webview.postMessage({
				type: 'stateUpdate',
				metadata: this._metadata ?? null,
				fields: this._fields
			});
		} catch (error) {
			this._logService.error('LiveRequestUsageProvider: failed to post state', error);
		}
	}

	private _readFieldsConfig(): SessionMetadataField[] {
		const config = vscode.workspace.getConfiguration('github.copilot.chat.promptInspector');
		const raw = config.get<string[]>('sessionMetadata.fields');
		return this._normalizeFields(raw);
	}

	private _normalizeFields(raw: string[] | undefined): SessionMetadataField[] {
		if (!Array.isArray(raw)) {
			return [...DEFAULT_FIELDS];
		}
		const sanitized: SessionMetadataField[] = [];
		for (const value of raw) {
			if (ALLOWED_FIELDS.includes(value as SessionMetadataField)) {
				const typed = value as SessionMetadataField;
				if (!sanitized.includes(typed)) {
					sanitized.push(typed);
				}
			}
		}
		return sanitized;
	}

	private async _copyField(payload: { value?: unknown; label?: unknown; field?: unknown }): Promise<void> {
		if (typeof payload?.value !== 'string' || !payload.value) {
			return;
		}
		try {
			await vscode.env.clipboard.writeText(payload.value);
			const label = typeof payload.label === 'string' ? payload.label : 'Metadata';
			vscode.window.setStatusBarMessage(`${label} copied to clipboard`, 1500);
			this._view?.webview.postMessage({
				type: 'copyAck',
				field: typeof payload.field === 'string' ? payload.field : undefined,
				label
			});
		} catch (error) {
			this._logService.error('LiveRequestUsageProvider: failed to copy metadata value', error);
		}
	}

	private async _configureFields(): Promise<void> {
		const picks = await vscode.window.showQuickPick(
			ALLOWED_FIELDS.map(field => ({
				label: FIELD_LABELS[field],
				description: FIELD_DESCRIPTIONS[field],
				picked: this._fields.includes(field),
				field
			})),
			{
				title: 'Select Live Request metadata fields',
				placeHolder: 'Choose which metadata chips appear in the Live Request usage footer',
				canPickMany: true
			}
		);
		if (!picks) {
			return;
		}
		const selected = picks
			.map(pick => (pick as { field?: SessionMetadataField }).field)
			.filter((field): field is SessionMetadataField => Boolean(field));

		const config = vscode.workspace.getConfiguration('github.copilot.chat.promptInspector');
		try {
			await config.update('sessionMetadata.fields', selected, vscode.ConfigurationTarget.Global);
			this._fields = this._normalizeFields(selected);
			this._postState();
		} catch (error) {
			this._logService.error('LiveRequestUsageProvider: failed to update metadata fields', error);
			vscode.window.showErrorMessage('Failed to update Live Request metadata fields. See logs for details.');
		}
	}

	private _getHtml(webview: vscode.Webview): string {
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'liveRequestUsage.css'));
		const nonce = Date.now().toString(36);
		const fieldLabelsJson = JSON.stringify(FIELD_LABELS);
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>Live Request Usage</title>
</head>
<body>
	<div class="usage-root">
		<div class="usage-toolbar">
			<button id="configureFields" class="usage-button" type="button">Configure metadata</button>
			<div id="copyToast" class="copy-toast" aria-live="polite"></div>
		</div>
		<div id="content" class="usage-content">
			<div class="usage-empty">Live Request Editor idle — send a chat request to populate metadata.</div>
		</div>
	</div>
	<script nonce="${nonce}">
		const vscodeApi = acquireVsCodeApi();
		const content = document.getElementById('content');
		const configureButton = document.getElementById('configureFields');
		const copyToast = document.getElementById('copyToast');
		const fieldLabels = ${fieldLabelsJson};
		let toastTimer;

		configureButton?.addEventListener('click', () => {
			vscodeApi.postMessage({ type: 'configureFields' });
		});

		content?.addEventListener('click', event => {
			const target = event.target;
			if (!(target instanceof Element)) {
				return;
			}
			const button = target.closest('button[data-copy-field]');
			if (!button || button.hasAttribute('disabled')) {
				return;
			}
			const value = button.getAttribute('data-copy-value');
			if (!value) {
				return;
			}
			vscodeApi.postMessage({
				type: 'copyField',
				value,
				label: button.getAttribute('data-copy-label'),
				field: button.getAttribute('data-copy-field')
			});
		});

		function formatValue(value) {
			if (!value) { return '—'; }
			return value.length > 18 ? value.slice(0, 6) + '…' + value.slice(-6) : value;
		}
		function formatNumber(value) {
			return new Intl.NumberFormat().format(value);
		}
		function escapeHtml(value) {
			return value
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}
		function escapeAttr(value) {
			return escapeHtml(value ?? '');
		}
		function buildChip(field, label, rawValue, displayValue) {
			const hasValue = typeof rawValue === 'string' && rawValue.length > 0;
			const copyAttrs = hasValue ? ' data-copy-value="' + escapeAttr(rawValue) + '"' : '';
			const chipLabel = escapeHtml(label);
			const chipValue = escapeHtml(displayValue);
			return ''
				+ '<div class="metadata-chip" data-field="' + field + '">'
				+ '<div class="chip-main">'
				+ '<span class="chip-label">' + chipLabel + '</span>'
				+ '<span class="chip-value">' + chipValue + '</span>'
				+ '</div>'
				+ '<button class="chip-copy" type="button" data-copy-field="' + field + '" data-copy-label="' + chipLabel + '"'
				+ copyAttrs
				+ (hasValue ? '' : ' disabled aria-disabled="true"')
				+ '>Copy</button>'
				+ '</div>';
		}
		function render(metadata, fields) {
			if (!content) {
				return;
			}
			if (!metadata) {
				content.innerHTML = '<div class="usage-empty">Live Request Editor idle — send a chat request to populate metadata.</div>';
				return;
			}
			const chips = fields.map(field => {
				const label = fieldLabels[field] ?? field;
				let rawValue = '';
				let displayValue = '—';
				if (field === 'sessionId') {
					rawValue = metadata.sessionId ?? '';
					displayValue = formatValue(rawValue);
				} else if (field === 'requestId') {
					rawValue = metadata.requestId ?? '';
					displayValue = formatValue(rawValue || '—');
				} else if (field === 'model') {
					rawValue = metadata.model ?? '';
					displayValue = rawValue || '—';
				} else if (field === 'location') {
					rawValue = metadata.location ?? '';
					displayValue = rawValue || '—';
				} else if (field === 'interception') {
					rawValue = metadata.interceptionState === 'pending' ? 'Pending' : 'Idle';
					displayValue = rawValue;
				} else if (field === 'dirty') {
					rawValue = metadata.isDirty ? 'Dirty' : 'Clean';
					displayValue = rawValue;
				}
				return buildChip(field, label, rawValue, displayValue);
			}).join('');

			const maxTokens = metadata.maxPromptTokens ?? 0;
			const usedTokens = Math.min(Math.max(metadata.tokenCount ?? 0, 0), maxTokens || Number.MAX_SAFE_INTEGER);
			let tokenMarkup = '<div class="usage-empty">Token Budget: awaiting data…</div>';
			if (maxTokens > 0) {
				const ratio = Math.min(Math.max(usedTokens / maxTokens, 0), 1);
				const percent = Math.round(ratio * 100);
				tokenMarkup = ''
					+ '<div class="token-meter">'
					+ '<div class="token-meter-fill" style="width: ' + percent + '%"></div>'
					+ '<div class="token-meter-label">' + percent + '% · '
					+ formatNumber(usedTokens) + '/' + formatNumber(maxTokens) + ' tokens</div>'
					+ '</div>';
			}

			content.innerHTML = ''
				+ '<div class="metadata-column">'
				+ (chips || '<div class="usage-empty">No metadata fields selected. Use “Configure metadata” to choose which chips appear.</div>')
				+ '</div>'
				+ tokenMarkup;
		}

		function showCopyToast(message) {
			if (!copyToast) {
				return;
			}
			copyToast.textContent = message;
			copyToast.classList.add('copy-toast--visible');
			clearTimeout(toastTimer);
			toastTimer = setTimeout(() => copyToast.classList.remove('copy-toast--visible'), 1600);
		}

		window.addEventListener('message', event => {
			const { type } = event.data ?? {};
			if (type === 'stateUpdate') {
				render(event.data.metadata, event.data.fields ?? []);
			} else if (type === 'copyAck') {
				if (event.data?.field && content) {
					const button = content.querySelector('button[data-copy-field="' + event.data.field + '"]');
					if (button) {
						button.classList.add('chip-copy--copied');
						setTimeout(() => button.classList.remove('chip-copy--copied'), 1200);
					}
				}
				showCopyToast((event.data?.label || 'Metadata') + ' copied');
			}
		});
	</script>
</body>
</html>`;
	}
}
