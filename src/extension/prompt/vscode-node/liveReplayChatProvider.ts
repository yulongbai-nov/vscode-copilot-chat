/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { defaultAgentName, getChatParticipantIdFromName } from '../../../platform/chat/common/chatAgents';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { Event, Emitter } from '../../../util/vs/base/common/event';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatParticipantRequestHandler } from '../node/chatParticipantRequestHandler';
import { ILiveRequestEditorService } from '../common/liveRequestEditorService';
import { LiveRequestReplaySnapshot, LiveRequestReplaySection } from '../common/liveRequestEditorModel';

const REPLAY_SCHEME = 'copilot-live-replay';
const START_REPLAY_COMMAND = 'github.copilot.liveRequestEditor.startReplayChat';
const OPEN_LRE_COMMAND = 'github.copilot.liveRequestEditor.show';

interface ReplaySessionState {
	readonly resource: vscode.Uri;
	snapshot: LiveRequestReplaySnapshot;
	activated: boolean;
}

export class LiveReplayChatProvider extends Disposable implements vscode.ChatSessionContentProvider, vscode.ChatSessionItemProvider {
	private readonly _sessionsByKey = new Map<string, ReplaySessionState>();
	private readonly _sessionsByResource = new Map<string, ReplaySessionState>();
	private readonly _onDidChangeChatSessionItems = new Emitter<void>();
	readonly onDidChangeChatSessionItems = this._onDidChangeChatSessionItems.event;
	private readonly _onDidCommitChatSessionItem = new Emitter<{ original: vscode.ChatSessionItem; modified: vscode.ChatSessionItem }>();
	readonly onDidCommitChatSessionItem = this._onDidCommitChatSessionItem.event;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		const participant = vscode.chat.createChatParticipant('github.copilot.liveReplay.projection', async () => ({}));
		this._register(vscode.chat.registerChatSessionContentProvider(REPLAY_SCHEME, this, participant));
		this._register(vscode.chat.registerChatSessionItemProvider(REPLAY_SCHEME, this));
		this._register(vscode.commands.registerCommand(START_REPLAY_COMMAND, async (resource?: vscode.Uri) => {
			if (!resource) {
				return;
			}
			await this._activateReplay(resource);
		}));
	}

	showReplay(snapshot: LiveRequestReplaySnapshot): void {
		const composite = this._compositeKey(snapshot.key.sessionId, snapshot.key.location, snapshot.key.requestId);
		const existing = this._sessionsByKey.get(composite);
		const resource = existing?.resource ?? vscode.Uri.from({
			scheme: REPLAY_SCHEME,
			path: `/${encodeURIComponent(composite)}`
		});
		const state: ReplaySessionState = {
			resource,
			snapshot,
			activated: false
		};
		this._sessionsByKey.set(composite, state);
		this._sessionsByResource.set(resource.toString(), state);
		this._onDidChangeChatSessionItems.fire();
		void vscode.commands.executeCommand('vscode.open', resource);
		void vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
	}

	async provideChatSessionContent(resource: vscode.Uri, _token: vscode.CancellationToken): Promise<vscode.ChatSession> {
		const state = this._getState(resource);
		if (!state) {
			return {
				history: [new vscode.ChatResponseTurn2([new vscode.ChatResponseMarkdownPart('Replay expired or not found.')], {}, 'copilot')],
				requestHandler: undefined
			};
		}

		const snapshot = state.snapshot;
		const projection = snapshot.projection;
		const ready = snapshot.state === 'ready' || snapshot.state === 'forkActive';
		const history = projection ? this._buildDisplayHistory(state) : [
			new vscode.ChatResponseTurn2([new vscode.ChatResponseMarkdownPart('Nothing to replay.')], {}, 'copilot')
		];

		return {
			history,
			requestHandler: ready && state.activated
				? async (request, _context, stream, token) => this._handleRequest(state, request, stream, token)
				: undefined
		};
	}

	private async _handleRequest(state: ReplaySessionState, request: vscode.ChatRequest, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<vscode.ChatResult> {
		const composite = this._compositeKey(state.snapshot.key.sessionId, state.snapshot.key.location, state.snapshot.key.requestId);
		try {
			const forkId = state.resource.toString();
			const updated = this._liveRequestEditorService.markReplayForkActive(state.snapshot.key, forkId);
			if (updated) {
				state.snapshot = updated;
				this._sessionsByKey.set(composite, state);
				this._sessionsByResource.set(state.resource.toString(), state);
			}
		} catch (error) {
			this._logService.error('LiveReplayChatProvider: failed to mark replay as fork active', error);
		}

		const history = this._buildPayloadHistory(state.snapshot);
		const handler = this._instantiationService.createInstance(
			ChatParticipantRequestHandler,
			history,
			request,
			stream,
			token,
			{ agentName: defaultAgentName, agentId: getChatParticipantIdFromName(defaultAgentName) },
			Event.None
		);
		return handler.getResult();
	}

	private async _activateReplay(resource: vscode.Uri): Promise<void> {
		const state = this._getState(resource);
		if (!state) {
			return;
		}
		if (!state.activated) {
			state.activated = true;
			const updated = this._liveRequestEditorService.markReplayForkActive(state.snapshot.key, resource.toString());
			if (updated) {
				state.snapshot = updated;
			}
			this._sessionsByResource.set(resource.toString(), state);
			const key = this._compositeKey(state.snapshot.key.sessionId, state.snapshot.key.location, state.snapshot.key.requestId);
			this._sessionsByKey.set(key, state);
		}
		try {
			await vscode.commands.executeCommand('vscode.open', resource);
			await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
		} catch (error) {
			this._logService.error('LiveReplayChatProvider: failed to activate replay session', error);
		}
		this._onDidChangeChatSessionItems.fire();
	}

	private _buildDisplayHistory(state: ReplaySessionState): vscode.ChatResponseTurn2[] {
		const snapshot = state.snapshot;
		const projection = snapshot.projection;
		if (!projection) {
			return [new vscode.ChatResponseTurn2([new vscode.ChatResponseMarkdownPart('Nothing to replay.')], {}, 'copilot')];
		}

		const summaryLines: string[] = [];
		const editedSummary: string[] = [];
		const stateLabel = snapshot.state === 'forkActive' ? 'input enabled' : snapshot.state;
		const sourceLabel = snapshot.debugName ?? snapshot.key.sessionId;
		summaryLines.push(`**Replay edited prompt** · ${sourceLabel}`);
		summaryLines.push(`State: ${stateLabel}${snapshot.staleReason ? ` (${snapshot.staleReason})` : ''}`);
		summaryLines.push(`Sections: ${projection.totalSections}${projection.overflowCount > 0 ? ` (+${projection.overflowCount} more)` : ''}`);
		editedSummary.push(`Edited: ${projection.editedCount}`);
		editedSummary.push(`Deleted: ${projection.deletedCount}`);
		if (projection.trimmed) {
			editedSummary.push('Trimmed: yes');
		}
		summaryLines.push(editedSummary.join(' · '));
		if (snapshot.updatedAt) {
			summaryLines.push(`Updated: ${new Date(snapshot.updatedAt).toLocaleTimeString()}`);
		}

		const summaryParts: Array<vscode.ChatResponseMarkdownPart | vscode.ChatResponseCommandButtonPart> = [
			new vscode.ChatResponseMarkdownPart(summaryLines.join('\n'))
		];
		if (snapshot.state === 'stale') {
			summaryParts.push(new vscode.ChatResponseMarkdownPart('⚠️ Replay is stale. Rebuild from the Live Request Editor to continue.'));
		} else {
			const startLabel = state.activated ? 'Input enabled for this replay' : 'Start chatting from this replay';
			summaryParts.push(new vscode.ChatResponseMarkdownPart(' '));
			summaryParts.push(new vscode.ChatResponseMarkdownPart('Actions:'));
			summaryParts.push(new vscode.ChatResponseCommandButtonPart({ title: startLabel, command: START_REPLAY_COMMAND, arguments: [state.resource] }));
		}
		summaryParts.push(new vscode.ChatResponseCommandButtonPart({ title: 'Open Live Request Editor', command: OPEN_LRE_COMMAND }));

		const sectionMarkdown: vscode.ChatResponseMarkdownPart[] = [];
		for (const section of projection.sections) {
			sectionMarkdown.push(new vscode.ChatResponseMarkdownPart(this._formatSection(section)));
		}
		if (projection.overflowCount > 0) {
			sectionMarkdown.push(new vscode.ChatResponseMarkdownPart(`…and ${projection.overflowCount} more sections not shown.`));
		}
		if (projection.trimmed) {
			sectionMarkdown.push(new vscode.ChatResponseMarkdownPart('⚠️ Prompt was trimmed; replay may omit truncated content.'));
		}

		return [
			new vscode.ChatResponseTurn2(summaryParts, {}, getChatParticipantIdFromName(defaultAgentName)),
			new vscode.ChatResponseTurn2(sectionMarkdown, {}, getChatParticipantIdFromName(defaultAgentName))
		];
	}

	private _formatSection(section: LiveRequestReplaySection): string {
		const chips: string[] = [];
		if (section.edited) {
			chips.push('edited');
		}
		const toolName = (section.metadata as { toolInvocation?: { name?: string } } | undefined)?.toolInvocation?.name;
		if (toolName) {
			chips.push(`tool:${toolName}`);
		}
		if (section.collapsed) {
			chips.push('collapsed');
		}

		const header = `**${section.kind.toUpperCase()}**${section.label ? ` · ${section.label}` : ''}${chips.length ? ` · ${chips.join(' · ')}` : ''}`;
		const body = this._summarizeContent(section.content, section.collapsed);
		return `${header}\n${body || '_empty_'}`;
	}

	private _summarizeContent(content: string | undefined, collapsed: boolean): string {
		if (!content) {
			return '';
		}
		const trimmed = content.trim();
		if (!collapsed && trimmed.length <= 800) {
			return trimmed;
		}
		const preview = trimmed.slice(0, 800);
		return `${preview}${preview.length < trimmed.length ? ' …' : ''}`;
	}

	private _buildPayloadHistory(snapshot: LiveRequestReplaySnapshot): (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[] {
		const history: (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[] = [];
		for (const message of snapshot.payload ?? []) {
			const text = this._renderMessageText(message).trim();
			const participant = getChatParticipantIdFromName(defaultAgentName);
			if (message.role === Raw.ChatRole.User) {
				const requestTurn = new vscode.ChatRequestTurn2(text || '[user]', undefined, [], participant, [], undefined, undefined);
				history.push(requestTurn);
				const response = new vscode.ChatResponseTurn2([], { metadata: {} }, participant);
				history.push(response as unknown as vscode.ChatResponseTurn);
			} else {
				const label = message.role ? `[${message.role}]` : '[assistant]';
				history.push(new vscode.ChatRequestTurn2(label, undefined, [], participant, [], undefined, undefined));
				const parts = text ? [new vscode.ChatResponseMarkdownPart(text)] : [];
				const response = new vscode.ChatResponseTurn2(parts, { metadata: {} }, participant);
				history.push(response as unknown as vscode.ChatResponseTurn);
			}
		}
		return history;
	}

	private _renderMessageText(message: Raw.ChatMessage): string {
		const pieces: string[] = [];
		for (const part of message.content ?? []) {
			const unknownPart = part as { text?: unknown; content?: unknown; type?: unknown; toolCallId?: unknown };
			if (part.type === Raw.ChatCompletionContentPartKind.Text) {
				pieces.push(part.text ?? '');
			} else if ('text' in part && typeof part.text === 'string') {
				pieces.push(part.text);
			} else if (typeof unknownPart.content === 'string') {
				pieces.push(unknownPart.content);
			} else if (unknownPart.type === 'image_url') {
				pieces.push('[image]');
			} else if (unknownPart.toolCallId) {
				pieces.push(`Tool call: ${unknownPart.toolCallId}`);
			}
		}
		return pieces.join('\n');
	}

	private _compositeKey(sessionId: string, location: number, requestId: string): string {
		return `${sessionId}::${location}::${requestId}`;
	}

	private _getState(resource: vscode.Uri): ReplaySessionState | undefined {
		return this._sessionsByResource.get(resource.toString()) ?? this._sessionsByResource.get(resource.toString(true));
	}

	// ChatSessionItemProvider
	provideChatSessionItems(_token: vscode.CancellationToken): vscode.ProviderResult<vscode.ChatSessionItem[]> {
		const items: vscode.ChatSessionItem[] = [];
		for (const state of this._sessionsByKey.values()) {
			const label = this._buildLabel(state.snapshot);
			const description = this._buildDescription(state.snapshot);
			items.push({
				resource: state.resource,
				label,
				description,
				status: undefined,
				tooltip: description,
			});
		}
		return items;
	}

	private _buildLabel(snapshot: LiveRequestReplaySnapshot): string {
		const sessionTail = snapshot.key.sessionId.slice(-6);
		const turnTail = snapshot.key.requestId.slice(-4);
		const name = snapshot.debugName ? snapshot.debugName : `session ${sessionTail}`;
		return `Replay · ${name} · turn ${turnTail}`;
	}

	private _buildDescription(snapshot: LiveRequestReplaySnapshot): string {
		const parts = [
			`state: ${snapshot.state}`,
			`sessions: ${snapshot.key.sessionId.slice(-6)}`,
			`turn: ${snapshot.key.requestId.slice(-6)}`
		];
		if (snapshot.projection) {
			parts.push(`sections: ${snapshot.projection.totalSections}`);
		}
		return parts.join(' · ');
	}
}
