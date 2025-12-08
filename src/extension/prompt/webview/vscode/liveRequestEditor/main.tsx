/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeDropdown, vsCodeOption } from '@vscode/webview-ui-toolkit';

interface VSCodeAPI<TState = unknown> {
	postMessage(message: unknown): void;
	getState?(): TState | undefined;
	setState?(newState: TState): void;
}

declare function acquireVsCodeApi<TState = unknown>(): VSCodeAPI<TState>;

declare global {
	namespace JSX {
		interface IntrinsicElements {
			'vscode-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
				appearance?: 'primary' | 'secondary';
			};
			'vscode-dropdown': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
				value?: string;
				disabled?: boolean;
			};
			'vscode-option': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
				value?: string;
			};
		}
	}
}

type LiveRequestValidationErrorCode = 'empty' | string;

type SectionActionIconType = 'edit' | 'close' | 'delete' | 'pin' | 'pinFilled' | 'restore';

type LiveRequestEditorMode = 'off' | 'interceptOnce' | 'interceptAlways' | 'autoOverride';

type InspectorExtraSection = 'requestOptions' | 'telemetry' | 'rawRequest';

interface EditableChatRequestMetadata {
	requestId?: string;
	tokenCount?: number;
	maxPromptTokens?: number;
	maxResponseTokens?: number;
	createdAt?: number;
	lastValidationErrorCode?: LiveRequestValidationErrorCode;
	intentId?: string;
	endpointUrl?: string;
	modelFamily?: string;
	requestOptions?: Record<string, unknown>;
	lastLoggedAt?: number;
	lastLoggedHash?: number;
	lastLoggedMatches?: boolean;
	lastLoggedMismatchReason?: string;
}

interface RawChatMessageContentPart {
	type: string;
	text?: string;
	[key: string]: unknown;
}

interface RawChatMessage {
	role?: string;
	content?: RawChatMessageContentPart[];
	[key: string]: unknown;
}

interface EditableChatRequest {
	id: string;
	sessionId: string;
	location: number;
	debugName?: string;
	model: string;
	isDirty: boolean;
	messages?: RawChatMessage[];
	sections: LiveRequestSection[];
	metadata?: EditableChatRequestMetadata;
}

interface ToolInvocationMetadata {
	id?: string;
	name?: string;
	arguments?: string;
}

interface LiveRequestSectionMetadata {
	name?: string;
	toolCallId?: string;
	toolInvocation?: ToolInvocationMetadata;
}

interface LiveRequestSection {
	id: string;
	label: string;
	kind: string;
	content?: string;
	tokenCount?: number;
	collapsed?: boolean;
	editable?: boolean;
	deletable?: boolean;
	deleted?: boolean;
	metadata?: LiveRequestSectionMetadata;
	overrideState?: {
		scope: string;
		slotIndex: number;
		updatedAt: number;
	};
}

interface StateUpdateMessage {
	type: 'stateUpdate';
	request?: EditableChatRequest;
	interception?: InterceptionState;
	sessions?: SessionSummary[];
	activeSessionKey?: string;
	extraSections?: InspectorExtraSection[];
}

interface SessionSummary {
	key: string;
	sessionId: string;
	location: number;
	label: string;
	locationLabel: string;
	sessionTail: string;
	isActive: boolean;
	isLatest: boolean;
	model: string;
	isDirty: boolean;
	lastUpdated?: number;
	debugName: string;
	createdAt?: number;
}

interface PersistedState {
	pinned?: Record<string, string[]>;
	collapsed?: Record<string, string[]>;
}

interface InterceptionState {
	enabled: boolean;
	pending?: {
		debugName: string;
		nonce: number;
	};
	mode?: LiveRequestEditorMode;
	paused?: boolean;
	autoOverride?: {
		enabled: boolean;
		capturing: boolean;
		hasOverrides: boolean;
		scope?: string;
		previewLimit: number;
		lastUpdated?: number;
	};
}

const vscode = acquireVsCodeApi<PersistedState>();

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDropdown(), vsCodeOption());
const markdown = new MarkdownIt({
	linkify: true,
	breaks: true,
	html: false
});

function formatNumber(value?: number): string {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	return Number(value).toLocaleString();
}

const EXTRA_SECTION_VALUES: InspectorExtraSection[] = ['requestOptions', 'telemetry', 'rawRequest'];

const MODE_OPTIONS: Array<{ label: string; mode: LiveRequestEditorMode; description: string }> = [
	{ label: 'Send normally', mode: 'off', description: 'Send requests immediately.' },
	{ label: 'Pause & review every turn', mode: 'interceptAlways', description: 'Pause each request before sending.' },
	{ label: 'Auto-apply saved edits', mode: 'autoOverride', description: 'Capture once, then apply edits automatically.' }
];

function isInspectorExtraSection(value: unknown): value is InspectorExtraSection {
	return typeof value === 'string' && EXTRA_SECTION_VALUES.includes(value as InspectorExtraSection);
}

function formatTimestamp(value?: number): string {
	if (!value) {
		return '—';
	}
	try {
		return new Date(value).toLocaleString();
	} catch {
		return String(value);
	}
}

function formatAutoOverrideStatus(lastUpdated?: number): string {
	if (!lastUpdated) {
		return 'Applying saved edits';
	}
	return `Applying (saved ${formatTimestamp(lastUpdated)})`;
}

function computeTotalTokens(request?: EditableChatRequest): number {
	if (!request) {
		return 0;
	}
	if (request.metadata?.tokenCount) {
		return request.metadata.tokenCount;
	}
	return (request.sections ?? []).reduce((sum, section) => sum + (section.tokenCount ?? 0), 0);
}

