/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ILogService } from '../../../platform/log/common/logService';
import { deepClone } from '../../../util/vs/base/common/objects';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { ILiveRequestEditorService, LiveRequestMetadataEvent, LiveRequestMetadataSnapshot } from '../common/liveRequestEditorService';
import { EditableChatRequest, EditableChatRequestMetadata, LiveRequestSessionKey } from '../common/liveRequestEditorModel';

type SessionMetadataField = 'sessionId' | 'requestId' | 'model' | 'location' | 'interception' | 'dirty';
type OutlineSection = 'requestOptions' | 'rawRequest';

const DEFAULT_FIELDS: SessionMetadataField[] = ['sessionId', 'requestId'];
const ALLOWED_FIELDS: SessionMetadataField[] = ['sessionId', 'requestId', 'model', 'location', 'interception', 'dirty'];
const FIELD_LABELS: Record<SessionMetadataField, string> = {
	sessionId: 'Session',
	requestId: 'Request',
	model: 'Model',
	location: 'Location',
	interception: 'Interception',
	dirty: 'Dirty',
};
const FIELD_DESCRIPTIONS: Record<SessionMetadataField, string> = {
	sessionId: 'Live conversation identifier',
	requestId: 'Pending request identifier',
	model: 'Model handling the pending request',
	location: 'Chat surface (panel, editor, terminal)',
	interception: 'Prompt interception status',
	dirty: 'Whether pending edits differ from the original request'
};

const OUTLINE_SECTION_LABELS: Record<OutlineSection, string> = {
	requestOptions: 'Request Options',
	rawRequest: 'Raw Request Payload'
};

const OUTLINE_ICONS: Record<string, vscode.ThemeIcon> = {
	object: new vscode.ThemeIcon('symbol-class'),
	array: new vscode.ThemeIcon('list-unordered'),
	string: new vscode.ThemeIcon('symbol-string'),
	number: new vscode.ThemeIcon('symbol-number'),
	boolean: new vscode.ThemeIcon('symbol-boolean'),
	null: new vscode.ThemeIcon('symbol-parameter'),
	unknown: new vscode.ThemeIcon('question')
};

const MAX_OUTLINE_ENTRIES = 512;

interface OutlineNodeData {
	id: string;
	label: string;
	description?: string;
	valuePreview?: string;
	copyValue?: string;
	icon?: vscode.ThemeIcon;
	children?: OutlineNodeData[];
}

