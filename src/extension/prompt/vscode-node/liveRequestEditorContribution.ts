/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { LiveRequestEditorProvider } from './liveRequestEditorProvider';

export class LiveRequestEditorContribution implements IExtensionContribution {
	readonly id = 'liveRequestEditor';

	private readonly _disposables = new DisposableStore();
	private _provider?: LiveRequestEditorProvider;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
	) {
		this._registerProvider();
		this._registerCommands();
	}

	dispose(): void {
		this._disposables.dispose();
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

		this._disposables.add(showCommand);
	}
}