function formatPercent(value: number, total: number): string {
	if (!total || !value) {
		return '0%';
	}
	const pct = (value / total) * 100;
	return pct.toFixed(pct >= 10 ? 0 : 1) + '%';
}

function describeLocation(location?: number): string {
	switch (location) {
		case 1:
			return 'Panel';
		case 2:
			return 'Terminal';
		case 3:
			return 'Notebook';
		case 4:
			return 'Editor';
		case 5:
			return 'Editing Session';
		case 6:
			return 'Other';
		case 7:
			return 'Agent';
		case 8:
			return 'Responses Proxy';
		default:
			return 'Unknown';
	}
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	return a.every((value, index) => value === b[index]);
}

function hasOwn<T extends object>(target: T, key: PropertyKey): boolean {
	return Object.prototype.hasOwnProperty.call(target, key);
}

function describeValidationError(code: LiveRequestValidationErrorCode | undefined): string {
	switch (code) {
		case 'empty':
			return 'Prompt cannot be sent because all sections were removed. Reset the prompt to restore the original content.';
		default:
			return 'Prompt cannot be sent due to an invalid edit. Reset the prompt to continue.';
	}
}

function describeOverrideScope(scope?: string): string {
	switch (scope) {
		case 'workspace':
			return 'Workspace scope';
		case 'global':
			return 'Global scope';
		default:
			return 'Session scope';
	}
}

const SECTION_ACTION_ICONS: Record<SectionActionIconType, { paths: string[]; filled?: boolean }> = {
	edit: {
		paths: ['M4 15.5L4 20L8.5 20L18.5 10L14 5.5L4 15.5Z', 'M15 6L18 9'],
	},
	close: {
		paths: ['M6 6L18 18', 'M18 6L6 18']
	},
	delete: {
		paths: ['M7 7H17', 'M9 7L10 5H14L15 7', 'M10 9V17', 'M14 9V17']
	},
	pin: {
		paths: ['M12 4L14 9H18L15 12L16 19L12 16L8 19L9 12L6 9H10L12 4Z']
	},
	pinFilled: {
		paths: ['M12 4L14 9H18L15 12L16 19L12 16L8 19L9 12L6 9H10L12 4Z'],
		filled: true
	},
	restore: {
		paths: ['M6 11V15H2', 'M6 15C7.2 17.7 9.9 19.5 13 19.5C17.1 19.5 20.5 16.1 20.5 12C20.5 7.9 17.1 4.5 13 4.5C10.6 4.5 8.5 5.6 7.1 7.3']
	}
};

const SectionActionIcon: React.FC<{ type: SectionActionIconType }> = ({ type }) => {
	const icon = SECTION_ACTION_ICONS[type];
	return (
		<svg
			className="section-action-icon"
			viewBox="0 0 24 24"
			role="presentation"
			aria-hidden="true"
		>
			{icon.paths.map((path, index) => (
				<path
					key={`${type}-${index}`}
					d={path}
					fill={icon.filled ? 'currentColor' : 'none'}
					stroke="currentColor"
					strokeWidth={1.6}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			))}
		</svg>
	);
};

const EmptyState: React.FC = () => (
	<div className="empty-state">
		<p>
			<strong>Live Request Editor</strong>
		</p>
		<p>Waiting for a chat request...</p>
		<p style={{ fontSize: 12 }}>Start a conversation in the chat panel to inspect and edit the prompt.</p>
	</div>
);

interface SectionCardProps {
	section: LiveRequestSection;
	totalTokens: number;
	isPinned: boolean;
	isEditing: boolean;
	isCollapsed: boolean;
	onToggleCollapse: (sectionId: string) => void;
	onTogglePinned: (sectionId: string) => void;
	onEditToggle: (sectionId: string) => void;
	onCancelEdit: () => void;
	onSaveEdit: (sectionId: string, content: string) => void;
	onDelete: (sectionId: string) => void;
	onRestore: (sectionId: string) => void;
	onShowDiff?: (section: LiveRequestSection) => void;
	draggingRef: React.MutableRefObject<string | null>;
	onReorderPinned: (sourceId: string, targetId: string, placeAfter: boolean) => void;
}

