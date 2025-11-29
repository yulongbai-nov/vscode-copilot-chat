/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { ILiveRequestEditorService, PromptInterceptionState } from '../common/liveRequestEditorService';
import { LiveRequestEditorProvider } from './liveRequestEditorProvider';

export class LiveRequestEditorContribution implements IExtensionContribution {
	readonly id = 'liveRequestEditor';

	private readonly _disposables = new DisposableStore();
	private _provider?: LiveRequestEditorProvider;
	private readonly _statusBarItem: vscode.StatusBarItem;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		this._registerProvider();
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

		const toggleInterceptionCommand = vscode.commands.registerCommand(
			'github.copilot.liveRequestEditor.toggleInterception',
			async (source: 'command' | 'statusBar' = 'command') => {
				await this._toggleInterceptionMode(source);
			}
		);

		this._disposables.add(showCommand);
		this._disposables.add(toggleInterceptionCommand);
	}

	private async _toggleInterceptionMode(source: 'command' | 'statusBar'): Promise<void> {
		if (!this._liveRequestEditorService.isEnabled()) {
			vscode.window.showWarningMessage('Enable the Live Request Editor to use Prompt Interception Mode.');
			return;
		}
		const next = !this._liveRequestEditorService.isInterceptionEnabled();
		try {
			await this._configurationService.setConfig(ConfigKey.Advanced.LivePromptEditorInterception, next);
			this._recordInterceptionTelemetry(next, source);
			if (next) {
				await vscode.commands.executeCommand('github.copilot.liveRequestEditor.show');
			}
		} catch (error) {
			this._logService.error('Failed to toggle Prompt Interception Mode', error);
			vscode.window.showErrorMessage('Failed to toggle Prompt Interception Mode. See output for details.');
		}
	}

	private _recordInterceptionTelemetry(enabled: boolean, source: 'command' | 'statusBar'): void {
		this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.promptInterception.toggle', {
			source,
			enabled: enabled ? '1' : '0',
		});
	}

	private _updateStatusBar(state: PromptInterceptionState): void {
		if (!this._liveRequestEditorService.isEnabled()) {
			this._statusBarItem.hide();
			return;
		}

		const pending = state.pending;
		const icon = pending ? '$(warning)' : state.enabled ? '$(debug-pause)' : '$(circle-slash)';
		const suffix = pending ? 'On (request paused)' : state.enabled ? 'On' : 'Off';
		this._statusBarItem.text = `${icon} Prompt Interception: ${suffix}`;

		const tooltip = new vscode.MarkdownString(undefined, true);
		const lines: string[] = [
			'**Prompt Interception Mode**',
			state.enabled
				? 'Requests pause before sending so you can edit them in the Live Request Editor.'
				: 'Requests send immediately without pausing in the Live Request Editor.'
		];
		if (pending) {
			const pausedLabel = pending.debugName.replace(/`/g, '\\`');
			lines.push('', `Paused turn: \`${pausedLabel}\``);
			lines.push('', 'Click to review the pending request.');
		} else {
			lines.push('', state.enabled ? 'Click to disable.' : 'Click to enable.');
		}
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