export class LiveRequestMetadataProvider extends Disposable implements vscode.TreeDataProvider<LiveRequestTreeItem> {
	public static readonly viewId = 'github.copilot.liveRequestMetadata';

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<LiveRequestTreeItem | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private _metadata?: LiveRequestMetadataSnapshot;
	private readonly _requests = new Map<string, EditableChatRequest>();
	private _fields: SessionMetadataField[];
	private _outlineSections: Set<OutlineSection>;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService,
	) {
		super();
		this._fields = this._readFieldsConfig();
		this._outlineSections = this._readOutlineSections();
		this._register(this._liveRequestEditorService.onDidChange(request => this._handleRequestChanged(request)));
		this._register(this._liveRequestEditorService.onDidRemoveRequest(key => this._handleRequestRemoved(key)));
		this._register(this._liveRequestEditorService.onDidChangeMetadata(event => this._handleMetadata(event)));
		this._register(vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('github.copilot.chat.promptInspector.sessionMetadata.fields')) {
				this._fields = this._readFieldsConfig();
				this.refresh();
			}
			if (event.affectsConfiguration('github.copilot.chat.promptInspector.extraSections')) {
				this._outlineSections = this._readOutlineSections();
				this.refresh();
			}
		}));

		const requests = this._liveRequestEditorService.getAllRequests();
		if (requests.length) {
			for (const request of requests) {
				this._requests.set(this._toKey(request.sessionId, request.location), request);
			}
			const latest = requests
				.slice()
				.sort((a, b) => (b.metadata.lastUpdated ?? b.metadata.createdAt) - (a.metadata.lastUpdated ?? a.metadata.createdAt))[0];
			this._metadata = latest
				? this._liveRequestEditorService.getMetadataSnapshot({ sessionId: latest.sessionId, location: latest.location })
				: undefined;
		}
	}

	getTreeItem(element: LiveRequestTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: LiveRequestTreeItem): LiveRequestTreeItem[] {
		if (!this._metadata) {
			return [new PlaceholderTreeItem('Live Request Editor idle — send a chat request to populate metadata.')];
		}

		if (!element) {
			return this._buildRootItems();
		}

		if (element instanceof MetadataRootTreeItem) {
			return element.children;
		}

		if (element instanceof OutlineRootTreeItem) {
			return element.children.length ? element.children : [new PlaceholderTreeItem('No data available for this section.')];
		}

		if (element instanceof OutlineEntryTreeItem) {
			return element.children;
		}

		return [];
	}

	public async configureFields(): Promise<void> {
		const picks = await vscode.window.showQuickPick(
			ALLOWED_FIELDS.map(field => ({
				label: FIELD_LABELS[field],
				description: FIELD_DESCRIPTIONS[field],
				picked: this._fields.includes(field),
				field
			})),
			{
				title: 'Select Live Request metadata fields',
				placeHolder: 'Choose which metadata chips appear in the Live Request Metadata view',
				canPickMany: true
			}
		);
		if (!picks) {
			return;
		}
		const selected = picks
			.map(pick => (pick as { field?: SessionMetadataField }).field)
			.filter((field): field is SessionMetadataField => Boolean(field));

		const config = vscode.workspace.getConfiguration('github.copilot.chat.promptInspector');
		try {
			await config.update('sessionMetadata.fields', selected, vscode.ConfigurationTarget.Global);
			this._fields = this._normalizeFields(selected);
			this.refresh();
		} catch (error) {
			this._logService.error('LiveRequestMetadataProvider: failed to update metadata fields', error);
			vscode.window.showErrorMessage('Failed to update Live Request metadata fields. See logs for details.');
		}
	}

	public async copyValue(value: string | undefined, label: string): Promise<void> {
		if (!value) {
			return;
		}
		try {
			await vscode.env.clipboard.writeText(value);
			vscode.window.setStatusBarMessage(`${label} copied to clipboard`, 1500);
		} catch (error) {
			this._logService.error('LiveRequestMetadataProvider: failed to copy value', error);
		}
	}

	public refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	private _buildRootItems(): LiveRequestTreeItem[] {
		const items: LiveRequestTreeItem[] = [];
		const request = this._getActiveRequest();

		const metadataChildren = this._fields
			.map(field => this._createMetadataField(field))
			.filter((node): node is MetadataFieldTreeItem => Boolean(node));
		if (metadataChildren.length) {
			items.push(new MetadataRootTreeItem(metadataChildren));
		}

		if (this._metadata) {
			items.push(this._createTokenBudgetItem(this._metadata));
		}

		if (request) {
			const outlineRoots = this._createOutlineRoots(request);
			items.push(...outlineRoots);
		}

		if (!items.length) {
			items.push(new PlaceholderTreeItem('No metadata available for the current request.'));
		}

		return items;
	}

	private _createMetadataField(field: SessionMetadataField): MetadataFieldTreeItem | undefined {
		if (!this._metadata) {
			return undefined;
		}
		const label = FIELD_LABELS[field];
		let value = '';
		if (field === 'sessionId') {
			value = this._metadata.sessionId ?? '';
		} else if (field === 'requestId') {
			value = this._metadata.requestId ?? '';
		} else if (field === 'model') {
			value = this._metadata.model ?? '';
		} else if (field === 'location') {
			value = typeof this._metadata.location === 'number'
				? ChatLocation.toString(this._metadata.location)
				: (this._metadata.location ?? '');
		} else if (field === 'interception') {
			value = this._metadata.interceptionState === 'pending' ? 'Pending' : 'Idle';
		} else if (field === 'dirty') {
			value = this._metadata.isDirty ? 'Dirty' : 'Clean';
		}

		const display = value || '—';
		return new MetadataFieldTreeItem(label, display, value);
	}

	private _createTokenBudgetItem(metadata: LiveRequestMetadataSnapshot): TokenBudgetTreeItem {
		const max = metadata.maxPromptTokens ?? 0;
		const used = metadata.tokenCount ?? 0;
		return new TokenBudgetTreeItem(used, max);
	}

	private _createOutlineRoots(request: EditableChatRequest): OutlineRootTreeItem[] {
		const roots: OutlineRootTreeItem[] = [];
		if (this._outlineSections.has('requestOptions')) {
			const data = request.metadata?.requestOptions ? deepClone(request.metadata.requestOptions) : undefined;
			const childNodes = data !== undefined ? this._buildOutlineNodes(data, ['requestOptions']) : [];
			roots.push(new OutlineRootTreeItem(
				'requestOptions',
				OUTLINE_SECTION_LABELS.requestOptions,
				childNodes.map(node => OutlineEntryTreeItem.fromNode(node))
			));
		}

		if (this._outlineSections.has('rawRequest')) {
			const payload = {
				model: request.model,
				location: ChatLocation.toString(request.location),
				messages: deepClone(request.messages ?? []),
				requestOptions: request.metadata?.requestOptions ? deepClone(request.metadata.requestOptions) : undefined,
				metadata: this._buildRawMetadata(request.metadata)
			};
			const childNodes = this._buildOutlineNodes(payload, ['rawRequest']);
			roots.push(new OutlineRootTreeItem(
				'rawRequest',
				OUTLINE_SECTION_LABELS.rawRequest,
				childNodes.map(node => OutlineEntryTreeItem.fromNode(node))
			));
		}
		return roots;
	}

	private _buildRawMetadata(metadata: EditableChatRequestMetadata | undefined): Record<string, unknown> | undefined {
		if (!metadata) {
			return undefined;
		}
		const trimmed: Record<string, unknown> = {};
		if (metadata.requestId) {
			trimmed.requestId = metadata.requestId;
		}
		if (metadata.intentId) {
			trimmed.intentId = metadata.intentId;
		}
		if (metadata.endpointUrl) {
			trimmed.endpointUrl = metadata.endpointUrl;
		}
		return Object.keys(trimmed).length ? trimmed : undefined;
	}

	private _buildOutlineNodes(value: unknown, path: string[], budgetState?: { remaining: number; truncated: boolean }): OutlineNodeData[] {
		const budget = budgetState ?? { remaining: MAX_OUTLINE_ENTRIES, truncated: false };
		if (budget.remaining <= 0) {
			budget.truncated = true;
			return [this._createTruncatedNode(path)];
		}

		if (Array.isArray(value)) {
			const entries: OutlineNodeData[] = [];
			for (let index = 0; index < value.length; index++) {
				if (budget.remaining <= 0) {
					budget.truncated = true;
					entries.push(this._createTruncatedNode(path));
					break;
				}
				entries.push(this._createOutlineNode(`[${index}]`, value[index], [...path, String(index)], budget));
			}
			if (!entries.length) {
				entries.push(this._createPlaceholderNode('Empty array', path));
			}
			return entries;
		}

		if (value && typeof value === 'object') {
			const entries: OutlineNodeData[] = [];
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (budget.remaining <= 0) {
					budget.truncated = true;
					entries.push(this._createTruncatedNode(path));
					break;
				}
				const entryValue = (value as Record<string, unknown>)[key];
				entries.push(this._createOutlineNode(key, entryValue, [...path, key], budget));
			}
			if (!entries.length) {
				entries.push(this._createPlaceholderNode('Empty object', path));
			}
			return entries;
		}

		return [];
	}

	private _createOutlineNode(label: string, value: unknown, path: string[], budget: { remaining: number; truncated: boolean }): OutlineNodeData {
		budget.remaining--;
		const node: OutlineNodeData = {
			id: path.join('.'),
			label,
			description: this._describeValue(value),
			valuePreview: this._formatPreview(value),
			icon: this._iconForValue(value),
		};

		if (value && typeof value === 'object') {
			const children = this._buildOutlineNodes(value, path, budget);
			node.children = children;
			node.copyValue = this._stringifyValue(value);
		} else if (value === null || typeof value !== 'object') {
			node.copyValue = this._stringifyValue(value);
		}

		return node;
	}

	private _createPlaceholderNode(label: string, path: string[]): OutlineNodeData {
		return {
			id: `${path.join('.')}::${label}`,
			label,
			description: undefined,
			icon: OUTLINE_ICONS.unknown
		};
	}

	private _createTruncatedNode(path: string[]): OutlineNodeData {
		return {
			id: `${path.join('.')}::truncated`,
			label: '… entries truncated …',
			description: 'Outline truncated for brevity',
			icon: new vscode.ThemeIcon('warning')
		};
	}

	private _describeValue(value: unknown): string {
		if (Array.isArray(value)) {
			return `Array(${value.length})`;
		}
		const type = value === null ? 'null' : typeof value;
		return type.charAt(0).toUpperCase() + type.slice(1);
	}

	private _formatPreview(value: unknown): string | undefined {
		if (value === null) {
			return 'null';
		}
		if (typeof value === 'string') {
			return value.length > 60 ? `${value.slice(0, 57)}…` : value;
		}
		if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
		return undefined;
	}

	private _iconForValue(value: unknown): vscode.ThemeIcon {
		if (Array.isArray(value)) {
			return OUTLINE_ICONS.array;
		}
		if (value === null) {
			return OUTLINE_ICONS.null;
		}
		if (typeof value === 'object') {
			return OUTLINE_ICONS.object;
		}
		if (typeof value === 'string') {
			return OUTLINE_ICONS.string;
		}
		if (typeof value === 'number') {
			return OUTLINE_ICONS.number;
		}
		if (typeof value === 'boolean') {
			return OUTLINE_ICONS.boolean;
		}
		return OUTLINE_ICONS.unknown;
	}

	private _stringifyValue(value: unknown): string | undefined {
		try {
			return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
		} catch {
			return undefined;
		}
	}

	private _handleRequestChanged(request: EditableChatRequest): void {
		this._requests.set(this._toKey(request.sessionId, request.location), request);
		this.refresh();
	}

	private _handleRequestRemoved(key: LiveRequestSessionKey): void {
		this._requests.delete(this._toKey(key.sessionId, key.location));
		if (this._metadata && this._metadata.sessionId === key.sessionId && this._metadata.location === key.location) {
			this._metadata = undefined;
		}
		this.refresh();
	}

	private _handleMetadata(event: LiveRequestMetadataEvent): void {
		if (event.metadata) {
			this._metadata = event.metadata;
		} else if (this._metadata && this._metadata.sessionId === event.key.sessionId && this._metadata.location === event.key.location) {
			this._metadata = undefined;
		}
		this.refresh();
	}

	private _getActiveRequest(): EditableChatRequest | undefined {
		if (!this._metadata) {
			return undefined;
		}
		return this._requests.get(this._toKey(this._metadata.sessionId, this._metadata.location as ChatLocation));
	}

	private _toKey(sessionId: string, location: ChatLocation): string {
		return `${sessionId}::${location}`;
	}

	private _readFieldsConfig(): SessionMetadataField[] {
		const config = vscode.workspace.getConfiguration('github.copilot.chat.promptInspector');
		const raw = config.get<string[]>('sessionMetadata.fields');
		return this._normalizeFields(raw);
	}

	private _normalizeFields(raw: string[] | undefined): SessionMetadataField[] {
		if (!Array.isArray(raw)) {
			return [...DEFAULT_FIELDS];
		}
		const sanitized: SessionMetadataField[] = [];
		for (const value of raw) {
			if (ALLOWED_FIELDS.includes(value as SessionMetadataField)) {
				const typed = value as SessionMetadataField;
				if (!sanitized.includes(typed)) {
					sanitized.push(typed);
				}
			}
		}
		return sanitized;
	}

	private _readOutlineSections(): Set<OutlineSection> {
		const config = vscode.workspace.getConfiguration('github.copilot.chat.promptInspector');
		const raw = config.get<string[]>('extraSections', []);
		const allowed: OutlineSection[] = ['requestOptions', 'rawRequest'];
		const set = new Set<OutlineSection>();
		for (const entry of raw) {
			if (allowed.includes(entry as OutlineSection)) {
				set.add(entry as OutlineSection);
			}
		}
		return set;
	}
}

