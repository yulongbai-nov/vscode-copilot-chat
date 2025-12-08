/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { ILiveRequestEditorService } from '../common/liveRequestEditorService';
import { EditableChatRequest, LiveRequestSessionKey, LiveRequestSection } from '../common/liveRequestEditorModel';

const SECTION_CAP = 30;

function parseSessionKey(raw?: string): LiveRequestSessionKey | undefined {
	if (!raw) {
		return undefined;
	}
	const [sessionId, locationPart] = raw.split('::');
	if (!sessionId || !locationPart) {
		return undefined;
	}
	const location = Number(locationPart);
	if (Number.isNaN(location)) {
		return undefined;
	}
	return { sessionId, location: location as ChatLocation };
}

export class LiveRequestReplaySessionProvider extends Disposable implements vscode.ChatSessionContentProvider {
	public static readonly scheme = 'copilot-live-replay';
	public static readonly participantId = 'github.copilot.liveRequestReplay';

	constructor(
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	provideChatSessionContent(resource: vscode.Uri, _token: vscode.CancellationToken): vscode.ChatSession {
		const params = new URLSearchParams(resource.query);
		const sessionId = params.get('sessionId') ?? undefined;
		const locationRaw = params.get('location') ?? undefined;
		const requestId = params.get('requestId') ?? undefined;
		const debugName = params.get('debugName') ?? undefined;
		const compositeKey = params.get('sessionKey') ?? undefined;

		const explicitKey = compositeKey ? parseSessionKey(compositeKey) : undefined;
		const key: LiveRequestSessionKey | undefined = explicitKey ?? (sessionId && locationRaw
			? { sessionId, location: Number(locationRaw) as ChatLocation }
			: undefined);

		if (!key) {
			return this._buildMessageSession('Nothing to replay: missing request context.');
		}

		const request = this._liveRequestEditorService.getRequest(key);
		if (!request) {
			return this._buildMessageSession('Nothing to replay: edited prompt not found for the selected conversation.');
		}

		const history = this._buildHistory(request, { requestId, debugName });
		return {
			history,
			requestHandler: undefined
		};
	}

	private _buildHistory(request: EditableChatRequest, metadata: { requestId?: string; debugName?: string }): ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn2> {
		const history: (vscode.ChatRequestTurn | vscode.ChatResponseTurn2)[] = [];
		const sections = request.sections.filter(section => !section.deleted);
		const overflow = Math.max(0, sections.length - SECTION_CAP);
		const visibleSections = overflow > 0 ? sections.slice(-SECTION_CAP) : sections;

		const header = new vscode.MarkdownString(undefined, true);
		header.appendMarkdown(`**Replayed prompt** · ${this._describeConversation(request, metadata)}\n\n`);
		if (overflow > 0) {
			header.appendMarkdown(`Showing the latest ${SECTION_CAP} of ${sections.length} sections. (${overflow} more omitted)\n\n`);
		}
		if (request.metadata?.lastValidationErrorCode === 'empty') {
			header.appendMarkdown('The prompt was empty after edits; nothing to replay.\n\n');
		}
		history.push(this._responseTurn(header));

		for (const section of visibleSections) {
			const content = this._renderSection(section);
			if (!content) {
				continue;
			}
			if (section.kind === 'user') {
				history.push(new vscode.ChatRequestTurn2(content, undefined, [], LiveRequestReplaySessionProvider.participantId, [], undefined, undefined));
			} else {
				history.push(this._responseTurn(new vscode.MarkdownString(content, true)));
			}
		}

		if (!visibleSections.length) {
			history.push(this._responseTurn(new vscode.MarkdownString('Nothing to replay after applying edits.', true)));
		}

		return history;
	}

	private _renderSection(section: LiveRequestSection): string | undefined {
		const content = (section.content ?? '').trim();
		const edited = section.editedContent !== undefined && section.editedContent !== section.originalContent;
		const override = section.overrideState ? ` · ${section.overrideState.scope} override` : '';
		const editedBadge = edited ? ' *(Edited)*' : '';
		const kindLabel = this._describeSectionKind(section);
		const toolName = this._readToolName(section);
		const toolLabel = toolName
			? ` · ${toolName}`
			: '';
		const header = `**${kindLabel}${toolLabel}${override}**${editedBadge}`;
		if (!content.length) {
			return `${header}\n\n_(no content)_`;
		}
		return `${header}\n\n${content}`;
	}

	private _readToolName(section: LiveRequestSection): string | undefined {
		if (!section.metadata || typeof section.metadata !== 'object') {
			return undefined;
		}
		const toolInvocation = (section.metadata as { toolInvocation?: unknown }).toolInvocation;
		if (!toolInvocation || typeof toolInvocation !== 'object') {
			return undefined;
		}
		const candidate = (toolInvocation as { name?: unknown }).name;
		return typeof candidate === 'string' ? candidate : undefined;
	}

	private _describeSectionKind(section: LiveRequestSection): string {
		switch (section.kind) {
			case 'system':
				return 'System';
			case 'history':
				return 'History';
			case 'context':
				return 'Context';
			case 'assistant':
				return 'Assistant';
			case 'tool':
				return 'Tool';
			case 'prediction':
				return 'Prediction';
			case 'metadata':
				return 'Metadata';
			case 'user':
			default:
				return 'User';
		}
	}

	private _describeConversation(request: EditableChatRequest, metadata: { requestId?: string; debugName?: string }): string {
		const sessionTail = request.sessionId.slice(-6);
		const parts = [
			metadata.debugName || request.debugName || 'Chat',
			`…${sessionTail}`
		];
		if (metadata.requestId) {
			parts.push(`req ${metadata.requestId}`);
		}
		return parts.join(' · ');
	}

	private _responseTurn(markdown: vscode.MarkdownString): vscode.ChatResponseTurn2 {
		return new vscode.ChatResponseTurn2(
			[new vscode.ChatResponseMarkdownPart(markdown)],
			{},
			LiveRequestReplaySessionProvider.participantId
		);
	}

	private _buildMessageSession(message: string): vscode.ChatSession {
		this._logService.debug('[LiveRequestReplaySessionProvider] ' + message);
		return {
			history: [this._responseTurn(new vscode.MarkdownString(message, true))],
			requestHandler: undefined
		};
	}
}
