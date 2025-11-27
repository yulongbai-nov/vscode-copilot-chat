/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const root = document.getElementById('app');
	const refs = {
		title: root.querySelector('[data-ref="title"]'),
		tokenSummary: root.querySelector('[data-ref="tokenSummary"]'),
		globalActions: root.querySelector('[data-ref="globalActions"]'),
		progress: root.querySelector('[data-ref="progress"]'),
		sections: root.querySelector('[data-ref="sections"]'),
		empty: root.querySelector('[data-ref="empty"]'),
		loadMore: root.querySelector('[data-ref="loadMore"]')
	};

	const sectionNodes = new Map();
	const sectionActionAreas = new Map();
	const sectionWarningAreas = new Map();
	let latestVersion = 0;

	window.addEventListener('message', event => {
		const message = event.data;
		if (!message || typeof message !== 'object') {
			return;
		}

		if (typeof message.version === 'number' && message.version < latestVersion) {
			return;
		}

		if (typeof message.version === 'number') {
			latestVersion = message.version;
		}

		switch (message.type) {
			case 'render':
				resetUI();
				renderParts(message.parts ?? []);
				break;
			case 'patch':
				applyPatch(message.patch, message.parts ?? []);
				break;
			case 'error':
				showError(message.message ?? 'An error occurred while rendering the prompt.');
				break;
		}
	});

	function resetUI() {
		refs.globalActions.innerHTML = '';
		refs.progress.textContent = '';
		refs.loadMore.innerHTML = '';
		refs.empty.classList.add('hidden');
		clearSections();
	}

	function clearSections() {
		sectionNodes.clear();
		sectionActionAreas.clear();
		sectionWarningAreas.clear();
		refs.sections.innerHTML = '';
	}

	function renderParts(parts) {
		for (const part of parts) {
			if (!part || typeof part !== 'object') {
				continue;
			}

			switch (part.type) {
				case 'header':
					renderHeader(part);
					break;
				case 'emptyState':
					renderEmptyState(part);
					break;
				case 'section':
					renderSection(part);
					break;
				case 'warning':
					renderWarning(part);
					break;
				case 'commandButton':
					renderCommandButton(part);
					break;
				case 'divider':
					break; // Visual spacing handled via CSS
				case 'loadMore':
					renderLoadMore(part);
					break;
				case 'progress':
					renderProgress(part);
					break;
			}
		}
	}

	function applyPatch(patch, parts) {
		if (!patch) {
			renderParts(parts);
			return;
		}

		switch (patch.type) {
			case 'sectionRemoved':
				removeSection(patch.sectionId);
				break;
			case 'sectionsReordered':
				reorderSections(patch.order);
				break;
		}

		renderParts(parts);
	}

	function renderHeader(part) {
		refs.title.textContent = part.title ?? 'Prompt Section Visualizer';
		const summaryParts = [`Total tokens: ${Number(part.totalTokens ?? 0).toLocaleString()}`];
		if (part.tokenBreakdown) {
			summaryParts.push(
				`Content: ${Number(part.tokenBreakdown.content).toLocaleString()}`,
				`Tags: ${Number(part.tokenBreakdown.tags).toLocaleString()}`
			);
			if (typeof part.tokenBreakdown.overhead === 'number') {
				summaryParts.push(`Overhead: ${Number(part.tokenBreakdown.overhead).toLocaleString()}`);
			}
		}
		refs.tokenSummary.textContent = summaryParts.join(' • ');
	}

	function renderEmptyState(part) {
		clearSections();
		refs.empty.innerHTML = `${escapeHtml(part.title)}<br/>${escapeHtml(part.message)}`;
		refs.empty.classList.remove('hidden');
	}

	function renderSection(part) {
		refs.empty.classList.add('hidden');
		const element = ensureSectionElement(part.id);
		const refSet = element.__refs;

		element.dataset.index = String(part.index ?? 0);
		element.classList.toggle('collapsed', Boolean(part.isCollapsed));

		refSet.title.textContent = `<${part.tagName}>`;
		let meta = `${Number(part.tokenCount ?? 0).toLocaleString()} tokens`;
		if (part.tokenBreakdown) {
			meta += ` · content ${part.tokenBreakdown.content}, tags ${part.tokenBreakdown.tags}`;
		}
		refSet.meta.textContent = meta;

		const badge = refSet.badge;
		badge.textContent = '';
		badge.classList.remove('warning', 'critical');
		if (part.warningLevel && part.warningLevel !== 'normal') {
			badge.textContent = part.warningLevel === 'critical' ? 'Critical' : 'Warning';
			badge.classList.add(part.warningLevel);
		}

		refSet.actions.innerHTML = '';
		sectionActionAreas.set(part.id, refSet.actions);

		refSet.warning.textContent = '';
		sectionWarningAreas.set(part.id, refSet.warning);

		if (part.hasRenderableElements && part.renderedContent?.htmlRepresentation) {
			refSet.content.innerHTML = part.renderedContent.htmlRepresentation;
		} else {
			refSet.content.textContent = part.contentText ?? part.content ?? '';
		}

		placeSectionElement(element, Number(part.index ?? 0));
	}

	function renderWarning(part) {
		const warningArea = sectionWarningAreas.get(part.sectionId ?? '');
		if (!warningArea) {
			return;
		}
		warningArea.textContent = part.message ?? '';
	}

	function renderCommandButton(part) {
		const button = document.createElement('button');
		button.className = 'pv-command';
		button.textContent = part.title ?? 'Action';
		button.addEventListener('click', () => sendCommand(part.command, part.arguments));

		if (part.target === 'section' && part.sectionId) {
			const actions = sectionActionAreas.get(part.sectionId);
			if (actions) {
				actions.appendChild(button);
			}
			return;
		}

		refs.globalActions.appendChild(button);
	}

	function renderLoadMore(part) {
		refs.loadMore.innerHTML = '';
		const button = document.createElement('button');
		button.textContent = part.buttonTitle ?? 'Load more';
		button.addEventListener('click', () => sendCommand(part.command));
		refs.loadMore.appendChild(button);
	}

	function renderProgress(part) {
		refs.progress.textContent = part.message ?? '';
	}

	function removeSection(sectionId) {
		const element = sectionNodes.get(sectionId);
		if (!element) {
			return;
		}
		sectionNodes.delete(sectionId);
		sectionActionAreas.delete(sectionId);
		sectionWarningAreas.delete(sectionId);
		element.remove();
	}

	function reorderSections(order) {
		if (!Array.isArray(order) || order.length === 0) {
			return;
		}

		const handled = new Set(order);
		const fragment = document.createDocumentFragment();
		for (const sectionId of order) {
			const node = sectionNodes.get(sectionId);
			if (node) {
				fragment.appendChild(node);
			}
		}

		refs.sections.appendChild(fragment);

		for (const [sectionId, node] of sectionNodes.entries()) {
			if (!handled.has(sectionId)) {
				refs.sections.appendChild(node);
			}
		}
	}

	function ensureSectionElement(sectionId) {
		let element = sectionNodes.get(sectionId);
		if (element) {
			return element;
		}

		element = document.createElement('article');
		element.className = 'pv-section';
		element.dataset.sectionId = sectionId;

		const header = document.createElement('div');
		header.className = 'pv-section__header';

		const caret = document.createElement('button');
		caret.className = 'pv-section__caret';
		caret.setAttribute('aria-label', 'Toggle section');
		caret.addEventListener('click', () => sendCommand('github.copilot.promptSectionVisualizer.toggleCollapse', [sectionId]));

		const headerText = document.createElement('div');
		const title = document.createElement('div');
		title.className = 'pv-section__title';
		const meta = document.createElement('div');
		meta.className = 'pv-section__meta';
		headerText.appendChild(title);
		headerText.appendChild(meta);

		const badge = document.createElement('span');
		badge.className = 'pv-section__badge';

		header.appendChild(caret);
		header.appendChild(headerText);
		header.appendChild(badge);

		const warning = document.createElement('div');
		warning.className = 'pv-section__warning';

		const content = document.createElement('div');
		content.className = 'pv-section__content';

		const actions = document.createElement('div');
		actions.className = 'pv-section__actions';

		element.appendChild(header);
		element.appendChild(warning);
		element.appendChild(content);
		element.appendChild(actions);

		refs.sections.appendChild(element);
		sectionNodes.set(sectionId, element);
		sectionActionAreas.set(sectionId, actions);
		sectionWarningAreas.set(sectionId, warning);

		element.__refs = {
			title,
			meta,
			badge,
			content,
			actions,
			warning
		};

		return element;
	}

	function placeSectionElement(element, index) {
		const children = Array.from(refs.sections.children).filter(node => node.classList?.contains('pv-section'));
		const nextSibling = children.find(node => Number(node.dataset.index ?? 0) > index);
		if (nextSibling && nextSibling !== element) {
			refs.sections.insertBefore(element, nextSibling);
			return;
		}

		if (!nextSibling) {
			refs.sections.appendChild(element);
		}
	}

	function sendCommand(command, args) {
		if (!command) {
			return;
		}

		vscode.postMessage({
			type: 'command',
			command,
			args: Array.isArray(args) ? args : args ? [args] : []
		});
	}

	function showError(message) {
		refs.empty.textContent = message;
		refs.empty.classList.remove('hidden');
	}

	function escapeHtml(value) {
		return String(value ?? '').replace(/[&<>"']/g, char => {
			switch (char) {
				case '&': return '&amp;';
				case '<': return '&lt;';
				case '>': return '&gt;';
				case '"': return '&quot;';
				case "'": return '&#39;';
				default: return char;
			}
		});
	}
}());
