/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface VSCodeAPI<TState = unknown> {
	postMessage(message: unknown): void;
	getState?(): TState | undefined;
	setState?(newState: TState): void;
}

declare function acquireVsCodeApi<TState = unknown>(): VSCodeAPI<TState>;

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
}

interface PersistedState {
	pinned?: string[];
}

const vscode = acquireVsCodeApi<PersistedState>();
const app = document.getElementById('app') as HTMLDivElement | null;

let editingSectionId: string | null = null;
let currentRequest: EditableChatRequest | undefined;

const persistedState = vscode.getState?.() ?? {};
let pinnedOrder = Array.isArray(persistedState?.pinned) ? [...persistedState.pinned] : [];
let pinnedSectionIds = new Set(pinnedOrder);
let draggingSectionId: string | null = null;

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

function persistPinned(): void {
	vscode.setState?.({ pinned: [...pinnedOrder] });
}

function sanitizePinned(sections: LiveRequestSection[]): void {
	const allowed = new Set(sections.map(section => section.id));
	let didChange = false;
	pinnedOrder = pinnedOrder.filter(id => {
		if (allowed.has(id)) {
			return true;
		}
		didChange = true;
		return false;
	});
	pinnedSectionIds = new Set(pinnedOrder);
	if (didChange) {
		persistPinned();
	}
}

function orderSections(sections: LiveRequestSection[]): LiveRequestSection[] {
	sanitizePinned(sections);
	const pinned: LiveRequestSection[] = [];
	const rest: LiveRequestSection[] = [];

	for (const section of sections) {
		if (pinnedSectionIds.has(section.id)) {
			pinned.push(section);
		} else {
			rest.push(section);
		}
	}

	pinned.sort((a, b) => pinnedOrder.indexOf(a.id) - pinnedOrder.indexOf(b.id));
	return [...pinned, ...rest];
}

function togglePinned(sectionId: string): void {
	if (!currentRequest) {
		return;
	}
	if (pinnedSectionIds.has(sectionId)) {
		pinnedSectionIds.delete(sectionId);
		pinnedOrder = pinnedOrder.filter(id => id !== sectionId);
	} else {
		pinnedSectionIds.add(sectionId);
		pinnedOrder = pinnedOrder.filter(id => id !== sectionId);
		pinnedOrder.push(sectionId);
	}
	persistPinned();
	render(currentRequest);
}

function reorderPinned(sourceId: string, targetId: string, placeAfter: boolean): void {
	if (!pinnedSectionIds.has(sourceId) || !pinnedSectionIds.has(targetId) || sourceId === targetId) {
		return;
	}
	const sourceIndex = pinnedOrder.indexOf(sourceId);
	const targetIndex = pinnedOrder.indexOf(targetId);
	if (sourceIndex === -1 || targetIndex === -1) {
		return;
	}
	const newOrder = pinnedOrder.filter(id => id !== sourceId);
	const targetPos = newOrder.indexOf(targetId);
	const insertIndex = targetPos + (placeAfter ? 1 : 0);
	newOrder.splice(insertIndex, 0, sourceId);
	pinnedOrder = newOrder;
	persistPinned();
	render(currentRequest);
}

function sendMessage(type: string, data: Record<string, unknown>): void {
	vscode.postMessage({ type, ...data });
}

function createMetadataItem(label: string, value: string): HTMLElement {
	const item = document.createElement('div');
	item.className = 'metadata-item';

	const labelNode = document.createElement('span');
	labelNode.className = 'metadata-label';
	labelNode.textContent = label;

	const valueNode = document.createElement('span');
	valueNode.textContent = value;

	item.appendChild(labelNode);
	item.appendChild(valueNode);
	return item;
}

function createPinnedSummary(totalTokens: number, pinnedTokens: number): string {
	if (!totalTokens) {
		return `${formatNumber(pinnedTokens)} tokens`;
	}
	return `${formatNumber(pinnedTokens)} tokens (${formatPercent(pinnedTokens, totalTokens)})`;
}

