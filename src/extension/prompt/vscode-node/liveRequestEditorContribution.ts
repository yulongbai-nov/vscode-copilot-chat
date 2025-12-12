/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { ILiveRequestEditorService, LiveRequestEditorMode, LiveRequestOverrideScope, PromptInterceptionState } from '../common/liveRequestEditorService';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { LIVE_REQUEST_EDITOR_VISIBLE_CONTEXT_KEY } from './liveRequestEditorContextKeys';
import { LiveRequestEditorProvider } from './liveRequestEditorProvider';
import { LiveRequestMetadataProvider } from './liveRequestMetadataProvider';
import { LiveRequestPayloadProvider } from './liveRequestPayloadProvider';
import { LiveReplayChatProvider } from './liveReplayChatProvider';

type ModePickItem = vscode.QuickPickItem & { mode: LiveRequestEditorMode; disabled?: boolean };
type ScopePickItem = vscode.QuickPickItem & { scope: LiveRequestOverrideScope };
type PreviewLimitPickItem = vscode.QuickPickItem & { value?: number; custom?: boolean };

export class LiveRequestEditorContribution implements IExtensionContribution {
	readonly id = 'liveRequestEditor';

	private readonly _disposables = new DisposableStore();
	private _provider?: LiveRequestEditorProvider;
	private _metadataProvider?: LiveRequestMetadataProvider;
	private _payloadProvider?: LiveRequestPayloadProvider;
	private _replayChatProvider?: LiveReplayChatProvider;
	private readonly _statusBarItem: vscode.StatusBarItem;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		void vscode.commands.executeCommand('setContext', LIVE_REQUEST_EDITOR_VISIBLE_CONTEXT_KEY, false);
		this._registerProvider();
		this._registerMetadataProvider();
		this._registerPayloadProvider();
		this._registerReplayChatProvider();
		this._registerCommands();
		this._statusBarItem = this._disposables.add(vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10002));
		this._statusBarItem.name = 'Copilot Prompt Interception';
		this._watchInterceptionState();
	}

	dispose(): void {
		this._disposables.dispose();
	}

	private _watchInterceptionState(): void {
		const update = (state?: PromptInterceptionState) => this._updateStatusBar(state ?? this._liveRequestEditorService.getInterceptionState());
		this._disposables.add(this._liveRequestEditorService.onDidChangeInterception(update));
		update();
	}

	private _registerProvider(): void {
		try {
			this._provider = this._instantiationService.createInstance(
				LiveRequestEditorProvider,
				this._extensionContext.extensionUri
			);

			const registration = vscode.window.registerWebviewViewProvider(
				LiveRequestEditorProvider.viewType,
				this._provider,
				{
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			);

			this._disposables.add(registration);
			this._logService.trace('Live Request Editor provider registered');
		} catch (error) {
			this._logService.error('Failed to register Live Request Editor provider', error);
		}
	}

	private _registerMetadataProvider(): void {
		try {
			this._metadataProvider = this._instantiationService.createInstance(LiveRequestMetadataProvider);
			this._disposables.add(this._metadataProvider);
			const registration = vscode.window.registerTreeDataProvider(
				LiveRequestMetadataProvider.viewId,
				this._metadataProvider
			);
			this._disposables.add(registration);
			this._logService.trace('Live Request Metadata provider registered');
		} catch (error) {
			this._logService.error('Failed to register Live Request Metadata provider', error);
		}
	}

	private _registerPayloadProvider(): void {
		try {
			this._payloadProvider = this._instantiationService.createInstance(
				LiveRequestPayloadProvider,
				this._extensionContext.extensionUri
			);
			this._disposables.add(this._payloadProvider);
			const registration = vscode.window.registerWebviewViewProvider(
				LiveRequestPayloadProvider.viewType,
				this._payloadProvider,
				{
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			);
			this._disposables.add(registration);
			this._logService.trace('Live Request Payload provider registered');
		} catch (error) {
			this._logService.error('Failed to register Live Request Payload provider', error);
		}
	}

	private _registerReplayChatProvider(): void {
		try {
			this._replayChatProvider = this._disposables.add(this._instantiationService.createInstance(LiveReplayChatProvider));
		} catch (error) {
			this._logService.error('Failed to register Live Request Replay chat provider', error);
		}
	}

	private _registerCommands(): void {
		const showCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.show',
			async () => {
				try {
					await vscode.commands.executeCommand('github.copilot.liveRequestEditor.focus');
					this._provider?.show();
				} catch (error) {
					this._logService.error('Failed to show Live Request Editor', error);
					vscode.window.showErrorMessage(
						`Failed to show Live Request Editor: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		);

		const setModeCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.setMode',
			async () => {
				await this._pickMode();
			}
		);

		const configureScopeCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.configureAutoOverrideScope',
			async () => {
				await this._configureAutoOverrideScope();
			}
		);

		const configurePreviewLimitCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.configureAutoOverridePreviewLimit',
			async () => {
				await this._configureAutoOverridePreviewLimit();
			}
		);

		const clearOverridesCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.clearAutoOverrides',
			async () => {
				await this._clearAutoOverrideOverrides();
			}
		);

		const toggleCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.toggle',
			async () => {
				await this._toggleInspectorVisibility();
			}
		);

		const toggleInterceptionCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.toggleInterception',
			async (source: 'command' | 'statusBar' = 'command') => {
				await this._toggleInterceptionMode(source);
			}
		);

		const replayPromptCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.replayPrompt',
			async () => {
				if (!this._ensureLiveRequestEditorEnabled()) {
					return;
				}
				if (!this._liveRequestEditorService.isReplayEnabled()) {
					vscode.window.showInformationMessage('Timeline Replay is disabled. Enable github.copilot.chat.liveRequestEditor.timelineReplay.enabled to replay prompts.');
					return;
				}
				const current = this._provider?.getCurrentRequest();
				if (!current) {
					vscode.window.showInformationMessage('Nothing to replay yet. Edit a prompt first.');
					return;
				}
				const snapshot = this._liveRequestEditorService.buildReplayForRequest({ sessionId: current.sessionId, location: current.location });
				if (!snapshot) {
					vscode.window.showInformationMessage('Nothing to replay for this request.');
					return;
				}
				const projection = snapshot.projection;
				this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.replay.invoked', {
					state: snapshot.state,
					totalSections: String(projection?.totalSections ?? 0),
					edited: String(projection?.editedCount ?? 0),
					deleted: String(projection?.deletedCount ?? 0),
					overflow: String(projection?.overflowCount ?? 0),
				});
				this._replayChatProvider?.showReplay(snapshot);
			}
		);

		const configureMetadataCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestMetadata.configureFields',
			async () => {
				if (!this._metadataProvider) {
					return;
				}
				await this._metadataProvider.configureFields();
			}
		);

		const debugSampleReplayCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.debugReplaySample',
			async () => {
				this._replayChatProvider?.showSampleReplay();
			}
		);

		const openRawPayloadCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.openRawPayload',
			async (payload?: unknown) => {
				try {
					const text = typeof payload === 'string' ? payload : undefined;
					if (!text) {
						return;
					}
					const doc = await vscode.workspace.openTextDocument({ content: text, language: 'json' });
					await vscode.window.showTextDocument(doc, { preview: true });
				} catch (error) {
					this._logService.error('Failed to open raw payload in editor', error);
					vscode.window.showErrorMessage('Failed to open raw payload in an editor. See logs for details.');
				}
			}
		);

		const setPayloadSessionCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestPayload.setActiveSession',
			async (sessionKey?: { sessionId?: string; location?: number } | string) => {
				if (!this._payloadProvider) {
					return;
				}
				this._payloadProvider.setActiveSession(sessionKey);
			}
		);

		const showPayloadViewCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestPayload.show',
			async () => {
				try {
					await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
					await vscode.commands.executeCommand('github.copilot.liveRequestPayload.focus');
				} catch (error) {
					this._logService.error('Failed to show Live Request Payload view', error);
					vscode.window.showErrorMessage('Failed to open Live Request Payload. See logs for details.');
				}
			}
		);

		const openInChatCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.openInChat',
			async (sessionKey?: { sessionId?: string; location?: number } | string) => {
				try {
					const current = this._provider?.getCurrentRequest();
					let key: { sessionId: string; location: ChatLocation } | undefined;

					if (typeof sessionKey === 'string') {
						const [sessionId, location] = sessionKey.split('::');
						const parsed = Number(location);
						if (sessionId && Number.isFinite(parsed)) {
							key = { sessionId, location: parsed as ChatLocation };
						}
					} else if (sessionKey?.sessionId && typeof sessionKey.location === 'number') {
						key = { sessionId: sessionKey.sessionId, location: sessionKey.location as ChatLocation };
					} else if (current) {
						key = { sessionId: current.sessionId, location: current.location as ChatLocation };
					}

					if (!key) {
						return;
					}

					const request = this._liveRequestEditorService.getRequest(key);
					const resourceText = request?.metadata?.chatSessionResource ?? current?.metadata?.chatSessionResource;
					if (resourceText) {
						const resource = vscode.Uri.parse(resourceText);
						await vscode.commands.executeCommand('vscode.open', resource);
						return;
					}

					await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
					vscode.window.setStatusBarMessage('No chat session editor resource captured for this conversation.', 2500);
				} catch (error) {
					this._logService.error('Failed to open conversation in chat', error);
					vscode.window.showErrorMessage('Failed to open conversation in chat. See logs for details.');
				}
			}
		);

		const copyMetadataValue = vscode.commands.registerCommand(
			'github.copilot.liveRequestMetadata.copyValue',
			async (value?: string, label?: string) => {
				await this._metadataProvider?.copyValue(value ?? '', label ?? 'Metadata');
			}
		);

		this._disposables.add(showCommand);
		this._disposables.add(toggleCommand);
		this._disposables.add(toggleInterceptionCommand);
		this._disposables.add(setModeCommand);
		this._disposables.add(configureScopeCommand);
		this._disposables.add(configurePreviewLimitCommand);
		this._disposables.add(clearOverridesCommand);
		this._disposables.add(configureMetadataCommand);
		this._disposables.add(copyMetadataValue);
		this._disposables.add(replayPromptCommand);
		this._disposables.add(debugSampleReplayCommand);
		this._disposables.add(openRawPayloadCommand);
		this._disposables.add(showPayloadViewCommand);
		this._disposables.add(setPayloadSessionCommand);
		this._disposables.add(openInChatCommand);
	}

	private async _toggleInterceptionMode(source: 'command' | 'statusBar'): Promise<void> {
		if (!this._ensureLiveRequestEditorEnabled()) {
			return;
		}
		const currentMode = this._liveRequestEditorService.getMode();
		const next: LiveRequestEditorMode = currentMode === 'interceptAlways' ? 'off' : 'interceptAlways';
		try {
			await this._liveRequestEditorService.setMode(next);
			this._recordModeTelemetry(next, source);
			if (next !== 'off') {
				await vscode.commands.executeCommand('github.copilot.liveRequestEditor.show');
			}
		} catch (error) {
			this._logService.error('Failed to toggle Prompt Interception Mode', error);
			vscode.window.showErrorMessage('Failed to toggle Prompt Interception Mode. See output for details.');
		}
	}

	private _recordModeTelemetry(mode: LiveRequestEditorMode, source: 'command' | 'statusBar' | 'picker'): void {
		this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.modeChanged', {
			source,
			mode,
		});
	}

	private _ensureLiveRequestEditorEnabled(): boolean {
		if (!this._liveRequestEditorService.isEnabled()) {
			vscode.window.showWarningMessage('Enable the Live Request Editor to configure Prompt Interception.');
			return false;
		}
		return true;
	}

	private async _pickMode(): Promise<void> {
		if (!this._ensureLiveRequestEditorEnabled()) {
			return;
		}
		const state = this._liveRequestEditorService.getInterceptionState();
		const autoOverride = state.autoOverride;
		const picks: ModePickItem[] = [
			{ label: 'Send normally', description: 'Send requests immediately without pausing.', mode: 'off' },
			{ label: 'Pause & review every turn', description: 'Pause each request before sending.', mode: 'interceptAlways' }
		];
		if (autoOverride?.enabled) {
			const previewLabel = autoOverride.previewLimit === 1 ? 'first section' : `first ${autoOverride.previewLimit} sections`;
			picks.push({
				label: 'Auto-apply saved edits',
				description: `Capture once (first ${previewLabel}), then auto-apply edits.`,
				mode: 'autoOverride'
			});
		} else {
			picks.push({
				label: 'Auto-apply saved edits (disabled)',
				description: 'Enable github.copilot.chat.liveRequestEditor.autoOverride.enabled to unlock saved edits.',
				mode: 'autoOverride',
				disabled: true
			});
		}

		const selection = await vscode.window.showQuickPick<ModePickItem>(picks, {
			placeHolder: 'Select how Copilot prompts should send',
			canPickMany: false
		});
		if (!selection || selection.disabled) {
			return;
		}
		await this._liveRequestEditorService.setMode(selection.mode);
		this._recordModeTelemetry(selection.mode, 'picker');
		if (selection.mode !== 'off') {
			await vscode.commands.executeCommand('github.copilot.liveRequestEditor.show');
		}
	}

	private async _configureAutoOverrideScope(): Promise<void> {
		if (!this._ensureLiveRequestEditorEnabled()) {
			return;
		}
		const autoOverride = this._liveRequestEditorService.getInterceptionState().autoOverride;
		if (!autoOverride?.enabled) {
			vscode.window.showInformationMessage('Auto-apply edits is disabled in settings. Enable it to configure scope.');
			return;
		}
		const current = this._liveRequestEditorService.getAutoOverrideScope() ?? 'session';
		const picks: ScopePickItem[] = [
			{ label: 'Session', description: 'Apply overrides only to the active chat session.', scope: 'session' },
			{ label: 'Workspace', description: 'Reuse overrides across all chat sessions in this workspace.', scope: 'workspace' },
			{ label: 'Global', description: 'Reuse overrides across every workspace on this machine.', scope: 'global' }
		];
		const selection = await vscode.window.showQuickPick<ScopePickItem>(picks.map(pick => ({
			...pick,
			detail: pick.scope === current ? 'Current selection' : undefined
		})), {
			placeHolder: 'Choose where Auto-apply saves your edits',
			canPickMany: false
		});
		if (!selection) {
			return;
		}
		await this._liveRequestEditorService.setAutoOverrideScope(selection.scope);
		vscode.window.showInformationMessage(`Auto-apply scope set to ${selection.label}.`);
	}

	private async _configureAutoOverridePreviewLimit(): Promise<void> {
		if (!this._ensureLiveRequestEditorEnabled()) {
			return;
		}
		const autoOverride = this._liveRequestEditorService.getInterceptionState().autoOverride;
		if (!autoOverride?.enabled) {
			vscode.window.showInformationMessage('Auto-apply edits is disabled in settings. Enable it to configure the capture count.');
			return;
		}
		const current = autoOverride.previewLimit;
		const presets = [1, 2, 3, 4, 5];
		const picks: PreviewLimitPickItem[] = presets.map(value => ({
			label: value === 1 ? '1 section' : `${value} sections`,
			detail: value === current ? 'Current selection' : undefined,
			value
		}));
		picks.push({ label: 'Custom…', description: 'Enter a custom number of sections', custom: true });
		const selection = await vscode.window.showQuickPick<PreviewLimitPickItem>(picks, {
			placeHolder: 'How many prefix sections should Auto-apply capture?',
			canPickMany: false
		});
		if (!selection) {
			return;
		}
		let nextValue = selection.value ?? current;
		if (selection.custom) {
			const input = await vscode.window.showInputBox({
				prompt: 'Enter the number of sections to capture (minimum 1)',
				validateInput: value => {
					const parsed = Number(value);
					return Number.isInteger(parsed) && parsed >= 1 ? undefined : 'Enter an integer greater than or equal to 1';
				}
			});
			if (!input) {
				return;
			}
			nextValue = Math.max(1, Math.floor(Number(input)));
		}
		await this._liveRequestEditorService.configureAutoOverridePreviewLimit(nextValue);
		vscode.window.showInformationMessage(`Auto-apply capture limit set to ${nextValue}.`);
	}

	private async _clearAutoOverrideOverrides(): Promise<void> {
		if (!this._ensureLiveRequestEditorEnabled()) {
			return;
		}
		await this._liveRequestEditorService.clearAutoOverrides();
		vscode.window.showInformationMessage('Cleared saved Auto-apply edits.');
	}

	private async _toggleInspectorVisibility(): Promise<void> {
		if (!this._liveRequestEditorService.isEnabled()) {
			vscode.window.showWarningMessage('Enable the Live Request Editor to inspect prompts.');
			return;
		}
		try {
			if (this._provider?.isVisible()) {
				await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
			} else {
				await vscode.commands.executeCommand('github.copilot.liveRequestEditor.show');
			}
		} catch (error) {
			this._logService.error('Failed to toggle Live Request Editor visibility', error);
			vscode.window.showErrorMessage('Failed to toggle the Prompt Inspector. See output for details.');
		}
	}

	private _updateStatusBar(state: PromptInterceptionState): void {
		if (!this._liveRequestEditorService.isEnabled()) {
			this._statusBarItem.hide();
			return;
		}

		const pending = state.pending;
		const mode = state.mode ?? 'off';
		const displayMode = mode === 'interceptOnce' ? 'interceptAlways' : mode;
		let icon = '$(circle-slash)';
		let label = 'Prompt mode: Send normally';
		const tooltip = new vscode.MarkdownString(undefined, true);
		const lines: string[] = ['**Prompt Inspector Mode**'];

		if (mode === 'autoOverride') {
			const auto = state.autoOverride;
			icon = auto?.hasOverrides ? '$(symbol-namespace)' : '$(plug)';
			label = auto?.capturing ? 'Auto-apply edits: capturing…' : 'Auto-apply edits: applying';
			lines.push(auto?.capturing
				? 'Auto-apply is capturing the next turn (prefix sections only).'
				: auto?.hasOverrides ? 'Auto-apply is applying saved prefix edits.' : 'Enable Auto-apply to capture custom prefixes.');
			if (auto?.scope) {
				lines.push('', `Scope: **${auto.scope}**`);
			}
			lines.push('', 'Use the mode picker to change modes.');
		} else if (displayMode === 'interceptAlways' || state.enabled) {
			icon = pending ? '$(warning)' : '$(debug-pause)';
			label = pending ? 'Prompt mode: Paused' : (mode === 'interceptOnce' ? 'Prompt mode: Pausing next turn' : 'Prompt mode: Pause every turn');
			lines.push(mode === 'interceptOnce'
				? 'Next request will pause before sending so you can review it.'
				: 'Requests pause before sending so you can edit them in the Live Request Editor.');
			if (pending) {
				const pausedLabel = pending.debugName.replace(/`/g, '\\`');
				lines.push('', `Paused turn: \`${pausedLabel}\``);
				lines.push('', 'Click to review the pending request.');
			} else {
				lines.push('', 'Click to disable.');
			}
		} else {
			lines.push('Requests send immediately without pausing in the Live Request Editor.');
			lines.push('', 'Click to enable Prompt Interception.');
		}

		this._statusBarItem.text = `${icon} ${label}`;
		tooltip.appendMarkdown(lines.join('\n\n'));
		tooltip.supportThemeIcons = true;
		tooltip.isTrusted = true;
		this._statusBarItem.tooltip = tooltip;

		if (pending) {
			this._statusBarItem.command = 'github.copilot.liveRequestEditor.show';
		} else {
			this._statusBarItem.command = {
				command: 'github.copilot.liveRequestEditor.toggleInterception',
				title: 'Toggle Prompt Interception Mode',
				arguments: ['statusBar']
			};
		}
		this._statusBarItem.show();
	}
}