const SectionCard: React.FC<SectionCardProps> = ({
	section,
	totalTokens,
	isPinned,
	isEditing,
	isCollapsed,
	onToggleCollapse,
	onTogglePinned,
	onEditToggle,
	onCancelEdit,
	onSaveEdit,
	onDelete,
	onRestore,
	onShowDiff,
	draggingRef,
	onReorderPinned,
}) => {
	const [draftContent, setDraftContent] = React.useState(section.content ?? '');
	const [dragPosition, setDragPosition] = React.useState<'none' | 'above' | 'below'>('none');
	const collapsed = isCollapsed && !isEditing;
	const deleted = !!section.deleted;
	const sectionTokens = section.tokenCount ?? 0;
	const canDrag = isPinned && !deleted;
	const sectionBodyId = React.useMemo(() => `section-body-${section.id}`, [section.id]);
	const renderedContent = React.useMemo(() => {
		const value = (section.content ?? '').trim();
		if (!value.length) {
			return DOMPurify.sanitize('<p class="section-empty">No content provided.</p>');
		}
		return DOMPurify.sanitize(markdown.render(section.content ?? ''));
	}, [section.content]);
	const toolInvocation = React.useMemo(() => {
		if (section.kind !== 'tool') {
			return undefined;
		}
		if (section.metadata?.toolInvocation) {
			return section.metadata.toolInvocation;
		}
		if (section.metadata?.name || section.metadata?.toolCallId) {
			return {
				id: typeof section.metadata.toolCallId === 'string' ? section.metadata.toolCallId : undefined,
				name: typeof section.metadata.name === 'string' ? section.metadata.name : undefined
			};
		}
		return undefined;
	}, [section]);
	const toolArguments = toolInvocation?.arguments?.trim();

	React.useEffect(() => {
		if (isEditing) {
			setDraftContent(section.content ?? '');
		}
	}, [isEditing, section.content]);

	const className = [
		'section',
		`section-kind-${section.kind}`,
		collapsed ? 'collapsed' : '',
		deleted ? 'deleted' : '',
		isPinned ? 'pinned' : '',
		dragPosition === 'above' ? 'drag-over-above' : '',
		dragPosition === 'below' ? 'drag-over-below' : ''
	].filter(Boolean).join(' ');

	const handleDragStart = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
		if (!canDrag) {
			return;
		}
		const node = event.currentTarget;
		const rect = node.getBoundingClientRect();
		draggingRef.current = section.id;
		event.dataTransfer?.setData('text/plain', section.id);
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setDragImage(node, event.clientX - rect.left, event.clientY - rect.top);
		}
		setDragPosition('none');
	}, [canDrag, section.id, draggingRef]);

	const handleDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
		if (!canDrag || !draggingRef.current || draggingRef.current === section.id) {
			return;
		}
		event.preventDefault();
		const rect = event.currentTarget.getBoundingClientRect();
		const placeAfter = (event.clientY - rect.top) > rect.height / 2;
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
		setDragPosition(placeAfter ? 'below' : 'above');
	}, [canDrag, section.id, draggingRef]);

	const handleDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
		if (!draggingRef.current || draggingRef.current === section.id) {
			setDragPosition('none');
			return;
		}
		event.preventDefault();
		let placeAfter: boolean;
		if (dragPosition === 'none') {
			const rect = event.currentTarget.getBoundingClientRect();
			placeAfter = (event.clientY - rect.top) > rect.height / 2;
		} else {
			placeAfter = dragPosition === 'below';
		}
		onReorderPinned(draggingRef.current, section.id, placeAfter);
		draggingRef.current = null;
		setDragPosition('none');
	}, [section.id, draggingRef, onReorderPinned, dragPosition]);

	const handleDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
		const nextTarget = event.relatedTarget as Node | null;
		if (nextTarget && event.currentTarget.contains(nextTarget)) {
			return;
		}
		setDragPosition('none');
	}, []);

	const handleDragEnd = React.useCallback(() => {
		draggingRef.current = null;
		setDragPosition('none');
	}, [draggingRef]);

	const handleSaveClick = React.useCallback(() => {
		onSaveEdit(section.id, draftContent);
	}, [section.id, draftContent, onSaveEdit]);

	const handleHeaderKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onToggleCollapse(section.id);
		}
	}, [onToggleCollapse, section.id]);

	const handleToolbarAction = React.useCallback((handler: () => void) => (event: React.MouseEvent) => {
		event.stopPropagation();
		handler();
	}, []);

	return (
		<div
			className={className}
			data-section-id={section.id}
			draggable={canDrag}
			onDragStart={handleDragStart}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
			onDragLeave={handleDragLeave}
			onDragEnd={handleDragEnd}
		>
			<div
				className="section-header"
				role="button"
				tabIndex={0}
				aria-expanded={!collapsed}
				aria-controls={sectionBodyId}
				onClick={() => onToggleCollapse(section.id)}
				onKeyDown={handleHeaderKeyDown}
			>
				<div className="section-title">
					<span className="icon" aria-hidden="true">{collapsed ? '\u25B6' : '\u25BC'}</span>
					<span className={`section-kind ${section.kind}`}>{section.kind}</span>
					<span className="section-label">{section.label}</span>
					{sectionTokens > 0 && (
						<span className="section-tokens">
							{formatNumber(sectionTokens)} tokens
							{totalTokens > 0 && (
								<span className="section-percentage">{formatPercent(sectionTokens, totalTokens)}</span>
							)}
						</span>
					)}
					{isPinned && (
						<span className="pinned-indicator" title="Pinned section" aria-label="Pinned section">
							<span className="codicon codicon-pin" aria-hidden="true" />
						</span>
					)}
					{section.overrideState ? (
						<button
							type="button"
							className="override-chip"
							onClick={handleToolbarAction(() => onShowDiff?.(section))}
							title="Show override diff"
						>
							Override · Show diff
						</button>
					) : null}
				</div>
				<div className="section-toolbar" role="toolbar" aria-label={`Actions for ${section.label}`}>
					{deleted ? (
						<button
							type="button"
							className="section-toolbar-button"
							onClick={handleToolbarAction(() => onRestore(section.id))}
							title="Restore section"
							aria-label="Restore section"
						>
							<SectionActionIcon type="restore" />
						</button>
					) : (
						<>
							{section.editable && (
								<button
									type="button"
									className="section-toolbar-button"
									onClick={handleToolbarAction(() => onEditToggle(section.id))}
									title={isEditing ? 'Exit edit mode' : 'Edit section'}
									aria-label={isEditing ? 'Exit edit mode' : 'Edit section'}
									aria-pressed={isEditing}
								>
									<SectionActionIcon type={isEditing ? 'close' : 'edit'} />
								</button>
							)}
							{section.deletable && (
								<button
									type="button"
									className="section-toolbar-button"
									onClick={handleToolbarAction(() => onDelete(section.id))}
									title="Delete section"
									aria-label="Delete section"
								>
									<SectionActionIcon type="delete" />
								</button>
							)}
							<button
								type="button"
								className="section-toolbar-button"
								onClick={handleToolbarAction(() => onTogglePinned(section.id))}
								title={isPinned ? 'Unpin section' : 'Pin section'}
								aria-label={isPinned ? 'Unpin section' : 'Pin section'}
								aria-pressed={isPinned}
							>
								<SectionActionIcon type={isPinned ? 'pinFilled' : 'pin'} />
							</button>
						</>
					)}
				</div>
			</div>
			<div
				className="section-content"
				id={sectionBodyId}
				aria-hidden={collapsed && !isEditing}
			>
				{toolInvocation ? (
					<div className="section-tool-details">
						<div className="tool-name-row">
							<span className="tool-label">Tool</span>
							<span className="tool-name">{toolInvocation.name ?? 'Unknown tool'}</span>
							{toolInvocation.id ? (
								<span className="tool-id">#{toolInvocation.id}</span>
							) : null}
						</div>
						{toolArguments ? (
							<div className="tool-args">
								<div className="tool-label">Arguments</div>
								<pre className="tool-args-block">
									<code>{toolArguments}</code>
								</pre>
							</div>
						) : (
							<div className="tool-args tool-args-empty">No invocation arguments provided.</div>
						)}
					</div>
				) : null}
				{isEditing ? (
					<>
						<textarea
							className="section-editor"
							value={draftContent}
							onChange={event => setDraftContent(event.target.value)}
							data-section={section.id}
						/>
						<div className="editor-actions">
							<vscode-button appearance="secondary" onClick={onCancelEdit}>
								Cancel
							</vscode-button>
							<vscode-button appearance="primary" onClick={handleSaveClick}>
								Save
							</vscode-button>
						</div>
					</>
				) : (
					<div className="section-rendered" dangerouslySetInnerHTML={{ __html: renderedContent }} />
				)}
				{totalTokens > 0 && sectionTokens > 0 && (
					<div className="token-meter">
						<div className="token-meter-fill" style={{ width: formatPercent(sectionTokens, totalTokens) }} />
					</div>
				)}
			</div>
		</div>
	);
};

