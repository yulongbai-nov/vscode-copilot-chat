/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RenderPromptResult } from '@vscode/prompt-tsx';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { createServiceIdentifier } from '../../../util/common/services';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { EditableChatRequest, EditableChatRequestBuilder, EditableChatRequestMetadata } from '../common/editableChatRequest';

/**
 * Key for identifying an editable request by session and location.
 */
export interface IEditableRequestKey {
	sessionId: string;
	location: ChatLocation;
}

function makeKey(key: IEditableRequestKey): string {
	return `${key.sessionId}:${key.location}`;
}

/**
 * Service interface for managing editable chat requests.
 */
export const IEditableChatRequestService = createServiceIdentifier<IEditableChatRequestService>('IEditableChatRequestService');

export interface IEditableChatRequestService {
	readonly _serviceBrand: undefined;

	/**
	 * Whether the Live Prompt Editor feature is enabled.
	 */
	readonly isEnabled: boolean;

	/**
	 * Gets the current editable request for a session/location, if one exists.
	 */
	getEditableRequest(key: IEditableRequestKey): EditableChatRequest | undefined;

	/**
	 * Creates a new editable request from a render prompt result.
	 * This replaces any existing editable request for the same session/location.
	 */
	createEditableRequest(
		key: IEditableRequestKey,
		debugName: string,
		model: string,
		renderResult: RenderPromptResult,
		metadata?: EditableChatRequestMetadata,
	): EditableChatRequest;

	/**
	 * Clears the editable request for a session/location.
	 */
	clearEditableRequest(key: IEditableRequestKey): void;

	/**
	 * Gets all active editable requests.
	 */
	getAllEditableRequests(): ReadonlyMap<string, EditableChatRequest>;

	/**
	 * Clears all editable requests.
	 */
	clearAll(): void;
}

/**
 * Implementation of the editable chat request service.
 */
export class EditableChatRequestService extends Disposable implements IEditableChatRequestService {
	declare readonly _serviceBrand: undefined;

	private readonly _editableRequests = new Map<string, EditableChatRequest>();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	/**
	 * Whether the Live Prompt Editor feature is enabled.
	 */
	get isEnabled(): boolean {
		return this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorEnabled);
	}

	/**
	 * Gets the current editable request for a session/location, if one exists.
	 */
	getEditableRequest(key: IEditableRequestKey): EditableChatRequest | undefined {
		return this._editableRequests.get(makeKey(key));
	}

	/**
	 * Creates a new editable request from a render prompt result.
	 */
	createEditableRequest(
		key: IEditableRequestKey,
		debugName: string,
		model: string,
		renderResult: RenderPromptResult,
		metadata?: EditableChatRequestMetadata,
	): EditableChatRequest {
		const keyStr = makeKey(key);

		// Clear any existing request for this key
		this._clearEditableRequestByKey(keyStr);

		// Create the new editable request
		const editableRequest = EditableChatRequestBuilder.fromRenderPromptResult(
			debugName,
			model,
			key.location,
			key.sessionId,
			renderResult,
			metadata,
		);

		this._editableRequests.set(keyStr, editableRequest);
		this._logService.trace(`[EditableChatRequestService] Created editable request for ${keyStr}, sections: ${editableRequest.sections.length}`);

		return editableRequest;
	}

	/**
	 * Clears the editable request for a session/location.
	 */
	clearEditableRequest(key: IEditableRequestKey): void {
		this._clearEditableRequestByKey(makeKey(key));
	}

	/**
	 * Gets all active editable requests.
	 */
	getAllEditableRequests(): ReadonlyMap<string, EditableChatRequest> {
		return this._editableRequests;
	}

	/**
	 * Clears all editable requests.
	 */
	clearAll(): void {
		for (const key of [...this._editableRequests.keys()]) {
			this._clearEditableRequestByKey(key);
		}
	}

	private _clearEditableRequestByKey(keyStr: string): void {
		const existing = this._editableRequests.get(keyStr);
		if (existing) {
			existing.dispose();
			this._editableRequests.delete(keyStr);
		}
	}

	override dispose(): void {
		this.clearAll();
		super.dispose();
	}
}
