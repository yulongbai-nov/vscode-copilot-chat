/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import {
	IPromptSectionRenderer,
	IPromptStateManager,
	PromptRendererPart
} from '../common/services';
import { PromptSection, PromptStatePatch, RenderOptions, VisualizerState } from '../common/types';

const PANEL_RENDER_OPTIONS: RenderOptions = {
	showActions: true,
	enableCollapse: true,
	showTokenBreakdown: true,
	mode: 'standalone'
};

type WebviewMessage =
	| { type: 'render'; version: number; parts: PromptRendererPart[] }
	| { type: 'patch'; version: number; patch: PromptStatePatch; parts: PromptRendererPart[] }
	| { type: 'error'; version: number; message: string };

/**
 * Standalone Prompt Visualizer provider that streams renderer parts to a webview adapter.
 */
export class PromptSectionVisualizerProvider extends Disposable implements vscode.WebviewViewProvider {
	public static readonly viewType = 'github.copilot.promptSectionVisualizer';

	private _view?: vscode.WebviewView;
	private _lastKnownState: VisualizerState | undefined;
	private _hasRenderedInitial = false;
	private _renderVersion = 0;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		@ILogService private readonly _logService: ILogService,
		@IPromptStateManager private readonly _stateManager: IPromptStateManager,
		@IPromptSectionRenderer private readonly _sectionRenderer: IPromptSectionRenderer
	) {
		super();

		this._register(this._stateManager.onDidChangeState(state => {
			this._lastKnownState = state;
			if (this._view && !this._hasRenderedInitial) {
				void this._postFullRender(state);
			}
		}));

		this._register(this._stateManager.onDidApplyPatch(patch => {
			void this._handleStatePatch(patch);
		}));
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;
		this._hasRenderedInitial = false;
		this._renderVersion = 0;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		this._register(webviewView.webview.onDidReceiveMessage(message => {
			void this._handleWebviewMessage(message);
		}));

		this._lastKnownState = this._stateManager.getCurrentState();
		void this._postFullRender(this._lastKnownState);
	}

	public updatePrompt(prompt: string): void {
		this._stateManager.updatePrompt(prompt);
	}

	public getEditedPrompt(): string {
		const state = this._stateManager.getCurrentState();
		return state.sections.map(section => `<${section.tagName}>${section.content}</${section.tagName}>`).join('\n');
	}

	public show(): void {
		this._view?.show?.(true);
	}

	public hide(): void {
		this._view?.show?.(false);
	}

	public isVisible(): boolean {
		return this._view?.visible ?? false;
	}

	public getCurrentState(): VisualizerState {
		return this._stateManager.getCurrentState();
	}

	private async _handleWebviewMessage(message: unknown): Promise<void> {
		const payload = message as { type?: string; command?: string; args?: unknown[] };

		if (payload?.type === 'command' && typeof payload.command === 'string') {
			try {
				await vscode.commands.executeCommand(payload.command, ...(payload.args ?? []));
			}
			catch (error) {
				this._logService.error(`Prompt visualizer webview failed to execute command ${payload.command}`, error);
			}
			return;
		}

		this._logService.trace('Prompt visualizer webview message ignored (no handler)');
	}

	private async _postFullRender(state: VisualizerState): Promise<void> {
		if (!this._view) {
			return;
		}

		try {
			const parts = await this._collectRendererParts(state.sections);
			await this._postMessage({ type: 'render', version: ++this._renderVersion, parts });
			this._hasRenderedInitial = true;
		}
		catch (error) {
			this._logService.error('Prompt visualizer failed to render state', error);
			await this._postMessage({
				type: 'error',
				version: ++this._renderVersion,
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}

	private async _handleStatePatch(patch: PromptStatePatch): Promise<void> {
		if (!this._view || !this._hasRenderedInitial) {
			return;
		}

		const state = this._stateManager.getCurrentState();
		this._lastKnownState = state;

		if (patch.type === 'stateReset') {
			await this._postFullRender(state);
			return;
		}

		try {
			const parts = await this._collectRendererParts(state.sections, part => this._shouldIncludePartForPatch(part, patch));
			await this._postMessage({
				type: 'patch',
				version: ++this._renderVersion,
				patch,
				parts
			});
		}
		catch (error) {
			this._logService.error('Prompt visualizer failed to emit patch', error);
		}
	}

	private async _collectRendererParts(
		sections: PromptSection[],
		filter?: (part: PromptRendererPart) => boolean
	): Promise<PromptRendererPart[]> {
		const parts: PromptRendererPart[] = [];

		for await (const part of this._sectionRenderer.renderSections(sections, PANEL_RENDER_OPTIONS)) {
			if (!filter || filter(part)) {
				parts.push(part);
			}
		}

		return parts;
	}

	private _shouldIncludePartForPatch(part: PromptRendererPart, patch: PromptStatePatch): boolean {
		if (part.type === 'header' || part.type === 'progress' || part.type === 'emptyState') {
			return true;
		}

		switch (patch.type) {
			case 'sectionAdded':
			case 'sectionUpdated':
				return this._partMatchesSection(part, patch.section.id);
			case 'sectionCollapseToggled':
			case 'sectionModeChanged':
				return this._partMatchesSection(part, patch.sectionId);
			case 'sectionRemoved':
				return false;
			case 'sectionsReordered':
				return false;
			default:
				return false;
		}
	}

	private _partMatchesSection(part: PromptRendererPart, sectionId: string): boolean {
		if (!sectionId) {
			return false;
		}

		if (part.type === 'section') {
			return part.id === sectionId;
		}

		if (part.type === 'warning' || part.type === 'divider') {
			return part.sectionId === sectionId;
		}

		if (part.type === 'commandButton' && part.target === 'section') {
			return part.sectionId === sectionId;
		}

		return false;
	}

	private async _postMessage(message: WebviewMessage): Promise<void> {
		if (!this._view) {
			return;
		}

		try {
			await this._view.webview.postMessage(message);
		}
		catch (error) {
			this._logService.error('Prompt visualizer failed to post message', error);
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleAppUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'promptSectionVisualizerView.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'promptSectionVisualizerClient.js'));
		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<link href="${styleResetUri}" rel="stylesheet" />
					<link href="${styleVSCodeUri}" rel="stylesheet" />
					<link href="${styleAppUri}" rel="stylesheet" />
					<title>Prompt Section Visualizer</title>
				</head>
				<body>
					<div id="app" class="pv-root">
						<header class="pv-header">
							<div class="pv-header__text">
								<h2 data-ref="title">Prompt Section Visualizer</h2>
								<div class="pv-header__tokens" data-ref="tokenSummary">Total tokens: 0</div>
							</div>
							<div class="pv-header__actions" data-ref="globalActions"></div>
						</header>
						<section class="pv-progress" data-ref="progress" aria-live="polite"></section>
						<div class="pv-empty hidden" data-ref="empty"></div>
						<section class="pv-sections" data-ref="sections"></section>
						<div class="pv-footer" data-ref="loadMore"></div>
					</div>
					<script nonce="${nonce}" src="${scriptUri}"></script>
				</body>
			</html>
		`;
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