interface CollapsiblePanelProps {
	id: string;
	title: string;
	description?: string;
	actions?: React.ReactNode;
	isCollapsed: boolean;
	onToggleCollapse: (id: string) => void;
	children: React.ReactNode;
}

const CollapsiblePanel: React.FC<CollapsiblePanelProps> = ({
	id,
	title,
	description,
	actions,
	isCollapsed,
	onToggleCollapse,
	children
}) => {
	const bodyId = React.useMemo(() => `extra-panel-${id}`, [id]);
	const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onToggleCollapse(id);
		}
	}, [id, onToggleCollapse]);

	return (
		<div className={['section', 'section-kind-extra', isCollapsed ? 'collapsed' : ''].filter(Boolean).join(' ')} data-section-id={id}>
			<div
				className="section-header"
				role="button"
				tabIndex={0}
				aria-expanded={!isCollapsed}
				aria-controls={bodyId}
				onClick={() => onToggleCollapse(id)}
				onKeyDown={handleKeyDown}
			>
				<div className="section-title">
					<span className="icon" aria-hidden="true">{isCollapsed ? '\u25B6' : '\u25BC'}</span>
					<span className="section-kind extra">extra</span>
					<span className="section-label">{title}</span>
				</div>
				{actions ? (
					<div className="section-toolbar section-toolbar-static" role="toolbar" aria-label={`${title} actions`}>
						{actions}
					</div>
				) : null}
			</div>
			<div className="section-content" id={bodyId} aria-hidden={isCollapsed}>
				{description ? <p className="inspector-panel-description">{description}</p> : null}
				{children}
			</div>
		</div>
	);
};

interface TelemetryPanelProps {
	panelId: string;
	metadata?: EditableChatRequestMetadata;
	isCollapsed: boolean;
	onToggleCollapse: (panelId: string) => void;
}

const TelemetryPanel: React.FC<TelemetryPanelProps> = ({ panelId, metadata, isCollapsed, onToggleCollapse }) => {
	const rows = React.useMemo(() => ([
		{ label: 'Request ID', value: metadata?.requestId },
		{ label: 'Intent', value: metadata?.intentId },
		{ label: 'Endpoint', value: metadata?.endpointUrl },
		{ label: 'Model Family', value: metadata?.modelFamily },
		{ label: 'Created', value: formatTimestamp(metadata?.createdAt) },
		{ label: 'Last Logged', value: formatTimestamp(metadata?.lastLoggedAt) },
		{
			label: 'Parity',
			value: metadata?.lastLoggedMatches === undefined
				? undefined
				: metadata.lastLoggedMatches
					? 'Matches logged request'
					: `Mismatch (${metadata.lastLoggedMismatchReason ?? 'unspecified'})`
		}
	]), [metadata]);

	const hasData = rows.some(row => row.value && row.value !== '—');

	return (
		<CollapsiblePanel
			id={panelId}
			title="Telemetry"
			description="Metadata recorded for parity checks and endpoint diagnostics."
			isCollapsed={isCollapsed}
			onToggleCollapse={onToggleCollapse}
		>
			{hasData ? (
				<dl className="telemetry-grid">
					{rows.map(row => (
						<React.Fragment key={row.label}>
							<dt>{row.label}</dt>
							<dd>{row.value ?? '—'}</dd>
						</React.Fragment>
					))}
				</dl>
			) : (
				<div className="inspector-panel-empty">No telemetry metadata available.</div>
			)}
		</CollapsiblePanel>
	);
};