function renderStatusBanner(request: EditableChatRequest, totalTokens: number): HTMLElement {
	const banner = document.createElement('div');
	banner.className = 'status-banner';

	const header = document.createElement('div');
	header.className = 'header';

	const headerTitle = document.createElement('div');
	const title = document.createElement('h2');
	title.textContent = 'Live Request Editor';
	headerTitle.appendChild(title);
	header.appendChild(headerTitle);

	const headerActions = document.createElement('div');
	headerActions.className = 'header-actions';
	if (request.isDirty) {
		const badge = document.createElement('span');
		badge.className = 'dirty-badge';
		badge.textContent = 'Modified';
		headerActions.appendChild(badge);

		const resetBtn = document.createElement('button');
		resetBtn.className = 'secondary';
		resetBtn.dataset.action = 'reset';
		resetBtn.textContent = 'Reset';
		headerActions.appendChild(resetBtn);
	}
	header.appendChild(headerActions);

	const metadata = document.createElement('div');
	metadata.className = 'metadata';

	const metadataRow = document.createElement('div');
	metadataRow.className = 'metadata-row';

	metadataRow.appendChild(createMetadataItem('Model:', request.model));

	const maxPrompt = request.metadata?.maxPromptTokens;
	const promptText = maxPrompt
		? `${formatNumber(totalTokens)} / ${formatNumber(maxPrompt)} (${formatPercent(totalTokens, maxPrompt)})`
		: `${formatNumber(totalTokens)} tokens`;
	metadataRow.appendChild(createMetadataItem('Prompt Budget:', promptText));

	metadataRow.appendChild(createMetadataItem('Sections:', String(request.sections.length)));

	metadata.appendChild(metadataRow);

	banner.appendChild(header);
	banner.appendChild(metadata);

	const orderedSections = orderSections(request.sections ?? []);
	const pinnedSections = orderedSections.filter(section => pinnedSectionIds.has(section.id));

	if (pinnedSections.length) {
		const pinnedContainer = document.createElement('div');
		pinnedContainer.className = 'pinned-container';

		const heading = document.createElement('h3');
		heading.textContent = 'Pinned Sections';
		pinnedContainer.appendChild(heading);

		const pinnedTokens = pinnedSections.reduce((sum, section) => sum + (section.tokenCount ?? 0), 0);
		const summary = document.createElement('div');
		summary.className = 'pinned-summary';
		summary.textContent = createPinnedSummary(totalTokens, pinnedTokens);
		pinnedContainer.appendChild(summary);

		pinnedSections.forEach((section, index) => {
			pinnedContainer.appendChild(renderSection(section, index, totalTokens));
		});

		banner.appendChild(pinnedContainer);
	}

	return banner;
}

