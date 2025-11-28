/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/vs/base/common/event';
import { EditableChatRequest, EditableChatRequestInit, LiveRequestSessionKey } from './liveRequestEditorModel';

export const ILiveRequestEditorService = createServiceIdentifier<ILiveRequestEditorService>('ILiveRequestEditorService');

export interface ILiveRequestEditorService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<EditableChatRequest>;

	isEnabled(): boolean;

	prepareRequest(init: EditableChatRequestInit): EditableChatRequest | undefined;

	getRequest(key: LiveRequestSessionKey): EditableChatRequest | undefined;

	updateSectionContent(key: LiveRequestSessionKey, sectionId: string, newContent: string): EditableChatRequest | undefined;

	deleteSection(key: LiveRequestSessionKey, sectionId: string): EditableChatRequest | undefined;

	restoreSection(key: LiveRequestSessionKey, sectionId: string): EditableChatRequest | undefined;

	resetRequest(key: LiveRequestSessionKey): EditableChatRequest | undefined;

	getMessagesForSend(key: LiveRequestSessionKey, fallback: Raw.ChatMessage[]): Raw.ChatMessage[];
}