abstract class LiveRequestTreeItem extends vscode.TreeItem {
	protected constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
		super(label, collapsibleState);
	}
}

class PlaceholderTreeItem extends LiveRequestTreeItem {
	constructor(message: string) {
		super(message, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'copilotLiveRequestMetadataPlaceholder';
	}
}

class MetadataRootTreeItem extends LiveRequestTreeItem {
	constructor(public readonly children: MetadataFieldTreeItem[]) {
		super('Metadata', children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon('info');
		this.contextValue = 'copilotLiveRequestMetadataSection';
	}
}


class MetadataFieldTreeItem extends LiveRequestTreeItem {
	constructor(label: string, displayValue: string, rawValue: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = displayValue;
		this.tooltip = rawValue || '—';
		this.contextValue = 'copilotLiveRequestMetadataField';
		this.command = {
			command: 'github.copilot.liveRequestMetadata.copyValue',
			title: 'Copy metadata value',
			arguments: [rawValue || '', label]
		};
		this.iconPath = new vscode.ThemeIcon('symbol-field');
	}
}


class TokenBudgetTreeItem extends LiveRequestTreeItem {
	constructor(used: number, max: number) {
		super('Token Budget', vscode.TreeItemCollapsibleState.None);
		const percent = max > 0 ? Math.min(Math.max(Math.round((used / max) * 100), 0), 999) : undefined;
		this.description = max > 0 ? `${percent}% · ${used.toLocaleString()}/${max.toLocaleString()} tokens` : `${used.toLocaleString()} tokens (awaiting budget)`;
		this.tooltip = this.description;
		this.iconPath = new vscode.ThemeIcon('meter');
		this.contextValue = 'copilotLiveRequestMetadataToken';
	}
}

class OutlineRootTreeItem extends LiveRequestTreeItem {
	constructor(public readonly section: OutlineSection, label: string, public readonly children: OutlineEntryTreeItem[]) {
		super(label, vscode.TreeItemCollapsibleState.Collapsed);
		this.iconPath = new vscode.ThemeIcon('symbol-namespace');
		this.contextValue = 'copilotLiveRequestMetadataOutline';
	}
}

class OutlineEntryTreeItem extends LiveRequestTreeItem {
	public readonly children: LiveRequestTreeItem[];

