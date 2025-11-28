/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { EditableChatRequest } from '../common/liveRequestEditorModel';
import { ILiveRequestEditorService } from '../common/liveRequestEditorService';

/**
 * WebView provider for the Live Request Editor / Prompt Inspector panel.
 * Displays the composed ChatML request sections before sending to the LLM,
 * allowing advanced users to inspect and edit individual prompt sections.
 *
 * Security note: This webview uses innerHTML with content that is escaped via
 * escapeHtml() to prevent XSS. This follows the same pattern used in
 * promptSectionVisualizerProvider.ts and other VS Code webview providers.
 */
export class LiveRequestEditorProvider extends Disposable implements vscode.WebviewViewProvider {
	public static readonly viewType = 'github.copilot.liveRequestEditor';

	private _view?: vscode.WebviewView;
	private _currentRequest?: EditableChatRequest;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		@ILogService private readonly _logService: ILogService,
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService
	) {
		super();

		// Listen for changes to the live request
		this._register(this._liveRequestEditorService.onDidChange(request => {
			this._currentRequest = request;
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

		// The webview HTML uses a render function that builds DOM via innerHTML.
		// All user content is escaped via escapeHtml() before insertion to prevent XSS.
		// This pattern matches promptSectionVisualizerProvider.ts and other VS Code webviews.
		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>Live Request Editor</title>
					${this._getStyles()}
				</head>
				<body>
					<div id="app">
						<div class="empty-state">
							<p><strong>Live Request Editor</strong></p>
							<p>Waiting for a chat request...</p>
							<p style="font-size: 12px;">Start a conversation in the chat panel to inspect and edit the prompt.</p>
						</div>
					</div>
					<script nonce="${nonce}">
						${this._getScript()}
					</script>
				</body>
			</html>
		`;
	}

	private _getStyles(): string {
		return /* html */`
			<style>
				:root { color-scheme: light dark; }
				* { box-sizing: border-box; }
				body {
					margin: 0;
					padding: 0;
					font-family: var(--vscode-font-family);
					font-size: var(--vscode-font-size);
					background: var(--vscode-editor-background);
					color: var(--vscode-foreground);
				}
				#app { padding: 12px; }
				.status-banner {
					position: sticky;
					top: 0;
					z-index: 2;
					background: var(--vscode-editor-background);
					padding-bottom: 12px;
					margin-bottom: 12px;
					border-bottom: 1px solid var(--vscode-panel-border);
				}
				.pinned-container {
					display: flex;
					flex-direction: column;
					gap: 8px;
					margin-top: 8px;
					padding-top: 8px;
					border-top: 1px solid var(--vscode-panel-border);
				}
				.pinned-container h3 {
					margin: 0 0 4px 0;
					font-size: 11px;
					text-transform: uppercase;
					color: var(--vscode-descriptionForeground);
					letter-spacing: 0.05em;
				}
				.pinned-summary {
					font-size: 11px;
					color: var(--vscode-descriptionForeground);
					margin-bottom: 4px;
				}
				.sections-wrapper {
					display: flex;
					flex-direction: column;
				}
				.header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					margin-bottom: 12px;
				}
				.header h2 {
					margin: 0;
					font-size: 14px;
					font-weight: 600;
				}
				.header-actions {
					display: flex;
					gap: 8px;
					align-items: center;
				}
				.metadata {
					font-size: 12px;
					color: var(--vscode-descriptionForeground);
					margin-bottom: 12px;
				}
				.metadata-row {
					display: flex;
					gap: 16px;
					flex-wrap: wrap;
				}
				.metadata-item {
					display: flex;
					gap: 4px;
				}
				.metadata-label {
					font-weight: 500;
				}
				.dirty-badge {
					background: var(--vscode-editorWarning-foreground);
					color: var(--vscode-editor-background);
					padding: 2px 6px;
					border-radius: 4px;
					font-size: 11px;
					font-weight: 600;
				}
				.section {
					border: 1px solid var(--vscode-panel-border);
					border-radius: 6px;
					margin-bottom: 8px;
					background: var(--vscode-sideBar-background);
					overflow: hidden;
				}
				.section.deleted {
					opacity: 0.5;
					border-style: dashed;
				}
				.section.pinned {
					box-shadow: 0 0 0 1px var(--vscode-list-activeSelectionBorder);
				}
				.section.drag-over {
					outline: 1px dashed var(--vscode-focusBorder);
				}
				.section-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: 8px 12px;
					cursor: pointer;
					background: var(--vscode-sideBarSectionHeader-background);
					border-bottom: 1px solid var(--vscode-panel-border);
				}
				.section-header:hover {
					background: var(--vscode-list-hoverBackground);
				}
				.section-title {
					display: flex;
					align-items: center;
					gap: 8px;
					font-weight: 500;
				}
				.section-title .icon {
					font-size: 10px;
					transition: transform 0.15s;
				}
				.section.collapsed .section-title .icon {
					transform: rotate(-90deg);
				}
				.section-kind {
					font-size: 11px;
					padding: 2px 6px;
					border-radius: 4px;
					background: var(--vscode-badge-background);
					color: var(--vscode-badge-foreground);
					text-transform: uppercase;
				}
				.section-kind.system { background: var(--vscode-debugIcon-breakpointForeground); }
				.section-kind.user { background: var(--vscode-charts-blue); }
				.section-kind.assistant { background: var(--vscode-charts-green); }
				.section-kind.tool { background: var(--vscode-charts-orange); }
				.section-kind.context { background: var(--vscode-charts-purple); }
				.section-kind.history { background: var(--vscode-charts-yellow); color: #000; }
				.section-tokens {
					font-size: 11px;
					color: var(--vscode-descriptionForeground);
					display: inline-flex;
					align-items: center;
					gap: 4px;
				}
				.section-percentage {
					font-size: 10px;
					color: var(--vscode-descriptionForeground);
				}
				.token-meter {
					width: 100%;
					height: 4px;
					background: var(--vscode-editorLineNumber-foreground);
					border-radius: 999px;
					margin-top: 6px;
					overflow: hidden;
				}
				.token-meter-fill {
					height: 100%;
					background: var(--vscode-editorWarning-foreground);
					border-radius: 999px;
					transition: width 0.2s ease;
					width: 0%;
				}
				.pinned-indicator {
					font-size: 10px;
					text-transform: uppercase;
					color: var(--vscode-descriptionForeground);
					border: 1px solid var(--vscode-descriptionForeground);
					border-radius: 999px;
					padding: 0 6px;
				}
				.section-actions {
					display: flex;
					gap: 4px;
					opacity: 0;
					transition: opacity 0.15s;
				}
				.section:hover .section-actions,
				.section:focus-within .section-actions {
					opacity: 1;
				}
				.section-content {
					padding: 12px;
					max-height: 300px;
					overflow: auto;
				}
				.section.collapsed .section-content {
					display: none;
				}
				.section-content pre {
					margin: 0;
					white-space: pre-wrap;
					word-break: break-word;
					font-family: var(--vscode-editor-font-family);
					font-size: 12px;
					line-height: 1.5;
				}
				.section-editor {
					width: 100%;
					min-height: 150px;
					padding: 8px;
					border: 1px solid var(--vscode-input-border);
					border-radius: 4px;
					background: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					font-family: var(--vscode-editor-font-family);
					font-size: 12px;
					line-height: 1.5;
					resize: vertical;
				}
				.section-editor:focus {
					outline: 1px solid var(--vscode-focusBorder);
				}
				.editor-actions {
					display: flex;
					justify-content: flex-end;
					gap: 8px;
					margin-top: 8px;
				}
				button {
					border: none;
					padding: 4px 8px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 12px;
					display: inline-flex;
					align-items: center;
					gap: 4px;
				}
				button.primary {
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
				}
				button.primary:hover {
					background: var(--vscode-button-hoverBackground);
				}
				button.secondary {
					background: var(--vscode-button-secondaryBackground);
					color: var(--vscode-button-secondaryForeground);
				}
				button.secondary:hover {
					background: var(--vscode-button-secondaryHoverBackground);
				}
				button.icon-only {
					background: transparent;
					padding: 4px;
					border-radius: 4px;
				}
				button.icon-only:hover {
					background: var(--vscode-toolbar-hoverBackground);
				}
				.empty-state {
					text-align: center;
					padding: 32px 16px;
					color: var(--vscode-descriptionForeground);
				}
				.empty-state p {
					margin: 8px 0;
				}
			</style>
		`;
	}

	private _getScript(): string {
		// Script for webview - escapes all user content via escapeHtml before DOM insertion
		return /* js */`
			(function () {
				const vscode = acquireVsCodeApi();
				const app = document.getElementById('app');
				let editingSection = null;
				let currentRequest = null;
				const persistedState = vscode.getState?.() ?? {};
				let pinnedOrder = Array.isArray(persistedState?.pinned) ? persistedState.pinned : [];
				let pinnedSectionIds = new Set(pinnedOrder);
				let draggingSectionId = null;

				// XSS prevention: escape all HTML special characters
				const escapeHtml = (value) => {
					if (!value) return '';
					const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
					return String(value).replace(/[&<>"']/g, m => map[m]);
				};

				const formatNumber = (value) => {
					if (value === undefined || value === null || Number.isNaN(value)) {
						return '—';
					}
					return Number(value).toLocaleString();
				};

				const computeTotalTokens = (request) => {
					if (request?.metadata?.tokenCount) {
						return request.metadata.tokenCount;
					}
					return (request?.sections ?? []).reduce((sum, section) => sum + (section.tokenCount ?? 0), 0);
				};

					const formatPercent = (value, total) => {
						if (!total || !value) {
							return '0%';
						}
						const pct = (value / total) * 100;
						return pct.toFixed(pct >= 10 ? 0 : 1) + '%';
					};

				const persistPinned = () => {
					vscode.setState?.({ pinned: pinnedOrder });
				};

				const sanitizePinned = (sections) => {
					const allowed = new Set(sections.map(section => section.id));
					let didChange = false;
					pinnedOrder = pinnedOrder.filter(id => {
						if (allowed.has(id)) {
							return true;
						}
						didChange = true;
						return false;
					});
					pinnedSectionIds = new Set(pinnedOrder);
					if (didChange) {
						persistPinned();
					}
				};

				const orderSections = (sections) => {
					sanitizePinned(sections);
					const pinned = [];
					const rest = [];
					for (const section of sections) {
						if (pinnedSectionIds.has(section.id)) {
							pinned.push(section);
						} else {
							rest.push(section);
						}
					}
					pinned.sort((a, b) => pinnedOrder.indexOf(a.id) - pinnedOrder.indexOf(b.id));
					return [...pinned, ...rest];
				};

				const togglePinned = (sectionId) => {
					if (!currentRequest) {
						return;
					}
					if (pinnedSectionIds.has(sectionId)) {
						pinnedSectionIds.delete(sectionId);
						pinnedOrder = pinnedOrder.filter(id => id !== sectionId);
					} else {
						pinnedSectionIds.add(sectionId);
						pinnedOrder = pinnedOrder.filter(id => id !== sectionId);
						pinnedOrder.push(sectionId);
					}
					persistPinned();
					render(currentRequest);
				};

				const reorderPinned = (sourceId, targetId, placeAfter) => {
					if (!sourceId || !targetId || sourceId === targetId) {
						return;
					}
					if (!pinnedSectionIds.has(sourceId) || !pinnedSectionIds.has(targetId)) {
						return;
					}
					const originalOrder = Array.from(pinnedOrder);
					const sourceIndex = originalOrder.indexOf(sourceId);
					const targetIndex = originalOrder.indexOf(targetId);
					if (sourceIndex === -1 || targetIndex === -1) {
						return;
					}
					const newOrder = originalOrder.filter(id => id !== sourceId);
					const targetPos = newOrder.indexOf(targetId);
					const insertIndex = targetPos + (placeAfter ? 1 : 0);
					newOrder.splice(insertIndex, 0, sourceId);
					pinnedOrder = newOrder;
					persistPinned();
					render(currentRequest);
				};

				const sendMessage = (type, data) => {
					vscode.postMessage({ type, ...data });
				};

				const renderSection = (section, index, totalTokens = 0) => {
					const isEditing = editingSection === section.id;
					const isDeleted = section.deleted;
					const isCollapsed = section.collapsed && !isEditing;
					const isPinned = pinnedSectionIds.has(section.id);

					const sectionEl = document.createElement('div');
					sectionEl.className = 'section' + (isCollapsed ? ' collapsed' : '') + (isDeleted ? ' deleted' : '');
					if (isPinned) {
						sectionEl.classList.add('pinned');
					}
					sectionEl.dataset.sectionId = section.id;
					sectionEl.draggable = isPinned && !isDeleted;
					if (sectionEl.draggable) {
						sectionEl.addEventListener('dragstart', (event) => {
							draggingSectionId = section.id;
							event.dataTransfer?.setData('text/plain', section.id);
							if (event.dataTransfer) {
								event.dataTransfer.effectAllowed = 'move';
							}
						});
						sectionEl.addEventListener('dragover', (event) => {
							if (!draggingSectionId || draggingSectionId === section.id) {
								return;
							}
							event.preventDefault();
							sectionEl.classList.add('drag-over');
							if (event.dataTransfer) {
								event.dataTransfer.dropEffect = 'move';
							}
						});
						sectionEl.addEventListener('dragleave', () => {
							sectionEl.classList.remove('drag-over');
						});
						sectionEl.addEventListener('drop', (event) => {
							if (!draggingSectionId || draggingSectionId === section.id) {
								sectionEl.classList.remove('drag-over');
								return;
							}
							event.preventDefault();
							const sourceId = event.dataTransfer?.getData('text/plain') || draggingSectionId;
							const rect = sectionEl.getBoundingClientRect();
							const dropAfter = (event.clientY - rect.top) > rect.height / 2;
							sectionEl.classList.remove('drag-over');
							reorderPinned(sourceId, section.id, dropAfter);
							draggingSectionId = null;
						});
						sectionEl.addEventListener('dragend', () => {
							sectionEl.classList.remove('drag-over');
							draggingSectionId = null;
						});
					}

					const header = document.createElement('div');
					header.className = 'section-header';
					header.dataset.toggle = section.id;

					const title = document.createElement('div');
					title.className = 'section-title';

					const icon = document.createElement('span');
					icon.className = 'icon';
					icon.textContent = isCollapsed ? '\\u25B6' : '\\u25BC';
					title.appendChild(icon);

					const kindBadge = document.createElement('span');
					kindBadge.className = 'section-kind ' + section.kind;
					kindBadge.textContent = section.kind;
					title.appendChild(kindBadge);

					const label = document.createElement('span');
					label.textContent = section.label;
					title.appendChild(label);

					const sectionTokenCount = section.tokenCount ?? 0;

					if (sectionTokenCount) {
						const tokens = document.createElement('span');
						tokens.className = 'section-tokens';
						tokens.textContent = formatNumber(sectionTokenCount) + ' tokens';
						if (totalTokens) {
							const pct = document.createElement('span');
							pct.className = 'section-percentage';
							pct.textContent = formatPercent(sectionTokenCount, totalTokens);
							tokens.appendChild(pct);
						}
						title.appendChild(tokens);
					}

					if (isPinned) {
						const pinnedBadge = document.createElement('span');
						pinnedBadge.className = 'pinned-indicator';
						pinnedBadge.textContent = 'Pinned';
						title.appendChild(pinnedBadge);
					}

					header.appendChild(title);

					const actions = document.createElement('div');
					actions.className = 'section-actions';

					if (isDeleted) {
						const restoreBtn = document.createElement('button');
						restoreBtn.className = 'secondary';
						restoreBtn.dataset.action = 'restore';
						restoreBtn.dataset.section = section.id;
						restoreBtn.textContent = 'Restore';
						restoreBtn.title = 'Restore section';
						actions.appendChild(restoreBtn);
					} else {
						const pinBtn = document.createElement('button');
						pinBtn.className = 'icon-only';
						pinBtn.dataset.action = 'stick';
						pinBtn.dataset.section = section.id;
						pinBtn.textContent = isPinned ? 'Unstick' : 'Stick';
						pinBtn.title = isPinned ? 'Unstick section' : 'Stick section';
						actions.appendChild(pinBtn);

						if (section.editable) {
							const editBtn = document.createElement('button');
							editBtn.className = 'icon-only';
							editBtn.dataset.action = 'edit';
							editBtn.dataset.section = section.id;
							editBtn.textContent = isEditing ? 'Cancel' : 'Edit';
							editBtn.title = 'Edit section';
							actions.appendChild(editBtn);
						}
						if (section.deletable) {
							const deleteBtn = document.createElement('button');
							deleteBtn.className = 'icon-only';
							deleteBtn.dataset.action = 'delete';
							deleteBtn.dataset.section = section.id;
							deleteBtn.textContent = 'Delete';
							deleteBtn.title = 'Delete section';
							actions.appendChild(deleteBtn);
						}
					}

					header.appendChild(actions);
					sectionEl.appendChild(header);

					const content = document.createElement('div');
					content.className = 'section-content';

					if (isEditing) {
						const textarea = document.createElement('textarea');
						textarea.className = 'section-editor';
						textarea.dataset.section = section.id;
						textarea.value = section.content || '';
						content.appendChild(textarea);

						const editorActions = document.createElement('div');
						editorActions.className = 'editor-actions';

						const cancelBtn = document.createElement('button');
						cancelBtn.className = 'secondary';
						cancelBtn.dataset.action = 'cancel-edit';
						cancelBtn.dataset.section = section.id;
						cancelBtn.textContent = 'Cancel';
						editorActions.appendChild(cancelBtn);

						const saveBtn = document.createElement('button');
						saveBtn.className = 'primary';
						saveBtn.dataset.action = 'save-edit';
						saveBtn.dataset.section = section.id;
						saveBtn.textContent = 'Save';
						editorActions.appendChild(saveBtn);

						content.appendChild(editorActions);
					} else {
						const pre = document.createElement('pre');
						pre.textContent = section.content || '';
						content.appendChild(pre);
					}

					if (totalTokens && sectionTokenCount) {
						const meter = document.createElement('div');
						meter.className = 'token-meter';
						const fill = document.createElement('div');
						fill.className = 'token-meter-fill';
						fill.style.width = formatPercent(sectionTokenCount, totalTokens);
						meter.appendChild(fill);
						content.appendChild(meter);
					}

					sectionEl.appendChild(content);
					return sectionEl;
				};

				const render = (request) => {
					currentRequest = request;

					if (!request || !request.sections || request.sections.length === 0) {
						app.textContent = '';
						const emptyState = document.createElement('div');
						emptyState.className = 'empty-state';
						emptyState.innerHTML = '<p><strong>Live Request Editor</strong></p><p>Waiting for a chat request...</p><p style="font-size: 12px;">Start a conversation in the chat panel to inspect and edit the prompt.</p>';
						app.appendChild(emptyState);
						return;
					}

					app.textContent = '';
					const totalTokens = computeTotalTokens(request);

					// Header
					const header = document.createElement('div');
					header.className = 'header';

					const headerTitle = document.createElement('div');
					const h2 = document.createElement('h2');
					h2.textContent = 'Live Request Editor';
					headerTitle.appendChild(h2);
					header.appendChild(headerTitle);

					const headerActions = document.createElement('div');
					headerActions.className = 'header-actions';

					if (request.isDirty) {
						const badge = document.createElement('span');
						badge.className = 'dirty-badge';
						badge.textContent = 'Modified';
						headerActions.appendChild(badge);

						const resetBtn = document.createElement('button');
						resetBtn.className = 'secondary';
						resetBtn.dataset.action = 'reset';
						resetBtn.textContent = 'Reset';
						headerActions.appendChild(resetBtn);
					}

					header.appendChild(headerActions);

					// Metadata
					const metadata = document.createElement('div');
					metadata.className = 'metadata';
					const metaRow = document.createElement('div');
					metaRow.className = 'metadata-row';

					const modelItem = document.createElement('div');
					modelItem.className = 'metadata-item';
					modelItem.innerHTML = '<span class="metadata-label">Model:</span><span>' + escapeHtml(request.model) + '</span>';
					metaRow.appendChild(modelItem);

					const tokensItem = document.createElement('div');
					tokensItem.className = 'metadata-item';
					const maxPrompt = request.metadata?.maxPromptTokens;
					const tokenValue = totalTokens;
					const occupancy = maxPrompt ? formatPercent(tokenValue, maxPrompt) : undefined;
					const tokenText = maxPrompt
						? formatNumber(tokenValue) + ' / ' + formatNumber(maxPrompt) + ' (' + occupancy + ')'
						: formatNumber(tokenValue) + ' tokens';
					tokensItem.innerHTML = '<span class="metadata-label">Prompt Budget:</span><span>' + tokenText + '</span>';
					metaRow.appendChild(tokensItem);

		const sectionsItem = document.createElement('div');
		sectionsItem.className = 'metadata-item';
		sectionsItem.innerHTML = '<span class="metadata-label">Sections:</span><span>' + request.sections.length + '</span>';
		metaRow.appendChild(sectionsItem);

		metadata.appendChild(metaRow);

		const statusBanner = document.createElement('div');
		statusBanner.className = 'status-banner';
		statusBanner.appendChild(header);
		statusBanner.appendChild(metadata);

		const orderedSections = orderSections(request.sections || []);
		const pinnedSections = orderedSections.filter(section => pinnedSectionIds.has(section.id));
		const unpinnedSections = orderedSections.filter(section => !pinnedSectionIds.has(section.id));

		if (pinnedSections.length) {
			const pinnedContainer = document.createElement('div');
			pinnedContainer.className = 'pinned-container';
			const pinnedTitle = document.createElement('h3');
			pinnedTitle.textContent = 'Pinned Sections';
			pinnedContainer.appendChild(pinnedTitle);
			const pinnedTokens = pinnedSections.reduce((sum, section) => sum + (section.tokenCount ?? 0), 0);
			const pinnedSummary = document.createElement('div');
			pinnedSummary.className = 'pinned-summary';
					const pinnedText = totalTokens
						? formatNumber(pinnedTokens) + ' tokens (' + formatPercent(pinnedTokens, totalTokens) + ')'
						: formatNumber(pinnedTokens) + ' tokens';
			pinnedSummary.textContent = pinnedText;
			pinnedContainer.appendChild(pinnedSummary);
			pinnedSections.forEach((section, idx) => {
				pinnedContainer.appendChild(renderSection(section, idx, totalTokens));
			});
			statusBanner.appendChild(pinnedContainer);
		}

		app.appendChild(statusBanner);

		const sectionsWrapper = document.createElement('div');
		sectionsWrapper.className = 'sections-wrapper';
		for (let i = 0; i < unpinnedSections.length; i++) {
			sectionsWrapper.appendChild(renderSection(unpinnedSections[i], i, totalTokens));
		}
		app.appendChild(sectionsWrapper);

		// Attach event listeners
		attachEventListeners();
	};

	const attachEventListeners = () => {
		app.querySelectorAll('[data-toggle]').forEach(node => {
			node.addEventListener('click', (e) => {
				if (e.target.closest('[data-action]')) return;
				const sectionId = node.dataset.toggle;
				sendMessage('toggleCollapse', { sectionId });
			});
		});

		app.querySelectorAll('[data-action]').forEach(node => {
			node.addEventListener('click', (e) => {
				e.stopPropagation();
				const action = node.dataset.action;
				const sectionId = node.dataset.section;

				switch (action) {
					case 'stick':
						if (sectionId) {
							togglePinned(sectionId);
						}
						break;
					case 'edit':
						editingSection = editingSection === sectionId ? null : sectionId;
						render(currentRequest);
						break;
					case 'cancel-edit':
						editingSection = null;
						render(currentRequest);
						break;
					case 'save-edit':
						const textarea = app.querySelector('textarea[data-section="' + sectionId + '"]');
						if (textarea) {
							sendMessage('editSection', { sectionId, content: textarea.value });
							editingSection = null;
						}
						break;
					case 'delete':
						sendMessage('deleteSection', { sectionId });
						break;
					case 'restore':
						sendMessage('restoreSection', { sectionId });
						break;
					case 'reset':
						sendMessage('resetRequest', {});
						break;
				}
			});
		});
	};

				window.addEventListener('message', event => {
		if (event.data?.type === 'stateUpdate') {
	render(event.data.request);
}
				});
			}());
`;
	}

	private _postStateToWebview(): void {
		if (!this._view) {
			return;
		}

		this._view.webview.postMessage({
			type: 'stateUpdate',
			request: this._currentRequest
		}).then(undefined, error => this._logService.error('Live Request Editor: failed to post state', error));
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
