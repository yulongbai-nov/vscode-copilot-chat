/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { defaultAgentName, getChatParticipantIdFromName } from '../../../platform/chat/common/chatAgents';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { Event, Emitter } from '../../../util/vs/base/common/event';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatParticipantRequestHandler } from '../node/chatParticipantRequestHandler';
import { ILiveRequestEditorService } from '../common/liveRequestEditorService';
import { LiveRequestReplaySnapshot, LiveRequestReplaySection } from '../common/liveRequestEditorModel';
import { buildReplayChatViewModel } from './liveReplayViewModel';

export const REPLAY_SCHEME = 'copilot-live-replay';
export const REPLAY_FORK_SCHEME = 'copilot-live-replay-fork';
const REPLAY_PARTICIPANT_ID = REPLAY_SCHEME;
const START_REPLAY_COMMAND = 'github.copilot.liveRequestEditor.startReplayChat';
const OPEN_LRE_COMMAND = 'github.copilot.liveRequestEditor.show';
const TOGGLE_VIEW_COMMAND = 'github.copilot.liveRequestEditor.toggleReplayView';

interface ReplaySessionState {
	readonly resource: vscode.Uri;
	snapshot: LiveRequestReplaySnapshot;
	activated: boolean;
	view: 'payload' | 'projection';
}

export class LiveReplayChatProvider extends Disposable implements vscode.ChatSessionContentProvider, vscode.ChatSessionItemProvider {
	private readonly _sessionsByKey = new Map<string, ReplaySessionState>();
	private readonly _sessionsByResource = new Map<string, ReplaySessionState>();
	private readonly _onDidChangeChatSessionItems = new Emitter<void>();
	readonly onDidChangeChatSessionItems = this._onDidChangeChatSessionItems.event;
	private readonly _onDidCommitChatSessionItem = new Emitter<{ original: vscode.ChatSessionItem; modified: vscode.ChatSessionItem }>();
	readonly onDidCommitChatSessionItem = this._onDidCommitChatSessionItem.event;

