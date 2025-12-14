/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { workspace } from 'vscode';
import { IWorkspaceTrustService } from '../common/workspaceTrustService';

export class WorkspaceTrustServiceImpl implements IWorkspaceTrustService {
	declare readonly _serviceBrand: undefined;

	get isTrusted(): boolean {
		return workspace.isTrusted;
	}

	readonly onDidGrantWorkspaceTrust = workspace.onDidGrantWorkspaceTrust;
}

