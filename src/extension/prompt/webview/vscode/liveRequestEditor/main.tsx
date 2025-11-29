/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';

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
		}
	}
}

interface EditableChatRequest {
	id: string;
	model: string;
	isDirty: boolean;
	sections: LiveRequestSection[];
	metadata?: {
		tokenCount?: number;
		maxPromptTokens?: number;
	};
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
}

interface StateUpdateMessage {
	type: 'stateUpdate';
	request?: EditableChatRequest;
	interception?: InterceptionState;
}

interface PersistedState {
	pinned?: string[];
}

interface InterceptionState {
	enabled: boolean;
	pending?: {
		debugName: string;
		nonce: number;
	};
}

const vscode = acquireVsCodeApi<PersistedState>();

provideVSCodeDesignSystem().register(vsCodeButton());

function formatNumber(value?: number): string {
	if (value === undefined || value === null || Number.isNaN(value)) {
		return '—';
	}
	return Number(value).toLocaleString();
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
	onToggleCollapse: (sectionId: string) => void;
	onTogglePinned: (sectionId: string) => void;
	onEditToggle: (sectionId: string) => void;
	onCancelEdit: () => void;
	onSaveEdit: (sectionId: string, content: string) => void;
	onDelete: (sectionId: string) => void;
	onRestore: (sectionId: string) => void;
	draggingRef: React.MutableRefObject<string | null>;
	onReorderPinned: (sourceId: string, targetId: string, placeAfter: boolean) => void;
}