function renderSection(section: LiveRequestSection, index: number, totalTokens: number): HTMLElement {
	const isEditing = editingSectionId === section.id;
	const isDeleted = !!section.deleted;
	const isCollapsed = !!section.collapsed && !isEditing;
	const isPinned = pinnedSectionIds.has(section.id);

	const container = document.createElement('div');
	container.className = 'section';
	if (isCollapsed) {
		container.classList.add('collapsed');
	}
	if (isDeleted) {
		container.classList.add('deleted');
	}
	if (isPinned) {
		container.classList.add('pinned');
	}
	container.dataset.sectionId = section.id;

	const header = document.createElement('div');
	header.className = 'section-header';
	header.dataset.toggle = section.id;

	const title = document.createElement('div');
	title.className = 'section-title';

	const icon = document.createElement('span');
	icon.className = 'icon';
	icon.textContent = isCollapsed ? '\u25B6' : '\u25BC';
	title.appendChild(icon);

	const kindBadge = document.createElement('span');
	kindBadge.className = `section-kind ${section.kind}`;
	kindBadge.textContent = section.kind;
	title.appendChild(kindBadge);

	const label = document.createElement('span');
	label.textContent = section.label;
	title.appendChild(label);

	const sectionTokens = section.tokenCount ?? 0;
	if (sectionTokens) {
		const tokens = document.createElement('span');
		tokens.className = 'section-tokens';
		tokens.textContent = `${formatNumber(sectionTokens)} tokens`;

		if (totalTokens) {
			const pct = document.createElement('span');
			pct.className = 'section-percentage';
			pct.textContent = formatPercent(sectionTokens, totalTokens);
			tokens.appendChild(pct);
		}
		title.appendChild(tokens);
	}

	if (isPinned) {
		const pinnedBadge = document.createElement('span');
		pinnedBadge.className = 'pinned-indicator';
		pinnedBadge.textContent = 'Pinned';
		title.appendChild(pinnedBadge);
	}

	header.appendChild(title);

	const actions = document.createElement('div');
	actions.className = 'section-actions';

	if (isDeleted) {
		const restoreBtn = document.createElement('button');
		restoreBtn.className = 'secondary';
		restoreBtn.dataset.action = 'restore';
		restoreBtn.dataset.section = section.id;
		restoreBtn.textContent = 'Restore';
		restoreBtn.title = 'Restore section';
		actions.appendChild(restoreBtn);
	} else {
		const pinBtn = document.createElement('button');
		pinBtn.className = 'icon-only';
		pinBtn.dataset.action = 'stick';
		pinBtn.dataset.section = section.id;
		pinBtn.textContent = isPinned ? 'Unstick' : 'Stick';
		pinBtn.title = isPinned ? 'Unstick section' : 'Stick section';
		actions.appendChild(pinBtn);

		if (section.editable) {
			const editBtn = document.createElement('button');
			editBtn.className = 'icon-only';
			editBtn.dataset.action = 'edit';
			editBtn.dataset.section = section.id;
			editBtn.textContent = isEditing ? 'Cancel' : 'Edit';
			editBtn.title = 'Edit section';
			actions.appendChild(editBtn);
		}

		if (section.deletable) {
			const deleteBtn = document.createElement('button');
			deleteBtn.className = 'icon-only';
			deleteBtn.dataset.action = 'delete';
			deleteBtn.dataset.section = section.id;
			deleteBtn.textContent = 'Delete';
			deleteBtn.title = 'Delete section';
			actions.appendChild(deleteBtn);
		}
	}

	header.appendChild(actions);
	container.appendChild(header);

	const content = document.createElement('div');
	content.className = 'section-content';

	if (isEditing) {
		const textarea = document.createElement('textarea');
		textarea.className = 'section-editor';
		textarea.dataset.section = section.id;
		textarea.value = section.content ?? '';
		content.appendChild(textarea);

		const editorActions = document.createElement('div');
		editorActions.className = 'editor-actions';

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'secondary';
		cancelBtn.dataset.action = 'cancel-edit';
		cancelBtn.dataset.section = section.id;
		cancelBtn.textContent = 'Cancel';
		editorActions.appendChild(cancelBtn);

		const saveBtn = document.createElement('button');
		saveBtn.className = 'primary';
		saveBtn.dataset.action = 'save-edit';
		saveBtn.dataset.section = section.id;
		saveBtn.textContent = 'Save';
		editorActions.appendChild(saveBtn);

		content.appendChild(editorActions);
	} else {
		const pre = document.createElement('pre');
		pre.textContent = section.content ?? '';
		content.appendChild(pre);
	}

	if (totalTokens && sectionTokens) {
		const meter = document.createElement('div');
		meter.className = 'token-meter';
		const fill = document.createElement('div');
		fill.className = 'token-meter-fill';
		fill.style.width = formatPercent(sectionTokens, totalTokens);
		meter.appendChild(fill);
		content.appendChild(meter);
	}

	container.appendChild(content);

	const enableDrag = isPinned && !isDeleted;
	container.draggable = enableDrag;

	if (enableDrag) {
		container.addEventListener('dragstart', event => {
			draggingSectionId = section.id;
			event.dataTransfer?.setData('text/plain', section.id);
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move';
			}
		});

		container.addEventListener('dragover', event => {
			if (!draggingSectionId || draggingSectionId === section.id) {
				return;
			}
			event.preventDefault();
			container.classList.add('drag-over');
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'move';
			}
		});

		container.addEventListener('dragleave', () => {
			container.classList.remove('drag-over');
		});

		container.addEventListener('drop', event => {
			if (!draggingSectionId || draggingSectionId === section.id) {
				container.classList.remove('drag-over');
				return;
			}
			event.preventDefault();
			const sourceId = event.dataTransfer?.getData('text/plain') || draggingSectionId;
			const rect = container.getBoundingClientRect();
			const dropAfter = (event.clientY - rect.top) > rect.height / 2;
			container.classList.remove('drag-over');
			reorderPinned(sourceId, section.id, dropAfter);
			draggingSectionId = null;
		});

		container.addEventListener('dragend', () => {
			container.classList.remove('drag-over');
			draggingSectionId = null;
		});
	}

	return container;
}