	private _rememberState(state: ReplaySessionState): void {
		const resource = state.resource;
		const keys = [
			resource.toString(),
			resource.toString(true),
			resource.path,
			resource.path ? decodeURIComponent(resource.path) : undefined
		].filter(Boolean) as string[];
		for (const key of keys) {
			this._sessionsByResource.set(key, state);
		}
		this._logService.info(`[LiveReplay] cached state for keys=${keys.join('|')}`);
	}

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._logService.info('[LiveReplay] registering providers');
		const participant = vscode.chat.createChatParticipant(REPLAY_PARTICIPANT_ID, async () => ({}));
		const forkParticipant = vscode.chat.createChatParticipant(REPLAY_FORK_SCHEME, async () => ({}));
		const contentDisposable = vscode.chat.registerChatSessionContentProvider(REPLAY_SCHEME, this, participant);
		const forkContentDisposable = vscode.chat.registerChatSessionContentProvider(REPLAY_FORK_SCHEME, this, forkParticipant);
		const itemDisposable = vscode.chat.registerChatSessionItemProvider(REPLAY_SCHEME, this);
		const forkItemDisposable = vscode.chat.registerChatSessionItemProvider(REPLAY_FORK_SCHEME, this);
		this._register(contentDisposable);
		this._register(forkContentDisposable);
		this._register(itemDisposable);
		this._register(forkItemDisposable);
		this._register(vscode.commands.registerCommand(START_REPLAY_COMMAND, async (resource?: vscode.Uri | string) => {
			const uri = typeof resource === 'string' ? vscode.Uri.parse(resource) : resource;
			if (!uri) {
				this._logService.trace('LiveReplayChatProvider: startReplayChat invoked without resource');
				return;
			}
			await this._activateReplay(uri);
		}));
		this._register(vscode.commands.registerCommand(TOGGLE_VIEW_COMMAND, async (resource?: vscode.Uri | string) => {
			const uri = typeof resource === 'string' ? vscode.Uri.parse(resource) : resource;
			if (!uri) {
				return;
			}
			this._toggleView(uri);
		}));
		this._logService.trace('LiveReplayChatProvider: registered content and item providers');
	}

	showReplay(snapshot: LiveRequestReplaySnapshot): void {
		const composite = this._compositeKey(snapshot.key.sessionId, snapshot.key.location, snapshot.key.requestId);
		this._logService.info(`[LiveReplay] showReplay begin ${composite} state=${snapshot.state} v${snapshot.version} sections=${snapshot.projection?.sections.length ?? 0} overflow=${snapshot.projection?.overflowCount ?? 0}`);
		const existing = this._sessionsByKey.get(composite);
		const resource = buildReplayResource(snapshot);
		const state: ReplaySessionState = {
			resource,
			snapshot,
			activated: existing?.activated ?? false,
			view: existing?.view ?? 'payload'
		};
		this._sessionsByKey.set(composite, state);
		this._rememberState(state);
		this._onDidChangeChatSessionItems.fire();
		this._logService.info(`[LiveReplay] showReplay stored state and opening view ${resource.toString()} (key=${resource.toString(true)})`);
		void vscode.commands.executeCommand('vscode.open', resource);
		void vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
	}

	showSampleReplay(): void {
		this.showReplay(this._buildSampleSnapshot());
	}

	async provideChatSessionContent(resource: vscode.Uri, _token: vscode.CancellationToken): Promise<vscode.ChatSession> {
		this._logService.info(`[LiveReplay] provideChatSessionContent resource=${resource.toString()} path=${resource.path}`);
		let state = this._getState(resource);
		if (!state) {
			state = this._hydrateFromService(resource);
		}
		if (!state) {
			const composite = this._decodeComposite(resource);
			this._logService.warn(`[LiveReplay] provideChatSessionContent missing state for ${resource.toString()} (composite=${composite}) keys=${Array.from(this._sessionsByResource.keys()).join(',')}`);
			if (composite.startsWith('sample-session')) {
				this._logService.trace('[LiveReplay] provideChatSessionContent rebuilding sample snapshot');
				state = {
					resource,
					snapshot: this._buildSampleSnapshot(),
					activated: false,
					view: 'payload'
				};
				this._sessionsByKey.set(composite, state);
				this._rememberState(state);
			}
		}
		if (!state) {
			return {
				history: [new vscode.ChatResponseTurn2([new vscode.ChatResponseMarkdownPart('Replay expired or not found. Rebuild from the Live Request Editor.')], {}, REPLAY_PARTICIPANT_ID)],
				requestHandler: undefined
			};
		}

		const snapshot = state.snapshot;
		const projection = snapshot.projection;
		const ready = snapshot.state === 'ready' || snapshot.state === 'forkActive';
		const handlerEnabled = ready && state.activated;
		this._logService.info(`[LiveReplay] provideChatSessionContent state=${snapshot.state} v${snapshot.version} ready=${ready} activated=${state.activated} handler=${handlerEnabled} sections=${snapshot.projection?.sections.length ?? 0}`);
		const history = projection ? this._buildDisplayHistory(state) : [
			new vscode.ChatRequestTurn2('Replay summary', undefined, [], REPLAY_PARTICIPANT_ID, [], undefined, undefined),
			new vscode.ChatResponseTurn2([new vscode.ChatResponseMarkdownPart('Nothing to replay.')], {}, REPLAY_PARTICIPANT_ID)
		];

		return {
			history,
			requestHandler: handlerEnabled
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
				this._logService.trace('[LiveReplay] markReplayForkActive');
				state.snapshot = updated;
				this._sessionsByKey.set(composite, state);
				this._sessionsByResource.set(state.resource.toString(), state);
			}
		} catch (error) {
			this._logService.error('LiveReplayChatProvider: failed to mark replay as fork active', error);
		}

		const history = this._buildPayloadHistory(state.snapshot);
		this._logService.trace(`[LiveReplay] handleRequest start ${composite} promptLen=${request.prompt?.length ?? 0} payloadMessages=${state.snapshot.payload?.length ?? 0}`);
		const handler = this._instantiationService.createInstance(
			ChatParticipantRequestHandler,
			history,
			request,
			stream,
			token,
			{ agentName: defaultAgentName, agentId: getChatParticipantIdFromName(defaultAgentName) },
			Event.None
		);
		const result = await handler.getResult();
		this._logService.trace(`[LiveReplay] handleRequest finished ${composite}`);
		return result;
	}

	private async _activateReplay(resource: vscode.Uri): Promise<void> {
		const state = this._getState(resource);
		if (!state) {
			return;
		}
		const forkResource = resource.with({ scheme: REPLAY_FORK_SCHEME });
		const composite = this._compositeKey(state.snapshot.key.sessionId, state.snapshot.key.location, state.snapshot.key.requestId);
		let forkState = this._sessionsByResource.get(forkResource.toString());
		if (!forkState) {
			forkState = {
				resource: forkResource,
				snapshot: state.snapshot,
				activated: true,
				view: 'payload'
			};
		} else {
			forkState.activated = true;
			forkState.view = 'payload';
			forkState.snapshot = state.snapshot;
		}
		const updated = this._liveRequestEditorService.markReplayForkActive(state.snapshot.key, forkResource.toString());
		if (updated) {
			forkState.snapshot = updated;
		}
		this._sessionsByResource.set(forkResource.toString(), forkState);
		this._sessionsByKey.set(composite, forkState);
		try {
			await vscode.commands.executeCommand('vscode.open', forkResource);
			await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
		} catch (error) {
			this._logService.error('[LiveReplay] failed to activate replay session', error);
		}
		this._onDidChangeChatSessionItems.fire();
	}

	private _toggleView(resource: vscode.Uri): void {
		const state = this._getState(resource);
		if (!state) {
			return;
		}
		state.view = state.view === 'payload' ? 'projection' : 'payload';
		this._sessionsByResource.set(resource.toString(), state);
		const key = this._compositeKey(state.snapshot.key.sessionId, state.snapshot.key.location, state.snapshot.key.requestId);
		this._sessionsByKey.set(key, state);
		this._logService.info(`[LiveReplay] toggled view to ${state.view} for ${resource.toString()}`);
		void vscode.commands.executeCommand('vscode.open', resource);
		this._onDidChangeChatSessionItems.fire();
	}

	private _buildDisplayHistory(state: ReplaySessionState): Array<vscode.ChatRequestTurn | vscode.ChatResponseTurn2> {
		const snapshot = state.snapshot;
		const projection = snapshot.projection;
		if (!projection) {
			return [
				new vscode.ChatRequestTurn2('Replay summary', undefined, [], REPLAY_PARTICIPANT_ID, [], undefined, undefined),
				new vscode.ChatResponseTurn2([new vscode.ChatResponseMarkdownPart('Nothing to replay.')], {}, REPLAY_PARTICIPANT_ID)
			];
		}

		const viewModel = buildReplayChatViewModel(snapshot, section => this._formatSection(section));
		const history: Array<vscode.ChatRequestTurn | vscode.ChatResponseTurn2> = [];

		if (!state.activated) {
			const summaryLines = viewModel.summaryLines;
			const summaryParts: Array<vscode.ChatResponseMarkdownPart | vscode.ChatResponseCommandButtonPart> = [
				new vscode.ChatResponseMarkdownPart(summaryLines.join('\n'))
			];
			if (snapshot.state === 'stale') {
				summaryParts.push(new vscode.ChatResponseMarkdownPart('⚠️ Replay is stale. Rebuild from the Live Request Editor to continue.'));
			} else {
				const startLabel = 'Start chatting from this replay';
				summaryParts.push(new vscode.ChatResponseMarkdownPart(' '));
				summaryParts.push(new vscode.ChatResponseMarkdownPart('Actions:'));
				summaryParts.push(new vscode.ChatResponseCommandButtonPart({ title: startLabel, command: START_REPLAY_COMMAND, arguments: [state.resource] }));
			}
			summaryParts.push(new vscode.ChatResponseCommandButtonPart({ title: 'Open Live Request Editor', command: OPEN_LRE_COMMAND }));
			history.push(
				new vscode.ChatRequestTurn2('Replay summary', undefined, [], REPLAY_PARTICIPANT_ID, [], undefined, undefined),
				new vscode.ChatResponseTurn2(summaryParts, {}, REPLAY_PARTICIPANT_ID),
			);
		}

		const view = state.view ?? 'payload';
		if (view === 'payload') {
			history.push(...this._buildPayloadHistory(snapshot, getChatParticipantIdFromName(defaultAgentName)));
		} else {
			// Projection view: render sections under replay participant.
			for (const section of projection.sections) {
				const sectionMarkdown = this._formatSection(section);
				history.push(
					new vscode.ChatRequestTurn2(section.label || section.kind, undefined, [], REPLAY_PARTICIPANT_ID, [], undefined, undefined),
					new vscode.ChatResponseTurn2([new vscode.ChatResponseMarkdownPart(sectionMarkdown)], {}, REPLAY_PARTICIPANT_ID)
				);
			}
			if (viewModel.overflowMessage) {
				history.push(new vscode.ChatResponseTurn2([new vscode.ChatResponseMarkdownPart(viewModel.overflowMessage)], {}, REPLAY_PARTICIPANT_ID));
			}
			if (viewModel.trimmedMessage) {
				history.push(new vscode.ChatResponseTurn2([new vscode.ChatResponseMarkdownPart(viewModel.trimmedMessage)], {}, REPLAY_PARTICIPANT_ID));
			}
		}

		return history;
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

	private _buildPayloadHistory(snapshot: LiveRequestReplaySnapshot, participantOverride?: string): (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[] {
		const history: (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[] = [];
		for (const message of snapshot.payload ?? []) {
			const text = this._renderMessageText(message).trim();
			const participant = participantOverride ?? REPLAY_PARTICIPANT_ID;
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
		const keyA = resource.toString();
		const keyB = resource.toString(true);
		const byResource = this._sessionsByResource.get(keyA) ?? this._sessionsByResource.get(keyB) ?? this._sessionsByResource.get(resource.path) ?? this._sessionsByResource.get(decodeURIComponent(resource.path ?? ''));
		if (byResource) {
			this._logService.info(`[LiveReplay] _getState hit for ${resource.toString()} via direct key`);
			return byResource;
		}
		const composite = this._decodeComposite(resource);
		if (!composite) {
			return undefined;
		}
		const fromKey = this._sessionsByKey.get(composite);
		if (fromKey) {
			this._logService.info(`[LiveReplay] _getState recovered from composite ${composite}`);
			this._sessionsByResource.set(resource.toString(), fromKey);
			this._sessionsByResource.set(resource.toString(true), fromKey);
		}
		return fromKey;
	}

	private _hydrateFromService(resource: vscode.Uri): ReplaySessionState | undefined {
		const composite = this._decodeComposite(resource);
		const [sessionId, locationStr, requestId] = composite.split('::');
		if (!sessionId || !locationStr || !requestId) {
			this._logService.warn(`[LiveReplay] hydrate failed: invalid composite ${composite}`);
			return undefined;
		}
		const location = Number(locationStr);
		if (Number.isNaN(location)) {
			this._logService.warn(`[LiveReplay] hydrate failed: location NaN in ${composite}`);
			return undefined;
		}
		const snapshot = this._liveRequestEditorService.getReplaySnapshot({ sessionId, location, requestId });
		if (!snapshot) {
			this._logService.warn(`[LiveReplay] hydrate failed: no snapshot for ${composite}`);
			return undefined;
		}
		this._logService.info(`[LiveReplay] hydrated state from service ${composite}`);
		const state: ReplaySessionState = {
			resource,
			snapshot,
			activated: snapshot.state === 'forkActive',
			view: 'payload'
		};
		this._sessionsByKey.set(this._compositeKey(sessionId, location, requestId), state);
		this._rememberState(state);
		return state;
	}

	private _buildSampleSnapshot(): LiveRequestReplaySnapshot {
		const now = Date.now();
		const payload: Raw.ChatMessage[] = [
			{ role: Raw.ChatRole.System, content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'System prep' }] },
			{ role: Raw.ChatRole.User, content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Edited user message' }] }
		];
		return {
			key: { sessionId: 'sample-session', location: ChatLocation.Panel, requestId: 'sample-turn' },
			state: 'ready',
			version: 1,
			updatedAt: now,
			payload,
			payloadHash: 1,
			projection: {
				sections: [
					{ id: 'sys', kind: 'system', label: 'System', content: 'System prep', collapsed: true, edited: false, sourceMessageIndex: 0 },
					{ id: 'usr', kind: 'user', label: 'User', content: 'Edited user message', collapsed: false, edited: true, sourceMessageIndex: 1 }
				],
				totalSections: 2,
				overflowCount: 0,
				editedCount: 1,
				deletedCount: 0
			},
			projectionHash: 1,
			parentSessionId: 'sample-session',
			parentTurnId: 'sample-turn'
		};
	}

	private _decodeComposite(resource: vscode.Uri): string {
		const compositeEncoded = resource.path?.replace(/^\//, '') ?? '';
		try {
			// VS Code encodes once; older calls encoded before passing to URI, so decode twice.
			return decodeURIComponent(decodeURIComponent(compositeEncoded));
		} catch {
			return compositeEncoded;
		}
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
		return `Replay fork · ${name} · turn ${turnTail}`;
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

export function buildReplayResource(snapshot: LiveRequestReplaySnapshot): vscode.Uri {
	const path = `/${snapshot.key.sessionId}::${snapshot.key.location}::${snapshot.key.requestId}`;
	return vscode.Uri.from({
		scheme: REPLAY_SCHEME,
		path,
		query: String(snapshot.version ?? 0)
	});
}