const SectionCard: React.FC<SectionCardProps> = ({
	section,
	totalTokens,
	isPinned,
	isEditing,
	onToggleCollapse,
	onTogglePinned,
	onEditToggle,
	onCancelEdit,
	onSaveEdit,
	onDelete,
	onRestore,
	draggingRef,
	onReorderPinned,
}) => {
	const [draftContent, setDraftContent] = React.useState(section.content ?? '');
	const [dragPosition, setDragPosition] = React.useState<'none' | 'above' | 'below'>('none');
	const collapsed = !!section.collapsed && !isEditing;
	const deleted = !!section.deleted;
	const sectionTokens = section.tokenCount ?? 0;
	const canDrag = isPinned && !deleted;

	React.useEffect(() => {
		if (isEditing) {
			setDraftContent(section.content ?? '');
		}
	}, [isEditing, section.content]);

	const className = [
		'section',
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
			<div className="section-header" role="button" onClick={() => onToggleCollapse(section.id)}>
				<div className="section-title">
					<span className="icon">{collapsed ? '\u25B6' : '\u25BC'}</span>
					<span className={`section-kind ${section.kind}`}>{section.kind}</span>
					<span>{section.label}</span>
					{sectionTokens > 0 && (
						<span className="section-tokens">
							{formatNumber(sectionTokens)} tokens
							{totalTokens > 0 && (
								<span className="section-percentage">{formatPercent(sectionTokens, totalTokens)}</span>
							)}
						</span>
					)}
					{isPinned && <span className="pinned-indicator">Pinned</span>}
				</div>
				<div className="section-actions" onClick={event => event.stopPropagation()}>
					{deleted ? (
						<vscode-button appearance="secondary" className="inline-button" onClick={() => onRestore(section.id)}>
							Restore
						</vscode-button>
					) : (
						<>
							<vscode-button
								appearance="secondary"
								className="inline-button"
								onClick={() => onTogglePinned(section.id)}
							>
								{isPinned ? 'Unpin' : 'Pin'}
							</vscode-button>
							{section.editable && (
								<vscode-button
									appearance="secondary"
									className="inline-button"
									onClick={() => onEditToggle(section.id)}
								>
									{isEditing ? 'Cancel Edit' : 'Edit'}
								</vscode-button>
							)}
							{section.deletable && (
								<vscode-button
									appearance="secondary"
									className="inline-button"
									onClick={() => onDelete(section.id)}
								>
									Delete
								</vscode-button>
							)}
						</>
					)}
				</div>
			</div>
			<div className="section-content">
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
					<pre>{section.content ?? ''}</pre>
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

const App: React.FC = () => {
	const [request, setRequest] = React.useState<EditableChatRequest | undefined>(undefined);
	const [interception, setInterception] = React.useState<InterceptionState | undefined>(undefined);
	const [editingSectionId, setEditingSectionId] = React.useState<string | null>(null);
	const [pinnedOrder, setPinnedOrder] = React.useState<string[]>(() => {
		const persisted = vscode.getState?.();
		return Array.isArray(persisted?.pinned) ? [...persisted.pinned] : [];
	});
	const draggingSectionRef = React.useRef<string | null>(null);
	const [bannerPulse, setBannerPulse] = React.useState(false);

	const persistPinned = React.useCallback((order: string[]) => {
		vscode.setState?.({ pinned: order });
	}, []);

	React.useEffect(() => {
		const handler = (event: MessageEvent<StateUpdateMessage>) => {
			if (event.data?.type === 'stateUpdate') {
				setRequest(event.data.request);
				setInterception(event.data.interception);
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
		if (!request?.sections) {
			setEditingSectionId(null);
			return;
		}
		const allowed = new Set(request.sections.map(section => section.id));
		setPinnedOrder(prev => {
			const filtered = prev.filter(id => allowed.has(id));
			if (filtered.length === prev.length) {
				return prev;
			}
			persistPinned(filtered);
			return filtered;
		});
		if (editingSectionId && !request.sections.some(section => section.id === editingSectionId)) {
			setEditingSectionId(null);
		}
	}, [request, editingSectionId, persistPinned]);

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

	const pinnedSections = orderedSections.filter(section => pinnedIdSet.has(section.id));
	const unpinnedSections = orderedSections.filter(section => !pinnedIdSet.has(section.id));

	const sendMessage = React.useCallback((type: string, data?: Record<string, unknown>) => {
		vscode.postMessage({ type, ...(data ?? {}) });
	}, []);

	const handleTogglePinned = React.useCallback((sectionId: string) => {
		setPinnedOrder(prev => {
			const filtered = prev.filter(id => id !== sectionId);
			const next = prev.includes(sectionId) ? filtered : [...filtered, sectionId];
			persistPinned(next);
			return next;
		});
	}, [persistPinned]);

	const handleReorderPinned = React.useCallback((sourceId: string, targetId: string, placeAfter: boolean) => {
		if (sourceId === targetId) {
			return;
		}
		setPinnedOrder(prev => {
			if (!prev.includes(sourceId) || !prev.includes(targetId)) {
				return prev;
			}
			const filtered = prev.filter(id => id !== sourceId);
			const targetIndex = filtered.indexOf(targetId);
			const insertIndex = targetIndex + (placeAfter ? 1 : 0);
			const next = [...filtered.slice(0, insertIndex), sourceId, ...filtered.slice(insertIndex)];
			persistPinned(next);
			return next;
		});
	}, [persistPinned]);

	const handleToggleCollapse = React.useCallback((sectionId: string) => {
		sendMessage('toggleCollapse', { sectionId });
	}, [sendMessage]);

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

	const handleResumeSend = React.useCallback(() => {
		sendMessage('resumeSend');
	}, [sendMessage]);

	const handleCancelIntercept = React.useCallback(() => {
		sendMessage('cancelIntercept');
	}, [sendMessage]);

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
					<div>
						<h2>Live Request Editor</h2>
					</div>
					<div className="header-actions">
						{request.isDirty && (
							<>
								<span className="dirty-badge">Modified</span>
								<vscode-button appearance="secondary" onClick={handleResetRequest}>
									Reset
								</vscode-button>
							</>
						)}
					</div>
				</div>
				<div className="metadata">
					<div className="metadata-row">
						<div className="metadata-item">
							<span className="metadata-label">Model:</span>
							<span>{request.model}</span>
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
					{totalTokens > 0 && request.metadata?.maxPromptTokens ? (
						<div className="status-meter">
							<div className="status-meter-fill" style={{ width: formatPercent(totalTokens, request.metadata.maxPromptTokens) }} />
							<span className="status-meter-label">{formatPercent(totalTokens, request.metadata.maxPromptTokens)}</span>
						</div>
					) : null}
				</div>

				{interception?.enabled ? (
					<div className={[
						'interception-banner',
						interception.pending ? 'pending' : 'ready',
						bannerPulse ? 'pulse' : ''
					].join(' ')}>
						<div className="interception-text">
							{interception.pending
								? (
									<>
										Request intercepted{interception.pending.debugName ? ` - ${interception.pending.debugName}` : ''}. Review updates and choose an action.
									</>
								)
								: 'Prompt Interception Mode is on. Requests pause here before sending.'}
						</div>
						{interception.pending ? (
							<div className="interception-actions">
								<vscode-button appearance="primary" onClick={handleResumeSend}>
									Resume Send
								</vscode-button>
								<vscode-button appearance="secondary" onClick={handleCancelIntercept}>
									Cancel
								</vscode-button>
							</div>
						) : null}
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
								onToggleCollapse={handleToggleCollapse}
								onTogglePinned={handleTogglePinned}
								onEditToggle={handleEditToggle}
								onCancelEdit={handleCancelEdit}
								onSaveEdit={handleSaveEdit}
								onDelete={handleDelete}
								onRestore={handleRestore}
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
						onToggleCollapse={handleToggleCollapse}
						onTogglePinned={handleTogglePinned}
						onEditToggle={handleEditToggle}
						onCancelEdit={handleCancelEdit}
						onSaveEdit={handleSaveEdit}
						onDelete={handleDelete}
						onRestore={handleRestore}
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