function renderEmptyState(): HTMLElement {
	const empty = document.createElement('div');
	empty.className = 'empty-state';

	const title = document.createElement('p');
	const strong = document.createElement('strong');
	strong.textContent = 'Live Request Editor';
	title.appendChild(strong);
	empty.appendChild(title);

	const status = document.createElement('p');
	status.textContent = 'Waiting for a chat request...';
	empty.appendChild(status);

	const hint = document.createElement('p');
	hint.style.fontSize = '12px';
	hint.textContent = 'Start a conversation in the chat panel to inspect and edit the prompt.';
	empty.appendChild(hint);

	return empty;
}

function render(request?: EditableChatRequest): void {
	currentRequest = request;

	if (!app) {
		return;
	}

	app.textContent = '';

	if (!request || !request.sections || request.sections.length === 0) {
		app.appendChild(renderEmptyState());
		return;
	}

	const totalTokens = computeTotalTokens(request);
	app.appendChild(renderStatusBanner(request, totalTokens));

	const orderedSections = orderSections(request.sections ?? []);
	const unpinned = orderedSections.filter(section => !pinnedSectionIds.has(section.id));

	const wrapper = document.createElement('div');
	wrapper.className = 'sections-wrapper';

	for (let i = 0; i < unpinned.length; i++) {
		wrapper.appendChild(renderSection(unpinned[i], i, totalTokens));
	}

	app.appendChild(wrapper);
	attachEventListeners();
}

function attachEventListeners(): void {
	if (!app) {
		return;
	}

	app.querySelectorAll<HTMLElement>('[data-toggle]').forEach(node => {
		node.addEventListener('click', event => {
			const target = event.target as HTMLElement | null;
			if (target?.closest('[data-action]')) {
				return;
			}
			const sectionId = node.dataset.toggle;
			if (sectionId) {
				sendMessage('toggleCollapse', { sectionId });
			}
		});
	});

	app.querySelectorAll<HTMLElement>('[data-action]').forEach(node => {
		node.addEventListener('click', event => {
			event.stopPropagation();
			const action = node.dataset.action;
			const sectionId = node.dataset.section ?? undefined;

			switch (action) {
				case 'stick':
					if (sectionId) {
						togglePinned(sectionId);
					}
					break;
				case 'edit':
					editingSectionId = editingSectionId === sectionId ? null : sectionId ?? null;
					render(currentRequest);
					break;
				case 'cancel-edit':
					editingSectionId = null;
					render(currentRequest);
					break;
				case 'save-edit': {
					if (!sectionId) {
						break;
					}
					const textarea = app.querySelector<HTMLTextAreaElement>(
						`textarea[data-section="${sectionId}"]`,
					);
					if (textarea) {
						sendMessage('editSection', { sectionId, content: textarea.value });
						editingSectionId = null;
					}
					break;
				}
				case 'delete':
					if (sectionId) {
						sendMessage('deleteSection', { sectionId });
					}
					break;
				case 'restore':
					if (sectionId) {
						sendMessage('restoreSection', { sectionId });
					}
					break;
				case 'reset':
					sendMessage('resetRequest', {});
					break;
			}
		});
	});
}

window.addEventListener('message', event => {
	const message = event.data as StateUpdateMessage;
	if (message?.type === 'stateUpdate') {
		render(message.request);
	}
});

render();