	private constructor(label: string, collapsible: vscode.TreeItemCollapsibleState, node: OutlineNodeData) {
		super(label, collapsible);
		this.description = node.valuePreview ?? node.description;
		this.tooltip = node.valuePreview ?? node.description;
		this.iconPath = node.icon ?? OUTLINE_ICONS.object;
		this.children = node.children?.map(child => new OutlineEntryTreeItem(
			child.label,
			child.children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
			child
		)) ?? [];

		if (!this.children.length && node.copyValue) {
			this.command = {
				command: 'github.copilot.liveRequestMetadata.copyValue',
				title: 'Copy value',
				arguments: [node.copyValue, node.label]
			};
		}
		this.contextValue = 'copilotLiveRequestMetadataOutlineEntry';
	}

	public static fromNode(node: OutlineNodeData): OutlineEntryTreeItem {
		const collapsible = node.children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
		return new OutlineEntryTreeItem(node.label, collapsible, node);
	}

	public static truncated(): OutlineEntryTreeItem {
		const item = new OutlineEntryTreeItem('… entries truncated …', vscode.TreeItemCollapsibleState.None, {
			id: 'truncated',
			label: 'Truncated',
			description: 'Outline truncated for brevity'
		});
		item.iconPath = new vscode.ThemeIcon('warning');
		return item;
	}
}
