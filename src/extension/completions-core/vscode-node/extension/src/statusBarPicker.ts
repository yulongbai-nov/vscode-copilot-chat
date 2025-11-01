/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { QuickPick, QuickPickItem, QuickPickItemKind, commands, window } from 'vscode';
import { isWeb } from '../../../../../util/vs/base/common/platform';
import { IInstantiationService } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { ICompletionsContextService } from '../../lib/src/context';
import { isCompletionEnabled, isInlineSuggestEnabled } from './config';
import { CMDCollectDiagnosticsChat, CMDDisableCompletionsChat, CMDEnableCompletionsChat, CMDOpenDocumentationClient, CMDOpenLogsClient } from './constants';
import { CopilotExtensionStatus } from './extensionStatus';
import { Icon } from './icon';

export class CopilotStatusBarPickMenu {
	private state: CopilotExtensionStatus;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICompletionsContextService private readonly contextService: ICompletionsContextService
	) {
		this.state = this.contextService.get(CopilotExtensionStatus);
	}

	showStatusMenu() {
		const quickpickList = window.createQuickPick();
		quickpickList.placeholder = 'Select an option';
		quickpickList.title = 'Configure Copilot Completions';
		quickpickList.items = this.collectQuickPickItems();
		quickpickList.onDidAccept(() => this.handleItemSelection(quickpickList));
		quickpickList.show();
		return quickpickList;
	}

	async handleItemSelection(quickpickList: QuickPick<QuickPickItem>): Promise<void> {
		const selection = quickpickList.selectedItems[0];
		if (selection === undefined) { return; }

		if ('command' in selection) {
			const commandSelection = selection as CommandQuickItem;
			await commands.executeCommand(commandSelection.command, ...commandSelection.commandArgs);
			quickpickList.hide();
		} else {
			throw new Error('Unexpected Copilot quick picker selection');
		}
	}

	private collectQuickPickItems() {
		return [
			this.newStatusItem(),
			this.newSeparator(),
			...this.collectLanguageSpecificItems(),
			this.newKeyboardItem(),
			this.newSettingsItem(),
			...this.collectDiagnosticsItems(),
			this.newOpenLogsItem(),
			this.newSeparator(),
			this.newDocsItem(),
			//this.newForumItem(),
		];
	}

	private collectLanguageSpecificItems() {
		const items: QuickPickItem[] = [];
		if (!this.hasActiveStatus()) { return items; }

		const editor = window.activeTextEditor;
		//if (!isWeb && editor) { items.push(this.newPanelItem()); }
		// Always show the model picker even if only one model is available
		// Except on web where the model picker is not available pending CORS
		// support from CAPI https://github.com/github/copilot-api/pull/12233
		//if (!isWeb) { items.push(this.newChangeModelItem()); }
		if (editor) { items.push(...this.newEnableLanguageItem()); }
		if (items.length) { items.push(this.newSeparator()); }

		return items;
	}

	private hasActiveStatus() {
		return ['Normal'].includes(this.state.kind);
	}

	private isCompletionEnabled() {
		return isInlineSuggestEnabled() && this.instantiationService.invokeFunction(isCompletionEnabled);
	}

	private newEnableLanguageItem() {
		const isEnabled = this.isCompletionEnabled();
		if (isEnabled) {
			return [this.newCommandItem('Disable Completions', CMDDisableCompletionsChat)];
		} else if (isEnabled === false) {
			return [this.newCommandItem('Enable Completions', CMDEnableCompletionsChat)];
		} else {
			return [];
		}
	}

	private newStatusItem() {
		let statusText;
		let statusIcon = Icon.Logo;
		switch (this.state.kind) {
			case 'Normal':
				statusText = 'Ready';
				if (isInlineSuggestEnabled() === false) {
					statusText += ' (VS Code inline suggestions disabled)';
				} else if (this.instantiationService.invokeFunction(isCompletionEnabled) === false) {
					statusText += ' (Disabled)';
				}
				break;
			case 'Inactive':
				statusText = this.state.message || 'Copilot is currently inactive';
				statusIcon = Icon.Blocked;
				break;
			default:
				statusText = this.state.message || 'Copilot has encountered an error';
				statusIcon = Icon.NotConnected;
				break;
		}
		return this.newCommandItem(`${statusIcon} Status: ${statusText}`, CMDOpenLogsClient);
	}

	private newOpenLogsItem() {
		return this.newCommandItem('Open Logs...', CMDOpenLogsClient);
	}

	private collectDiagnosticsItems() {
		if (isWeb) { return []; }
		return [this.newCommandItem('Show Diagnostics...', CMDCollectDiagnosticsChat)];
	}

	private newKeyboardItem() {
		return this.newCommandItem('$(keyboard) Edit Keyboard Shortcuts...', 'workbench.action.openGlobalKeybindings', [
			'copilot',
		]);
	}

	private newSettingsItem() {
		return this.newCommandItem('$(settings-gear) Edit Settings...', 'workbench.action.openSettings', [
			'GitHub Copilot',
		]);
	}
	/* 	private newPanelItem() {
	private newPanelItem() {
		return this.newCommandItem('Open Completions Panel...', CMDOpenPanel);
	}

	private newChangeModelItem() {
		return this.newCommandItem('Change Completions Model...', CMDOpenModelPicker);
	}

	private newForumItem() {
		return this.newCommandItem('$(comments-view-icon) View Copilot Forum...', CMDSendFeedback);
	} */

	private newDocsItem() {
		return this.newCommandItem(
			'$(remote-explorer-documentation) View Copilot Documentation...',
			CMDOpenDocumentationClient
		);
	}

	private newCommandItem(label: string, command: string, commandArgs?: string[]): CommandQuickItem {
		return new CommandQuickItem(label, command, commandArgs || []);
	}

	private newSeparator(): QuickPickItem {
		return {
			label: '',
			kind: QuickPickItemKind.Separator,
		};
	}
}

class CommandQuickItem implements QuickPickItem {
	constructor(
		readonly label: string,
		readonly command: string,
		readonly commandArgs: string[]
	) { }
}
