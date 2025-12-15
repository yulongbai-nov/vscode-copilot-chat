/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

export const IWorkspaceTrustService = createServiceIdentifier<IWorkspaceTrustService>('IWorkspaceTrustService');

export interface IWorkspaceTrustService {
	readonly _serviceBrand: undefined;
	readonly isTrusted: boolean;
	readonly onDidGrantWorkspaceTrust: Event<void>;
}

