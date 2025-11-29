/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { deepClone, equals } from '../../../util/vs/base/common/objects';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { LiveRequestSessionKey, EditableChatRequest, EditableChatRequestInit, LiveRequestSectionKind } from '../common/liveRequestEditorModel';
import { ILiveRequestEditorService } from '../common/liveRequestEditorService';
import { createSectionsFromMessages, buildEditableChatRequest } from './liveRequestBuilder';

export class LiveRequestEditorService extends Disposable implements ILiveRequestEditorService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<EditableChatRequest>());
	public readonly onDidChange: Event<EditableChatRequest> = this._onDidChange.event;

	private readonly _requests = new Map<string, EditableChatRequest>();
	private _enabled: boolean;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
		this._enabled = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorEnabled);
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ConfigKey.Advanced.LivePromptEditorEnabled.fullyQualifiedId)) {
				this._enabled = this._configurationService.getConfig(ConfigKey.Advanced.LivePromptEditorEnabled);
				if (!this._enabled) {
					this._requests.clear();
				}
			}
		}));
	}

	isEnabled(): boolean {
		return this._enabled;
	}

	prepareRequest(init: EditableChatRequestInit): EditableChatRequest | undefined {
		if (!this._enabled) {
			this._requests.delete(this.toKey(init.sessionId, init.location));
			return undefined;
		}
		const request = buildEditableChatRequest(init);
		this._requests.set(this.toKey(init.sessionId, init.location), request);
		this._onDidChange.fire(request);
		return request;
	}

	getRequest(key: LiveRequestSessionKey): EditableChatRequest | undefined {
		return this._requests.get(this.toKey(key.sessionId, key.location));
	}

	updateSectionContent(key: LiveRequestSessionKey, sectionId: string, newContent: string): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			const section = request.sections.find(s => s.id === sectionId);
			if (!section || !section.editable) {
				return false;
			}
			section.content = newContent;
			section.editedContent = newContent;
			section.deleted = false;
			return true;
		}, true);
	}

	deleteSection(key: LiveRequestSessionKey, sectionId: string): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			const section = request.sections.find(s => s.id === sectionId);
			if (!section || !section.deletable) {
				return false;
			}
			if (section.deleted) {
				return false;
			}
			section.deleted = true;
			return true;
		}, true);
	}

	restoreSection(key: LiveRequestSessionKey, sectionId: string): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			const section = request.sections.find(s => s.id === sectionId);
			if (!section) {
				return false;
			}
			if (!section.deleted) {
				return false;
			}
			section.deleted = false;
			return true;
		}, true);
	}

	resetRequest(key: LiveRequestSessionKey): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			request.messages = deepClone(request.originalMessages);
			request.sections = createSectionsFromMessages(request.messages);
			request.isDirty = false;
			return true;
		}, false);
	}

	updateTokenCounts(key: LiveRequestSessionKey, tokenCounts: { total?: number; perMessage?: number[] }): EditableChatRequest | undefined {
		return this.withRequest(key, request => {
			let didChange = false;
			if (typeof tokenCounts.total === 'number' && tokenCounts.total >= 0) {
				request.metadata.tokenCount = tokenCounts.total;
				didChange = true;
			}
			if (tokenCounts.perMessage && tokenCounts.perMessage.length) {
				for (const section of request.sections) {
					const value = tokenCounts.perMessage[section.sourceMessageIndex];
					if (typeof value === 'number') {
						section.tokenCount = value;
						didChange = true;
					}
				}
			}
			return didChange;
		}, false);
	}

	getMessagesForSend(key: LiveRequestSessionKey, fallback: Raw.ChatMessage[]): Raw.ChatMessage[] {
		if (!this._enabled) {
			return fallback;
		}
		const request = this.getRequest(key);
		if (!request) {
			return fallback;
		}
		this.recomputeMessages(request);
		return request.messages.length ? request.messages : fallback;
	}

	private withRequest(
		key: LiveRequestSessionKey,
		mutator: (request: EditableChatRequest) => boolean,
		recompute: boolean,
	): EditableChatRequest | undefined {
		if (!this._enabled) {
			return undefined;
		}
		const request = this.getRequest(key);
		if (!request) {
			return undefined;
		}
		const didMutate = mutator(request);
		if (!didMutate) {
			return request;
		}
		if (recompute) {
			this.recomputeMessages(request);
		} else {
			request.isDirty = !equals(request.messages, request.originalMessages);
		}
		this._onDidChange.fire(request);
		return request;
	}

	private recomputeMessages(request: EditableChatRequest): void {
		const updatedMessages: Raw.ChatMessage[] = [];
		let isDirty = false;
		let expectedIndex = 0;

		for (const section of request.sections) {
			if (section.deleted) {
				if (!isDirty) {
					isDirty = true;
				}
				continue;
			}

			const originalMessage = request.originalMessages[section.sourceMessageIndex];
			let message: Raw.ChatMessage;
			if (originalMessage) {
				message = deepClone(originalMessage);
			} else {
				message = this.createMessageShell(section.kind);
				isDirty = true;
			}

			if (section.editedContent !== undefined) {
				message.content = [{
					type: Raw.ChatCompletionContentPartKind.Text,
					text: section.editedContent
				}];
				isDirty = true;
			}

			section.message = message;
			updatedMessages.push(message);
			if (section.sourceMessageIndex !== expectedIndex) {
				isDirty = true;
			}
			expectedIndex++;
		}

		if (!isDirty && updatedMessages.length !== request.originalMessages.length) {
			isDirty = true;
		}

		request.messages = updatedMessages;
		request.isDirty = isDirty || !equals(updatedMessages, request.originalMessages);
	}

	private createMessageShell(kind: LiveRequestSectionKind): Raw.ChatMessage {
		const role = kindToRole(kind);
		if (role === Raw.ChatRole.Tool) {
			return {
				role,
				toolCallId: '',
				content: [{
					type: Raw.ChatCompletionContentPartKind.Text,
					text: ''
				}]
			};
		}

		return {
			role,
			content: [{
				type: Raw.ChatCompletionContentPartKind.Text,
				text: ''
			}]
		};
	}

	private toKey(sessionId: string, location: number): string {
		return `${sessionId}::${location}`;
	}
}

function kindToRole(kind: LiveRequestSectionKind): Raw.ChatRole {
	switch (kind) {
		case 'system':
			return Raw.ChatRole.System;
		case 'assistant':
			return Raw.ChatRole.Assistant;
		case 'tool':
			return Raw.ChatRole.Tool;
		default:
			return Raw.ChatRole.User;
	}
}