const App: React.FC = () => {
	const [request, setRequest] = React.useState<EditableChatRequest | undefined>(undefined);
	const [interception, setInterception] = React.useState<InterceptionState | undefined>(undefined);
	const [extraSections, setExtraSections] = React.useState<InspectorExtraSection[]>([]);
	const [editingSectionId, setEditingSectionId] = React.useState<string | null>(null);
	const [sessions, setSessions] = React.useState<SessionSummary[]>([]);
	const [activeSessionKey, setActiveSessionKey] = React.useState<string | undefined>(undefined);
	const [persistedState, setPersistedState] = React.useState<PersistedState>(() => {
		const stored = (vscode.getState?.() ?? {}) as PersistedState;
		const pinned = (stored as { pinned?: unknown }).pinned;
		const collapsed = (stored as { collapsed?: unknown }).collapsed;
		if (Array.isArray(pinned) || Array.isArray(collapsed)) {
			return {};
		}
		return stored;
	});
	const draggingSectionRef = React.useRef<string | null>(null);
	const [bannerPulse, setBannerPulse] = React.useState(false);
	const mode = interception?.mode ?? 'off';
	const autoOverride = interception?.autoOverride;
	const captureActive = mode === 'autoOverride' && autoOverride?.capturing;
	const displayMode: LiveRequestEditorMode = mode === 'interceptOnce' ? 'interceptAlways' : mode;
	const previewLimit = autoOverride?.previewLimit ?? 3;

	const updatePersistedState = React.useCallback((updater: (prev: PersistedState) => PersistedState) => {
		setPersistedState(prev => {
			const next = updater(prev);
			vscode.setState?.(next);
			return next;
		});
	}, []);

	const pinnedOrderMap = persistedState.pinned ?? {};
	const pinnedOrder = activeSessionKey ? (pinnedOrderMap[activeSessionKey] ?? []) : [];
	const collapsedOrderMap = persistedState.collapsed ?? {};
	const collapsedOrder = activeSessionKey ? collapsedOrderMap[activeSessionKey] : undefined;
	const hasCollapsedState = !!(activeSessionKey && hasOwn(collapsedOrderMap, activeSessionKey));
	const collapsedIdSet = React.useMemo(() => new Set(collapsedOrder ?? []), [collapsedOrder]);

	const setPinnedForActiveSession = React.useCallback((updater: (prev: string[]) => string[]) => {
		if (!activeSessionKey) {
			return;
		}
		updatePersistedState(prev => {
			const prevPinned = prev.pinned ?? {};
			const current = prevPinned[activeSessionKey] ?? [];
			const nextList = updater(current);
			if (arraysEqual(current, nextList)) {
				return prev;
			}
			const nextPinned = { ...prevPinned };
			if (nextList.length) {
				nextPinned[activeSessionKey] = nextList;
			} else {
				delete nextPinned[activeSessionKey];
			}
			return {
				...prev,
				pinned: Object.keys(nextPinned).length ? nextPinned : undefined
			};
		});
	}, [activeSessionKey, updatePersistedState]);

	const setCollapsedForActiveSession = React.useCallback((updater: (prev: string[]) => string[]) => {
		if (!activeSessionKey) {
			return;
		}
		updatePersistedState(prev => {
			const prevCollapsed = prev.collapsed ?? {};
			const hadEntry = hasOwn(prevCollapsed, activeSessionKey);
			const current = hadEntry ? (prevCollapsed[activeSessionKey] ?? []) : [];
			const nextList = updater(current);
			if (hadEntry && arraysEqual(current, nextList)) {
				return prev;
			}
			if (!hadEntry && nextList.length === 0) {
				return prev;
			}
			const nextCollapsed = { ...prevCollapsed, [activeSessionKey]: nextList };
			return {
				...prev,
				collapsed: nextCollapsed
			};
		});
	}, [activeSessionKey, updatePersistedState]);

	React.useEffect(() => {
		const handler = (event: MessageEvent<StateUpdateMessage>) => {
			if (event.data?.type === 'stateUpdate') {
				setRequest(event.data.request);
				setInterception(event.data.interception);
				setSessions(event.data.sessions ?? []);
				setActiveSessionKey(event.data.activeSessionKey);
				const extras = (event.data.extraSections ?? []).filter(isInspectorExtraSection);
				setExtraSections(extras);
			}
		};
		window.addEventListener('message', handler);
		return () => window.removeEventListener('message', handler);
	}, []);

	React.useEffect(() => {
		if (interception?.pending) {
			setBannerPulse(true);
			const handle = window.setTimeout(() => setBannerPulse(false), 900);
			return () => window.clearTimeout(handle);
		}
		setBannerPulse(false);
	}, [interception?.pending?.nonce]);

	React.useEffect(() => {
		setEditingSectionId(null);
	}, [activeSessionKey]);

	React.useEffect(() => {
		if (!request?.sections) {
			setEditingSectionId(null);
			return;
		}
		if (editingSectionId && !request.sections.some(section => section.id === editingSectionId)) {
			setEditingSectionId(null);
		}
		if (!activeSessionKey) {
			return;
		}
		const allowed = new Set(request.sections.map(section => section.id));
		setPinnedForActiveSession(prev => prev.filter(id => allowed.has(id)));
		setCollapsedForActiveSession(prev => prev.filter(id => allowed.has(id)));
		if (!hasCollapsedState) {
			const defaults = request.sections
				.filter(section => section.collapsed)
				.map(section => section.id);
			if (defaults.length) {
				updatePersistedState(prev => {
					const prevCollapsed = prev.collapsed ?? {};
					if (hasOwn(prevCollapsed, activeSessionKey)) {
						return prev;
					}
					return {
						...prev,
						collapsed: {
							...prevCollapsed,
							[activeSessionKey]: defaults
						}
					};
				});
			}
		}
	}, [request, editingSectionId, activeSessionKey, setPinnedForActiveSession, setCollapsedForActiveSession, hasCollapsedState, updatePersistedState]);

	const validationErrorCode = request?.metadata?.lastValidationErrorCode;
	const validationMessage = validationErrorCode ? describeValidationError(validationErrorCode) : undefined;
	const totalTokens = React.useMemo(() => computeTotalTokens(request), [request]);
	const pinnedIdSet = React.useMemo(() => new Set(pinnedOrder), [pinnedOrder]);

	const orderedSections = React.useMemo(() => {
		if (!request?.sections) {
			return [];
		}
		const pinnedSections: LiveRequestSection[] = [];
		const rest: LiveRequestSection[] = [];
		for (const section of request.sections) {
			if (pinnedIdSet.has(section.id)) {
				pinnedSections.push(section);
			} else {
				rest.push(section);
			}
		}
		pinnedSections.sort((a, b) => pinnedOrder.indexOf(a.id) - pinnedOrder.indexOf(b.id));
		return [...pinnedSections, ...rest];
	}, [request, pinnedIdSet, pinnedOrder]);

	const visibleSections = React.useMemo(() => {
		if (!orderedSections.length) {
			return [];
		}
		return captureActive ? orderedSections.slice(0, previewLimit) : orderedSections;
	}, [orderedSections, captureActive, previewLimit]);

	const hiddenSectionCount = captureActive ? Math.max(orderedSections.length - visibleSections.length, 0) : 0;
	const pinnedSections = visibleSections.filter(section => pinnedIdSet.has(section.id));
	const unpinnedSections = visibleSections.filter(section => !pinnedIdSet.has(section.id));
	const sendMessage = React.useCallback((type: string, data?: Record<string, unknown>) => {
		vscode.postMessage({ type, ...(data ?? {}) });
	}, []);

	const handleModeSelect = React.useCallback((nextMode: LiveRequestEditorMode) => {
		sendMessage('setMode', { mode: nextMode });
	}, [sendMessage]);

	const handleBeginAutoOverrideCapture = React.useCallback(() => {
		if (captureActive) {
			return;
		}
		sendMessage('beginAutoOverrideCapture');
	}, [sendMessage, captureActive]);

	const handleClearOverrides = React.useCallback(() => {
		sendMessage('clearAutoOverrides', { scope: autoOverride?.scope });
	}, [sendMessage, autoOverride?.scope]);

	const handleChangeScope = React.useCallback(() => {
		sendMessage('command', { command: 'github.copilot.liveRequestEditor.configureAutoOverrideScope' });
	}, [sendMessage]);

	const handleConfigurePreviewLimit = React.useCallback(() => {
		sendMessage('command', { command: 'github.copilot.liveRequestEditor.configureAutoOverridePreviewLimit' });
	}, [sendMessage]);

	const handleShowDiff = React.useCallback((section: LiveRequestSection) => {
		if (!section.overrideState) {
			return;
		}
		sendMessage('showOverrideDiff', {
			slotIndex: section.overrideState.slotIndex,
			scope: section.overrideState.scope,
			sessionKey: activeSessionKey
		});
	}, [sendMessage, activeSessionKey]);

	const handleTogglePinned = React.useCallback((sectionId: string) => {
		if (!activeSessionKey) {
			return;
		}
		setPinnedForActiveSession(prev => {
			if (prev.includes(sectionId)) {
				return prev.filter(id => id !== sectionId);
			}
			return [...prev, sectionId];
		});
	}, [activeSessionKey, setPinnedForActiveSession]);

	const handleReorderPinned = React.useCallback((sourceId: string, targetId: string, placeAfter: boolean) => {
		if (!activeSessionKey || sourceId === targetId) {
			return;
		}
		setPinnedForActiveSession(prev => {
			if (!prev.includes(sourceId) || !prev.includes(targetId)) {
				return prev;
			}
			const filtered = prev.filter(id => id !== sourceId);
			const targetIndex = filtered.indexOf(targetId);
			const insertIndex = targetIndex + (placeAfter ? 1 : 0);
			const next = [...filtered.slice(0, insertIndex), sourceId, ...filtered.slice(insertIndex)];
			return next;
		});
	}, [activeSessionKey, setPinnedForActiveSession]);

	const handleToggleCollapse = React.useCallback((sectionId: string) => {
		setCollapsedForActiveSession(prev => {
			if (prev.includes(sectionId)) {
				return prev.filter(id => id !== sectionId);
			}
			return [...prev, sectionId];
		});
	}, [setCollapsedForActiveSession]);

	const handleEditToggle = React.useCallback((sectionId: string) => {
		setEditingSectionId(current => (current === sectionId ? null : sectionId));
	}, []);

	const handleCancelEdit = React.useCallback(() => {
		setEditingSectionId(null);
	}, []);

	const handleSaveEdit = React.useCallback((sectionId: string, content: string) => {
		sendMessage('editSection', { sectionId, content });
		setEditingSectionId(null);
	}, [sendMessage]);

	const handleDelete = React.useCallback((sectionId: string) => {
		sendMessage('deleteSection', { sectionId });
	}, [sendMessage]);

	const handleRestore = React.useCallback((sectionId: string) => {
		sendMessage('restoreSection', { sectionId });
	}, [sendMessage]);

	const handleResetRequest = React.useCallback(() => {
		sendMessage('resetRequest', {});
	}, [sendMessage]);

	const handleReplayPrompt = React.useCallback(() => {
		if (!activeSessionKey) {
			return;
		}
		sendMessage('command', {
			command: 'github.copilot.liveRequestEditor.replayPrompt',
			args: [activeSessionKey]
		});
	}, [sendMessage, activeSessionKey]);

	const handleResumeSend = React.useCallback(() => {
		sendMessage('resumeSend');
	}, [sendMessage]);

	const handleCancelIntercept = React.useCallback(() => {
		sendMessage('cancelIntercept');
	}, [sendMessage]);

	const handleSessionChange = React.useCallback<React.FormEventHandler<HTMLElement>>((event) => {
		const dropdown = event.target as HTMLSelectElement & { value?: string };
		const value = dropdown?.value;
		if (typeof value !== 'string' || value.length === 0 || value === activeSessionKey) {
			return;
		}
		setActiveSessionKey(value);
		sendMessage('selectSession', { sessionKey: value });
	}, [activeSessionKey, sendMessage]);
	const formatSessionTooltip = React.useCallback((session: SessionSummary) => {
		const created = session.createdAt ? `Created ${formatTimestamp(session.createdAt)}` : undefined;
		const updated = session.lastUpdated ? `Updated ${formatTimestamp(session.lastUpdated)}` : undefined;
		const parts = [session.locationLabel, created, updated].filter(Boolean);
		return parts.join(' • ');
	}, []);

	if (!request || !request.sections || request.sections.length === 0) {
		return <EmptyState />;
	}

	const pinnedTokenTotal = pinnedSections.reduce((sum, section) => sum + (section.tokenCount ?? 0), 0);
	const promptText = request.metadata?.maxPromptTokens
		? `${formatNumber(totalTokens)} / ${formatNumber(request.metadata.maxPromptTokens)} (${formatPercent(totalTokens, request.metadata.maxPromptTokens)})`
		: `${formatNumber(totalTokens)} tokens`;

	return (
		<>
			<div className="status-banner">
				<div className="header">
					<div className="header-left">
						<h2>Live Request Editor</h2>
						{sessions.length > 0 && (
							<div className="session-selector" role="group" aria-label="Conversation selector">
								<label className="session-selector-label" htmlFor="live-request-session-dropdown">
									Conversation
								</label>
								<vscode-dropdown
									id="live-request-session-dropdown"
									className="session-selector-dropdown"
									value={activeSessionKey ?? ''}
									onChange={handleSessionChange}
								>
									{sessions.map(session => (
										<vscode-option
											key={session.key}
											value={session.key}
											title={formatSessionTooltip(session)}
										>
											{session.label}
											{session.isLatest ? ' · NEW' : ''}
											{session.isActive ? ' · Current' : ''}
										</vscode-option>
									))}
								</vscode-dropdown>
							</div>
						)}
					</div>
					<div className="header-actions">
						<div className="mode-toggle" role="group" aria-label="Prompt Inspector mode">
							{MODE_OPTIONS.map(option => {
								const disabled = option.mode === 'autoOverride' && !autoOverride?.enabled;
								const active = displayMode === option.mode;
								return (
									<button
										key={option.mode}
										type="button"
										className={`mode-toggle-button${active ? ' active' : ''}`}
										onClick={() => handleModeSelect(option.mode)}
										disabled={disabled}
										title={option.description}
									>
										{option.label}
									</button>
								);
							})}
						</div>
						{request.isDirty && (
							<>
								<span className="dirty-badge" role="status" aria-live="polite">Modified</span>
								<vscode-button appearance="secondary" onClick={handleResetRequest}>
									Reset
								</vscode-button>
							</>
						)}
						<vscode-button appearance="secondary" onClick={handleReplayPrompt}>
							Replay edited prompt
						</vscode-button>
					</div>
				</div>
				<div className="metadata">
					<div className="metadata-row">
						<div className="metadata-item">
							<span className="metadata-label">Model:</span>
							<span>{request.model}</span>
						</div>
						<div className="metadata-item">
							<span className="metadata-label">Location:</span>
							<span>{describeLocation(request.location)}</span>
						</div>
						<div className="metadata-item">
							<span className="metadata-label">Prompt Budget:</span>
							<span>{promptText}</span>
						</div>
						<div className="metadata-item">
							<span className="metadata-label">Sections:</span>
							<span>{request.sections.length}</span>
						</div>
					</div>
					{(request.debugName || request.metadata?.requestId || request.sessionId) ? (
						<div className="metadata-row metadata-row-subtle">
							{request.debugName ? (
								<div className="metadata-item">
									<span className="metadata-label">Conversation:</span>
									<span>{request.debugName}</span>
								</div>
							) : null}
							{request.metadata?.requestId ? (
								<div className="metadata-item">
									<span className="metadata-label">Request ID:</span>
									<span className="metadata-mono">{request.metadata.requestId}</span>
								</div>
							) : null}
							<div className="metadata-item">
								<span className="metadata-label">Session ID:</span>
								<span className="metadata-mono">{request.sessionId}</span>
							</div>
						</div>
					) : null}
					{totalTokens > 0 && request.metadata?.maxPromptTokens ? (
						<div className="status-meter">
							<div className="status-meter-fill" style={{ width: formatPercent(totalTokens, request.metadata.maxPromptTokens) }} />
							<span className="status-meter-label">{formatPercent(totalTokens, request.metadata.maxPromptTokens)}</span>
						</div>
					) : null}
				</div>

				{request && extraSections.length > 0 ? (
					<div className="inspector-extra-panels">
						{extraSections.includes('telemetry') ? (
							<TelemetryPanel
								panelId="extra:telemetry"
								metadata={request.metadata}
								isCollapsed={collapsedIdSet.has('extra:telemetry')}
								onToggleCollapse={handleToggleCollapse}
							/>
						) : null}
					</div>
				) : null}

				{mode === 'autoOverride' && autoOverride?.enabled ? (
					<div className={`auto-override-banner ${captureActive ? 'capturing' : autoOverride.hasOverrides ? 'active' : 'idle'}`}>
						<div className="auto-override-text">
							<strong>Auto-apply edits · {describeOverrideScope(autoOverride.scope)}</strong>
							<span>
								{captureActive
									? `Capturing next turn · showing first ${previewLimit} sections`
									: autoOverride.hasOverrides
										? formatAutoOverrideStatus(autoOverride.lastUpdated)
										: `No saved edits yet · next turn will pause to capture`}
							</span>
						</div>
						<div className="auto-override-actions">
							<vscode-button appearance="primary" onClick={handleBeginAutoOverrideCapture}>
								Capture new edits{captureActive ? ' (armed)' : ''}
							</vscode-button>
							{!captureActive ? (
								<vscode-button appearance="secondary" onClick={() => handleModeSelect('interceptOnce')}>
									Pause next turn
								</vscode-button>
							) : null}
							<vscode-button appearance="secondary" onClick={handleClearOverrides}>
								Remove saved edits{autoOverride.hasOverrides ? '' : ' (none)'}
							</vscode-button>
							<vscode-button appearance="secondary" onClick={handleChangeScope}>
								Where to save edits
							</vscode-button>
							<vscode-button appearance="secondary" onClick={handleConfigurePreviewLimit}>
								Sections to capture
							</vscode-button>
						</div>
					</div>
				) : null}

				{captureActive && hiddenSectionCount > 0 ? (
					<div className="auto-override-note">
						Only the first {previewLimit} sections are shown while editing overrides.
					</div>
				) : null}

				{validationMessage ? (
					<div className="validation-banner" role="alert" aria-live="polite">
						<div className="validation-text">
							<strong>Send blocked.</strong> {validationMessage}
						</div>
						{request.isDirty ? (
							<div className="validation-actions">
								<vscode-button appearance="secondary" onClick={handleResetRequest}>
									Reset prompt
								</vscode-button>
							</div>
						) : null}
					</div>
				) : null}

				{interception?.pending ? (
					<div className={`interception-banner pending ${bannerPulse ? 'pulse' : ''}`}>
						<div className="interception-text">
							Request intercepted{interception.pending.debugName ? ` - ${interception.pending.debugName}` : ''}. Review updates and choose an action.
						</div>
						<div className="interception-actions">
							<vscode-button appearance="primary" onClick={handleResumeSend}>
								Resume Send
							</vscode-button>
							<vscode-button appearance="secondary" onClick={handleCancelIntercept}>
								Cancel
							</vscode-button>
						</div>
					</div>
				) : (interception?.enabled && mode !== 'autoOverride') ? (
					<div className="interception-banner ready">
						<div className="interception-text">
							{mode === 'interceptOnce'
								? 'Next request will pause here for review.'
								: 'Prompt Interception Mode is on. Requests pause here before sending.'}
						</div>
					</div>
				) : null}

				{pinnedSections.length > 0 && (
					<div className="pinned-container">
						<h3>Pinned Sections</h3>
						<div className="pinned-summary">
							{totalTokens
								? `${formatNumber(pinnedTokenTotal)} tokens (${formatPercent(pinnedTokenTotal, totalTokens)})`
								: `${formatNumber(pinnedTokenTotal)} tokens`}
						</div>
						{pinnedSections.map(section => (
							<SectionCard
								key={section.id}
								section={section}
								totalTokens={totalTokens}
								isPinned
								isEditing={editingSectionId === section.id}
								isCollapsed={collapsedIdSet.has(section.id) || (!hasCollapsedState && !!section.collapsed)}
								onToggleCollapse={handleToggleCollapse}
								onTogglePinned={handleTogglePinned}
								onEditToggle={handleEditToggle}
								onCancelEdit={handleCancelEdit}
								onSaveEdit={handleSaveEdit}
								onDelete={handleDelete}
								onRestore={handleRestore}
								onShowDiff={handleShowDiff}
								draggingRef={draggingSectionRef}
								onReorderPinned={handleReorderPinned}
							/>
						))}
					</div>
				)}
			</div>

			<div className="sections-wrapper">
				{unpinnedSections.map(section => (
					<SectionCard
						key={section.id}
						section={section}
						totalTokens={totalTokens}
						isPinned={false}
						isEditing={editingSectionId === section.id}
						isCollapsed={collapsedIdSet.has(section.id) || (!hasCollapsedState && !!section.collapsed)}
						onToggleCollapse={handleToggleCollapse}
						onTogglePinned={handleTogglePinned}
						onEditToggle={handleEditToggle}
						onCancelEdit={handleCancelEdit}
						onSaveEdit={handleSaveEdit}
						onDelete={handleDelete}
						onRestore={handleRestore}
						onShowDiff={handleShowDiff}
						draggingRef={draggingSectionRef}
						onReorderPinned={handleReorderPinned}
					/>
				))}
			</div>
		</>
	);
};

const rootElement = document.getElementById('app');
if (rootElement) {
	ReactDOM.render(<App />, rootElement);
}
