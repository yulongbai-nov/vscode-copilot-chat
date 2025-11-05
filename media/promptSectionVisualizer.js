/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Prompt Section Visualizer WebView Script
(function () {
	const vscode = acquireVsCodeApi();
	let currentState = null;
	const editorStates = new Map(); // Store cursor positions and scroll states
	let draggedSectionId = null; // Track the section being dragged
	let dragOverSectionId = null; // Track the section being dragged over
	let renderTimeout = null; // Debounce render calls
	let isRendering = false; // Prevent concurrent renders
	let pendingRender = false; // Track if render is needed after current one completes
	const virtualScrollContainer = null; // Virtual scroll container reference
	const visibleSectionIds = new Set(); // Track visible sections for lazy loading
	const undoStack = new Map(); // Undo history per section
	const redoStack = new Map(); // Redo history per section
	const MAX_UNDO_STACK = 50; // Maximum undo history

	// Initialize the WebView
	function init() {
		// Send ready message to extension
		vscode.postMessage({ type: 'ready' });

		// Set up event listeners
		setupEventListeners();
	}

	function setupEventListeners() {
		document.addEventListener('click', handleClick);
		document.addEventListener('input', handleInput);
		document.addEventListener('dragstart', handleDragStart);
		document.addEventListener('dragover', handleDragOver);
		document.addEventListener('drop', handleDrop);
		document.addEventListener('dragend', handleDragEnd);
		document.addEventListener('keydown', handleKeyDown);
		document.addEventListener('focusin', handleFocusIn);
	}

	function handleKeyDown(event) {
		const dialog = document.getElementById('add-section-dialog');
		if (dialog && dialog.style.display !== 'none') {
			if (event.key === 'Escape') {
				hideAddSectionDialog();
				event.preventDefault();
			} else if (event.key === 'Enter' && event.ctrlKey) {
				handleAddSection();
				event.preventDefault();
			}
			return;
		}

		// Keyboard navigation for sections
		const target = event.target;
		const section = target.closest('.section');

		if (section) {
			const sectionId = section.dataset.sectionId;

			// Toggle collapse with Space or Enter on header
			if ((event.key === ' ' || event.key === 'Enter') && target.classList.contains('section-header')) {
				event.preventDefault();
				vscode.postMessage({
					type: 'toggleCollapse',
					sectionId: sectionId
				});
			}

			// Navigate between sections with arrow keys
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				const sections = Array.from(document.querySelectorAll('.section'));
				const currentIndex = sections.indexOf(section);

				if (event.key === 'ArrowDown' && currentIndex < sections.length - 1) {
					event.preventDefault();
					const nextSection = sections[currentIndex + 1];
					const nextHeader = nextSection.querySelector('.section-header');
					if (nextHeader) {
						nextHeader.focus();
						nextHeader.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
					}
				} else if (event.key === 'ArrowUp' && currentIndex > 0) {
					event.preventDefault();
					const prevSection = sections[currentIndex - 1];
					const prevHeader = prevSection.querySelector('.section-header');
					if (prevHeader) {
						prevHeader.focus();
						prevHeader.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
					}
				}
			}

			// Quick actions with keyboard shortcuts
			if (event.key === 'e' && !event.ctrlKey && !event.metaKey && !target.classList.contains('section-editor')) {
				// Edit section (e key)
				event.preventDefault();
				const editBtn = section.querySelector('.btn-edit');
				if (editBtn) {
					editBtn.click();
				}
			}

			if (event.key === 'Delete' && !target.classList.contains('section-editor')) {
				// Delete section (Delete key)
				event.preventDefault();
				const deleteBtn = section.querySelector('.btn-delete');
				if (deleteBtn) {
					deleteBtn.click();
				}
			}
		}

		// Global keyboard shortcuts
		if (event.key === 'n' && (event.ctrlKey || event.metaKey)) {
			// Add new section (Ctrl/Cmd + N)
			event.preventDefault();
			showAddSectionDialog();
		}

		// Save with Ctrl/Cmd + S in editor
		if (event.key === 's' && (event.ctrlKey || event.metaKey) && target.classList.contains('section-editor')) {
			event.preventDefault();
			const sectionId = target.dataset.sectionId;
			const saveBtn = document.querySelector(`.btn-save[data-section-id="${sectionId}"]`);
			if (saveBtn) {
				saveBtn.click();
			}
		}

		// Cancel with Escape in editor
		if (event.key === 'Escape' && target.classList.contains('section-editor')) {
			event.preventDefault();
			const sectionId = target.dataset.sectionId;
			const cancelBtn = document.querySelector(`.btn-cancel[data-section-id="${sectionId}"]`);
			if (cancelBtn) {
				cancelBtn.click();
			}
		}

		// Undo with Ctrl/Cmd + Z in editor
		if (event.key === 'z' && (event.ctrlKey || event.metaKey) && !event.shiftKey && target.classList.contains('section-editor')) {
			event.preventDefault();
			const sectionId = target.dataset.sectionId;
			performUndo(sectionId, target);
		}

		// Redo with Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y in editor
		if (((event.key === 'z' && event.shiftKey) || event.key === 'y') && (event.ctrlKey || event.metaKey) && target.classList.contains('section-editor')) {
			event.preventDefault();
			const sectionId = target.dataset.sectionId;
			performRedo(sectionId, target);
		}

		// Tab handling in editor
		if (event.key === 'Tab' && target.classList.contains('section-editor')) {
			event.preventDefault();
			const start = target.selectionStart;
			const end = target.selectionEnd;
			const value = target.value;

			// Insert tab character
			target.value = value.substring(0, start) + '\t' + value.substring(end);
			target.selectionStart = target.selectionEnd = start + 1;

			// Trigger input event for undo stack
			target.dispatchEvent(new Event('input', { bubbles: true }));
		}

		// Smart indentation with Enter in editor
		if (event.key === 'Enter' && target.classList.contains('section-editor') && !event.ctrlKey && !event.metaKey) {
			const start = target.selectionStart;
			const value = target.value;

			// Find the indentation of the current line
			const lineStart = value.lastIndexOf('\n', start - 1) + 1;
			const lineEnd = value.indexOf('\n', start);
			const currentLine = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);
			const indent = currentLine.match(/^\s*/)[0];

			// Insert newline with same indentation
			event.preventDefault();
			const newValue = value.substring(0, start) + '\n' + indent + value.substring(target.selectionEnd);
			target.value = newValue;
			target.selectionStart = target.selectionEnd = start + 1 + indent.length;

			// Trigger input event for undo stack
			target.dispatchEvent(new Event('input', { bubbles: true }));
		}
	}

	/**
	 * Handle focus events for accessibility
	 */
	function handleFocusIn(event) {
		const target = event.target;

		// Announce section information to screen readers when focused
		if (target.classList.contains('section-header')) {
			const sectionId = target.dataset.sectionId;
			const section = currentState?.sections.find(s => s.id === sectionId);
			if (section) {
				// Update aria-label with current state
				const isCollapsed = section.isCollapsed ? 'collapsed' : 'expanded';
				const warningLevel = section.warningLevel || 'normal';
				const warningText = warningLevel === 'critical' ? ', critical token usage' :
					warningLevel === 'warning' ? ', high token usage' : '';

				target.setAttribute('aria-label',
					`Section ${section.tagName}, ${section.tokenCount} tokens${warningText}, ${isCollapsed}. Press Space or Enter to toggle, Arrow keys to navigate, E to edit, Delete to remove.`
				);
			}
		}
	}

	function handleClick(event) {
		const target = event.target;

		if (target.classList.contains('section-header')) {
			const sectionId = target.dataset.sectionId;
			if (sectionId) {
				vscode.postMessage({
					type: 'toggleCollapse',
					sectionId: sectionId
				});
			}
		}

		if (target.classList.contains('btn-edit')) {
			const sectionId = target.dataset.sectionId;
			if (sectionId) {
				// Save current view state before switching to edit mode
				saveEditorState(sectionId);

				vscode.postMessage({
					type: 'switchMode',
					sectionId: sectionId,
					mode: 'edit'
				});
			}
		}

		if (target.classList.contains('btn-save')) {
			const sectionId = target.dataset.sectionId;
			const textarea = document.querySelector(`textarea[data-section-id="${sectionId}"]`);
			if (sectionId && textarea) {
				// Save cursor position before switching modes
				saveEditorState(sectionId, textarea);

				vscode.postMessage({
					type: 'updateSection',
					sectionId: sectionId,
					content: textarea.value
				});
				vscode.postMessage({
					type: 'switchMode',
					sectionId: sectionId,
					mode: 'view'
				});
			}
		}

		if (target.classList.contains('btn-cancel')) {
			const sectionId = target.dataset.sectionId;
			if (sectionId) {
				// Clear editor state on cancel
				editorStates.delete(sectionId);
				clearUndoRedo(sectionId);

				vscode.postMessage({
					type: 'switchMode',
					sectionId: sectionId,
					mode: 'view'
				});
			}
		}

		if (target.classList.contains('btn-delete')) {
			const sectionId = target.dataset.sectionId;
			const sectionName = target.dataset.sectionName;
			if (sectionId) {
				// Show confirmation dialog
				if (confirm(`Are you sure you want to delete the section "${sectionName}"?`)) {
					vscode.postMessage({
						type: 'removeSection',
						sectionId: sectionId
					});
				}
			}
		}

		if (target.classList.contains('btn-add-section')) {
			showAddSectionDialog();
		}

		if (target.classList.contains('add-section-submit')) {
			handleAddSection();
		}

		if (target.classList.contains('add-section-cancel')) {
			hideAddSectionDialog();
		}
	}

	function handleInput(event) {
		const target = event.target;

		// Auto-resize textarea as content changes
		if (target.tagName === 'TEXTAREA') {
			autoResizeTextarea(target);

			// Save cursor position on input
			const sectionId = target.dataset.sectionId;
			if (sectionId) {
				saveEditorState(sectionId, target);

				// Add to undo stack on significant changes
				if (!target.dataset.lastValue || target.value !== target.dataset.lastValue) {
					addToUndoStack(sectionId, target.dataset.lastValue || '', target.value);
					target.dataset.lastValue = target.value;
				}
			}
		}
	}

	/**
	 * Save editor state including cursor position and scroll position
	 */
	function saveEditorState(sectionId, textarea) {
		if (textarea) {
			editorStates.set(sectionId, {
				cursorPosition: textarea.selectionStart,
				scrollTop: textarea.scrollTop,
				scrollLeft: textarea.scrollLeft
			});
		}
	}

	/**
	 * Restore editor state including cursor position and scroll position
	 */
	function restoreEditorState(sectionId, textarea) {
		const state = editorStates.get(sectionId);
		if (state && textarea) {
			// Restore cursor position
			textarea.setSelectionRange(state.cursorPosition, state.cursorPosition);

			// Restore scroll position
			textarea.scrollTop = state.scrollTop;
			textarea.scrollLeft = state.scrollLeft;

			// Focus the textarea
			textarea.focus();
		}
	}

	/**
	 * Auto-resize textarea to fit content
	 */
	function autoResizeTextarea(textarea) {
		// Reset height to auto to get the correct scrollHeight
		textarea.style.height = 'auto';

		// Set height to scrollHeight plus some padding
		const newHeight = Math.max(100, textarea.scrollHeight + 2);
		textarea.style.height = newHeight + 'px';
	}

	// Handle messages from the extension
	window.addEventListener('message', event => {
		const message = event.data;

		switch (message.type) {
			case 'updateState':
				currentState = message.state;
				debouncedRender();
				break;
		}
	});

	/**
	 * Debounced render to prevent excessive re-renders
	 */
	function debouncedRender() {
		if (renderTimeout) {
			clearTimeout(renderTimeout);
		}

		renderTimeout = setTimeout(() => {
			render();
		}, 16); // ~60fps
	}

	function render() {
		if (!currentState) {
			return;
		}

		// Prevent concurrent renders
		if (isRendering) {
			pendingRender = true;
			return;
		}

		isRendering = true;

		const root = document.getElementById('root');
		if (!root) {
			isRendering = false;
			return;
		}

		// Use requestAnimationFrame for smoother rendering
		requestAnimationFrame(() => {
			renderContent(root);
			isRendering = false;

			// If another render was requested, execute it
			if (pendingRender) {
				pendingRender = false;
				render();
			}
		});
	}

	function renderContent(root) {
		let html = '';

		// Skip to content link for accessibility
		html += `<a href="#main-content" class="skip-to-content">Skip to sections</a>`;

		// Total tokens header with breakdown
		html += `
            <div class="total-tokens" role="status" aria-live="polite">
                <div class="total-tokens-main">
                    <span class="total-tokens-label">Total Tokens:</span>
                    <span class="total-tokens-value">${currentState.totalTokens}</span>
                </div>
        `;

		// Add breakdown if available
		if (currentState.tokenBreakdown) {
			html += `
                <div class="token-breakdown">
                    <span class="breakdown-item">
                        <span class="breakdown-label">Content:</span>
                        <span class="breakdown-value">${currentState.tokenBreakdown.content}</span>
                    </span>
                    <span class="breakdown-separator">|</span>
                    <span class="breakdown-item">
                        <span class="breakdown-label">Tags:</span>
                        <span class="breakdown-value">${currentState.tokenBreakdown.tags}</span>
                    </span>
                    <span class="breakdown-separator">|</span>
                    <span class="breakdown-item">
                        <span class="breakdown-label">Overhead:</span>
                        <span class="breakdown-value">${currentState.tokenBreakdown.overhead}</span>
                    </span>
                </div>
            `;
		}

		html += `</div>`;

		// Render sections with virtual scrolling for large lists
		const shouldUseVirtualScroll = currentState.sections.length > 50;

		if (shouldUseVirtualScroll) {
			html += '<div class="prompt-section-visualizer virtual-scroll" id="virtual-scroll-container" role="main" id="main-content">';
			html += renderVirtualSections();
		} else {
			html += '<div class="prompt-section-visualizer" role="main" id="main-content">';
			for (const section of currentState.sections) {
				html += renderSection(section);
			}
		}

		// Add section button
		html += `
            <div class="add-section-container">
                <button class="btn btn-add-section"
                        aria-label="Add new section. Keyboard shortcut: Ctrl+N">
                    <span class="btn-icon" aria-hidden="true">➕</span> Add Section
                </button>
            </div>
        `;

		html += '</div>';

		// Add section dialog
		html += `
            <div id="add-section-dialog"
                 class="dialog-overlay"
                 style="display: none;"
                 role="dialog"
                 aria-labelledby="dialog-title"
                 aria-modal="true">
                <div class="dialog-content">
                    <div class="dialog-header">
                        <h3 id="dialog-title">Add New Section</h3>
                    </div>
                    <div class="dialog-body">
                        <div class="form-group">
                            <label for="add-section-tag-name">Tag Name:</label>
                            <input
                                type="text"
                                id="add-section-tag-name"
                                class="form-input"
                                placeholder="e.g., context, instructions, examples"
                                autocomplete="off"
                                aria-required="true"
                                aria-describedby="tag-name-hint"
                            />
                            <span id="tag-name-hint" class="form-hint">Must start with a letter and contain only letters, numbers, and hyphens</span>
                        </div>
                        <div class="form-group">
                            <label for="add-section-content">Content (optional):</label>
                            <textarea
                                id="add-section-content"
                                class="form-textarea"
                                placeholder="Enter section content..."
                                rows="5"
                                aria-label="Section content (optional)"
                            ></textarea>
                        </div>
                    </div>
                    <div class="dialog-footer" role="group" aria-label="Dialog actions">
                        <button class="btn add-section-submit" aria-label="Add section. Keyboard shortcut: Ctrl+Enter">
                            <span class="btn-icon" aria-hidden="true">✓</span> Add Section
                        </button>
                        <button class="btn btn-secondary add-section-cancel" aria-label="Cancel. Keyboard shortcut: Escape">
                            <span class="btn-icon" aria-hidden="true">✕</span> Cancel
                        </button>
                    </div>
                </div>
            </div>
        `;

		root.innerHTML = html;

		// Restore editor states after render
		restoreAllEditorStates();

		// Set up editor enhancements
		setupEditorEnhancements();
	}

	/**
	 * Restore all editor states after re-render
	 */
	function restoreAllEditorStates() {
		editorStates.forEach((_state, sectionId) => {
			const textarea = document.querySelector(`textarea[data-section-id="${sectionId}"]`);
			if (textarea) {
				restoreEditorState(sectionId, textarea);
				autoResizeTextarea(textarea);
			}
		});
	}

	function renderSection(section) {
		const isCollapsed = section.isCollapsed;
		const isEditing = section.isEditing;
		const warningLevel = section.warningLevel || 'normal';
		const warningText = warningLevel === 'critical' ? ', critical token usage' :
			warningLevel === 'warning' ? ', high token usage' : '';

		let html = `
            <div class="section section-${warningLevel}"
                 data-section-id="${section.id}"
                 draggable="false"
                 role="region"
                 aria-labelledby="section-header-${section.id}">
                <div class="section-header"
                     id="section-header-${section.id}"
                     data-section-id="${section.id}"
                     role="button"
                     tabindex="0"
                     aria-expanded="${!isCollapsed}"
                     aria-label="Section ${escapeHtml(section.tagName)}, ${section.tokenCount} tokens${warningText}, ${isCollapsed ? 'collapsed' : 'expanded'}. Press Space or Enter to toggle, Arrow keys to navigate, E to edit, Delete to remove.">
                    <div class="section-header-left">
                        <span class="drag-handle"
                              draggable="true"
                              role="button"
                              tabindex="0"
                              aria-label="Drag handle for ${escapeHtml(section.tagName)} section. Press Space to grab, Arrow keys to move, Space to drop."
                              title="Drag to reorder">⋮⋮</span>
                        <span class="collapse-indicator" aria-hidden="true">${isCollapsed ? '▶' : '▼'}</span>
                        <span class="section-title">&lt;${escapeHtml(section.tagName)}&gt;</span>
                    </div>
                    <div class="section-token-info">
                        <span class="section-token-count token-${warningLevel}"
                              role="status"
                              aria-label="${section.tokenCount} tokens">${section.tokenCount} tokens</span>
        `;

		// Add breakdown if available
		if (section.tokenBreakdown) {
			html += `
                        <span class="section-token-breakdown">
                            (${section.tokenBreakdown.content} content + ${section.tokenBreakdown.tags} tags)
                        </span>
            `;
		}

		// Add warning indicator for high usage
		if (warningLevel === 'warning') {
			html += `<span class="warning-indicator"
                          role="img"
                          aria-label="Warning: High token usage"
                          title="High token usage">⚠️</span>`;
		} else if (warningLevel === 'critical') {
			html += `<span class="warning-indicator critical"
                          role="img"
                          aria-label="Critical: Very high token usage"
                          title="Critical token usage">🔴</span>`;
		}

		html += `
                    </div>
                </div>
        `;

		if (!isCollapsed) {
			html += `<div class="section-content ${isEditing ? 'editing-mode' : 'view-mode'}"
                          role="group"
                          aria-label="Section content for ${escapeHtml(section.tagName)}">`;

			if (isEditing) {
				const hasUndo = undoStack.has(section.id) && undoStack.get(section.id).length > 0;
				const hasRedo = redoStack.has(section.id) && redoStack.get(section.id).length > 0;

				html += `
                    <div class="editor-container">
                        <div class="editor-toolbar" role="toolbar" aria-label="Editor toolbar">
                            <div class="editor-toolbar-left">
                                <span class="editor-mode-label">Advanced Editor</span>
                                <span class="editor-hint">Syntax highlighting • Auto-indent • Undo/Redo</span>
                            </div>
                            <div class="editor-toolbar-right">
                                <button class="btn-icon-only ${!hasUndo ? 'disabled' : ''}"
                                        onclick="performUndoFromButton('${section.id}')"
                                        title="Undo (Ctrl+Z)"
                                        ${!hasUndo ? 'disabled' : ''}
                                        aria-label="Undo last change">
                                    ↶
                                </button>
                                <button class="btn-icon-only ${!hasRedo ? 'disabled' : ''}"
                                        onclick="performRedoFromButton('${section.id}')"
                                        title="Redo (Ctrl+Shift+Z)"
                                        ${!hasRedo ? 'disabled' : ''}
                                        aria-label="Redo last undone change">
                                    ↷
                                </button>
                            </div>
                        </div>
                        <div class="editor-wrapper">
                            <textarea
                                class="section-editor advanced-editor"
                                data-section-id="${section.id}"
                                data-last-value="${escapeHtml(section.content)}"
                                spellcheck="false"
                                wrap="soft"
                                aria-label="Edit content for ${escapeHtml(section.tagName)} section. Press Ctrl+S to save, Escape to cancel, Ctrl+Z to undo, Ctrl+Shift+Z to redo."
                                aria-multiline="true"
                            >${escapeHtml(section.content)}</textarea>
                        </div>
                        <div class="editor-status-bar">
                            <span class="editor-status-item">Lines: <span id="line-count-${section.id}">1</span></span>
                            <span class="editor-status-item">Characters: <span id="char-count-${section.id}">${section.content.length}</span></span>
                            <span class="editor-status-item">Ln <span id="line-pos-${section.id}">1</span>, Col <span id="col-pos-${section.id}">1</span></span>
                        </div>
                        <div class="section-actions" role="group" aria-label="Editor actions">
                            <button class="btn btn-save"
                                    data-section-id="${section.id}"
                                    aria-label="Save changes to ${escapeHtml(section.tagName)} section">
                                <span class="btn-icon" aria-hidden="true">💾</span> Save
                            </button>
                            <button class="btn btn-secondary btn-cancel"
                                    data-section-id="${section.id}"
                                    aria-label="Cancel editing ${escapeHtml(section.tagName)} section">
                                <span class="btn-icon" aria-hidden="true">❌</span> Cancel
                            </button>
                        </div>
                    </div>
                `;
			} else {
				// Render content with syntax highlighting hints
				const contentHtml = section.hasRenderableElements && section.renderedContent
					? section.renderedContent.htmlRepresentation
					: renderPlainContent(section.content);

				html += `
                    <div class="content-container">
                        <div class="section-rendered-content"
                             role="article"
                             aria-label="Content of ${escapeHtml(section.tagName)} section">
                            ${contentHtml}
                        </div>
                        <div class="section-actions" role="group" aria-label="Section actions">
                            <button class="btn btn-edit"
                                    data-section-id="${section.id}"
                                    aria-label="Edit ${escapeHtml(section.tagName)} section">
                                <span class="btn-icon" aria-hidden="true">✏️</span> Edit
                            </button>
                            <button class="btn btn-secondary btn-delete"
                                    data-section-id="${section.id}"
                                    data-section-name="${escapeHtml(section.tagName)}"
                                    aria-label="Delete ${escapeHtml(section.tagName)} section">
                                <span class="btn-icon" aria-hidden="true">🗑️</span> Delete
                            </button>
                        </div>
                    </div>
                `;
			}

			html += `</div>`;
		}

		html += `</div>`;

		return html;
	}

	/**
	 * Virtual scrolling for large section lists
	 */
	function renderVirtualSections() {
		// For now, render all sections but mark for lazy loading
		// In a full implementation, this would only render visible sections
		let html = '';
		const BATCH_SIZE = 20;
		const initialBatch = currentState.sections.slice(0, BATCH_SIZE);

		for (const section of initialBatch) {
			html += renderSection(section);
			visibleSectionIds.add(section.id);
		}

		// Add placeholder for remaining sections
		if (currentState.sections.length > BATCH_SIZE) {
			html += `
				<div class="lazy-load-trigger" data-remaining="${currentState.sections.length - BATCH_SIZE}">
					<button class="btn btn-load-more" onclick="loadMoreSections()">
						Load ${Math.min(BATCH_SIZE, currentState.sections.length - BATCH_SIZE)} more sections...
					</button>
				</div>
			`;
		}

		return html;
	}

	/**
	 * Load more sections for virtual scrolling
	 */
	window.loadMoreSections = function () {
		const currentVisible = visibleSectionIds.size;
		const BATCH_SIZE = 20;
		const nextBatch = currentState.sections.slice(currentVisible, currentVisible + BATCH_SIZE);

		const container = document.querySelector('.prompt-section-visualizer');
		const trigger = document.querySelector('.lazy-load-trigger');

		if (container && trigger) {
			// Render next batch
			let html = '';
			for (const section of nextBatch) {
				html += renderSection(section);
				visibleSectionIds.add(section.id);
			}

			// Insert before trigger
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = html;
			while (tempDiv.firstChild) {
				container.insertBefore(tempDiv.firstChild, trigger);
			}

			// Update or remove trigger
			const remaining = currentState.sections.length - visibleSectionIds.size;
			if (remaining > 0) {
				const button = trigger.querySelector('.btn-load-more');
				if (button) {
					button.textContent = `Load ${Math.min(BATCH_SIZE, remaining)} more sections...`;
				}
				trigger.dataset.remaining = remaining;
			} else {
				trigger.remove();
			}

			// Restore editor states for newly rendered sections
			restoreAllEditorStates();
		}
	};

	/**
	 * Lazy load section content when it becomes visible
	 */
	function setupLazyLoading() {
		if ('IntersectionObserver' in window) {
			const observer = new IntersectionObserver((entries) => {
				entries.forEach(entry => {
					if (entry.isIntersecting) {
						const section = entry.target;
						const sectionId = section.dataset.sectionId;
						if (sectionId && !visibleSectionIds.has(sectionId)) {
							visibleSectionIds.add(sectionId);
							// Section is now visible, content already rendered
						}
					}
				});
			}, {
				rootMargin: '50px' // Load slightly before visible
			});

			// Observe all sections
			document.querySelectorAll('.section').forEach(section => {
				observer.observe(section);
			});
		}
	}

	/**
	 * Add change to undo stack
	 */
	function addToUndoStack(sectionId, oldValue, newValue) {
		if (!undoStack.has(sectionId)) {
			undoStack.set(sectionId, []);
		}

		const stack = undoStack.get(sectionId);

		// Don't add if value hasn't changed
		if (stack.length > 0 && stack[stack.length - 1].newValue === newValue) {
			return;
		}

		stack.push({ oldValue, newValue, timestamp: Date.now() });

		// Limit stack size
		if (stack.length > MAX_UNDO_STACK) {
			stack.shift();
		}

		// Clear redo stack on new change
		redoStack.set(sectionId, []);
	}

	/**
	 * Perform undo operation
	 */
	function performUndo(sectionId, textarea) {
		if (!undoStack.has(sectionId) || undoStack.get(sectionId).length === 0) {
			return;
		}

		const stack = undoStack.get(sectionId);
		const change = stack.pop();

		if (change) {
			// Add to redo stack
			if (!redoStack.has(sectionId)) {
				redoStack.set(sectionId, []);
			}
			redoStack.get(sectionId).push(change);

			// Restore old value
			const cursorPos = textarea.selectionStart;
			textarea.value = change.oldValue;
			textarea.dataset.lastValue = change.oldValue;

			// Try to maintain cursor position
			const newPos = Math.min(cursorPos, change.oldValue.length);
			textarea.setSelectionRange(newPos, newPos);

			// Update UI
			autoResizeTextarea(textarea);
			saveEditorState(sectionId, textarea);
		}
	}

	/**
	 * Perform redo operation
	 */
	function performRedo(sectionId, textarea) {
		if (!redoStack.has(sectionId) || redoStack.get(sectionId).length === 0) {
			return;
		}

		const stack = redoStack.get(sectionId);
		const change = stack.pop();

		if (change) {
			// Add back to undo stack
			if (!undoStack.has(sectionId)) {
				undoStack.set(sectionId, []);
			}
			undoStack.get(sectionId).push(change);

			// Restore new value
			const cursorPos = textarea.selectionStart;
			textarea.value = change.newValue;
			textarea.dataset.lastValue = change.newValue;

			// Try to maintain cursor position
			const newPos = Math.min(cursorPos, change.newValue.length);
			textarea.setSelectionRange(newPos, newPos);

			// Update UI
			autoResizeTextarea(textarea);
			saveEditorState(sectionId, textarea);
		}
	}

	/**
	 * Clear undo/redo stacks for a section
	 */
	function clearUndoRedo(sectionId) {
		undoStack.delete(sectionId);
		redoStack.delete(sectionId);
	}

	/**
	 * Optimize memory usage by cleaning up collapsed sections
	 */
	function optimizeMemory() {
		// Remove rendered content from collapsed sections to save memory
		document.querySelectorAll('.section').forEach(sectionEl => {
			const content = sectionEl.querySelector('.section-content');
			if (content && content.classList.contains('collapsed')) {
				// Keep the structure but clear heavy content
				const renderedContent = content.querySelector('.section-rendered-content');
				if (renderedContent && renderedContent.children.length > 10) {
					// Store original content in data attribute for restoration
					if (!renderedContent.dataset.originalContent) {
						renderedContent.dataset.originalContent = renderedContent.innerHTML;
					}
					// Clear content to save memory
					renderedContent.innerHTML = '<div class="memory-optimized">Content collapsed to save memory</div>';
				}
			}
		});
	}

	/**
	 * Render plain content with enhanced syntax highlighting
	 */
	function renderPlainContent(content) {
		// Detect code blocks and apply enhanced highlighting
		const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
		let lastIndex = 0;
		let result = '';

		let match;
		while ((match = codeBlockRegex.exec(content)) !== null) {
			// Add text before code block
			if (match.index > lastIndex) {
				result += `<pre class="plain-text">${escapeHtml(content.substring(lastIndex, match.index))}</pre>`;
			}

			// Add code block with language hint and enhanced styling
			const language = match[1] || 'text';
			const code = match[2];
			const languageLabel = getLanguageLabel(language);

			result += `
                <div class="code-block-container" data-language="${escapeHtml(language)}">
                    <div class="code-block-header">
                        <span class="code-block-language">${escapeHtml(languageLabel)}</span>
                    </div>
                    <pre><code class="language-${escapeHtml(language)}">${escapeHtml(code)}</code></pre>
                </div>
            `;

			lastIndex = codeBlockRegex.lastIndex;
		}

		// Add remaining text
		if (lastIndex < content.length) {
			result += `<pre class="plain-text">${escapeHtml(content.substring(lastIndex))}</pre>`;
		}

		return result || `<pre class="plain-text">${escapeHtml(content)}</pre>`;
	}

	/**
	 * Get a friendly label for a language identifier
	 */
	function getLanguageLabel(language) {
		const languageLabels = {
			'ts': 'TypeScript',
			'typescript': 'TypeScript',
			'js': 'JavaScript',
			'javascript': 'JavaScript',
			'py': 'Python',
			'python': 'Python',
			'java': 'Java',
			'cpp': 'C++',
			'c': 'C',
			'cs': 'C#',
			'csharp': 'C#',
			'go': 'Go',
			'rust': 'Rust',
			'rb': 'Ruby',
			'ruby': 'Ruby',
			'php': 'PHP',
			'swift': 'Swift',
			'kotlin': 'Kotlin',
			'sql': 'SQL',
			'html': 'HTML',
			'css': 'CSS',
			'json': 'JSON',
			'xml': 'XML',
			'yaml': 'YAML',
			'yml': 'YAML',
			'md': 'Markdown',
			'markdown': 'Markdown',
			'sh': 'Shell',
			'bash': 'Bash',
			'powershell': 'PowerShell',
			'text': 'Plain Text'
		};

		return languageLabels[language.toLowerCase()] || language.toUpperCase();
	}

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	/**
	 * Drag and drop handlers for section reordering
	 */
	function handleDragStart(event) {
		const section = event.target.closest('.section');
		if (section && event.target.classList.contains('drag-handle')) {
			draggedSectionId = section.dataset.sectionId;
			section.classList.add('dragging');
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/html', section.innerHTML);
		}
	}

	function handleDragOver(event) {
		event.preventDefault();
		const section = event.target.closest('.section');
		if (section && section.dataset.sectionId !== draggedSectionId) {
			event.dataTransfer.dropEffect = 'move';

			// Remove previous drag-over indicators
			document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

			// Add drag-over indicator
			section.classList.add('drag-over');
			dragOverSectionId = section.dataset.sectionId;
		}
	}

	function handleDrop(event) {
		event.preventDefault();
		event.stopPropagation();

		if (draggedSectionId && dragOverSectionId && draggedSectionId !== dragOverSectionId) {
			// Calculate new order
			const newOrder = [];
			const sections = currentState.sections;
			const draggedIndex = sections.findIndex(s => s.id === draggedSectionId);
			const targetIndex = sections.findIndex(s => s.id === dragOverSectionId);

			if (draggedIndex !== -1 && targetIndex !== -1) {
				// Create new order array
				for (let i = 0; i < sections.length; i++) {
					if (i === draggedIndex) {
						continue; // Skip dragged item
					}

					if (i === targetIndex) {
						// Insert dragged item before or after target based on position
						if (draggedIndex < targetIndex) {
							newOrder.push(sections[i].id);
							newOrder.push(draggedSectionId);
						} else {
							newOrder.push(draggedSectionId);
							newOrder.push(sections[i].id);
						}
					} else {
						newOrder.push(sections[i].id);
					}
				}

				// Send reorder message
				vscode.postMessage({
					type: 'reorderSections',
					newOrder: newOrder
				});
			}
		}

		// Clean up
		document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
		dragOverSectionId = null;
	}

	function handleDragEnd(event) {
		const section = event.target.closest('.section');
		if (section) {
			section.classList.remove('dragging');
		}
		document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
		draggedSectionId = null;
		dragOverSectionId = null;
	}

	/**
	 * Perform undo from toolbar button
	 */
	window.performUndoFromButton = function (sectionId) {
		const textarea = document.querySelector(`textarea[data-section-id="${sectionId}"]`);
		if (textarea) {
			performUndo(sectionId, textarea);
			updateEditorStatus(sectionId, textarea);
			// Re-render to update button states
			debouncedRender();
		}
	};

	/**
	 * Perform redo from toolbar button
	 */
	window.performRedoFromButton = function (sectionId) {
		const textarea = document.querySelector(`textarea[data-section-id="${sectionId}"]`);
		if (textarea) {
			performRedo(sectionId, textarea);
			updateEditorStatus(sectionId, textarea);
			// Re-render to update button states
			debouncedRender();
		}
	};

	/**
	 * Update editor status bar
	 */
	function updateEditorStatus(sectionId, textarea) {
		const value = textarea.value;
		const lines = value.split('\n').length;
		const chars = value.length;
		const cursorPos = textarea.selectionStart;

		// Calculate line and column position
		const textBeforeCursor = value.substring(0, cursorPos);
		const linePos = textBeforeCursor.split('\n').length;
		const lastNewline = textBeforeCursor.lastIndexOf('\n');
		const colPos = cursorPos - lastNewline;

		// Update status bar elements
		const lineCountEl = document.getElementById(`line-count-${sectionId}`);
		const charCountEl = document.getElementById(`char-count-${sectionId}`);
		const linePosEl = document.getElementById(`line-pos-${sectionId}`);
		const colPosEl = document.getElementById(`col-pos-${sectionId}`);

		if (lineCountEl) {
			lineCountEl.textContent = lines;
		}
		if (charCountEl) {
			charCountEl.textContent = chars;
		}
		if (linePosEl) {
			linePosEl.textContent = linePos;
		}
		if (colPosEl) {
			colPosEl.textContent = colPos;
		}
	}

	/**
	 * Set up editor enhancements after render
	 */
	function setupEditorEnhancements() {
		document.querySelectorAll('.section-editor').forEach(textarea => {
			const sectionId = textarea.dataset.sectionId;

			// Update status on input and selection change
			textarea.addEventListener('input', () => {
				updateEditorStatus(sectionId, textarea);
			});

			textarea.addEventListener('selectionchange', () => {
				updateEditorStatus(sectionId, textarea);
			});

			textarea.addEventListener('click', () => {
				updateEditorStatus(sectionId, textarea);
			});

			textarea.addEventListener('keyup', () => {
				updateEditorStatus(sectionId, textarea);
			});

			// Initialize status
			updateEditorStatus(sectionId, textarea);

			// Initialize undo stack with initial value
			if (!undoStack.has(sectionId)) {
				undoStack.set(sectionId, []);
			}
		});
	}

	/**
	 * Add section dialog functions
	 */
	function showAddSectionDialog() {
		const dialog = document.getElementById('add-section-dialog');
		if (dialog) {
			dialog.style.display = 'flex';
			const input = document.getElementById('add-section-tag-name');
			if (input) {
				input.focus();
				input.select();
			}
		}
	}

	function hideAddSectionDialog() {
		const dialog = document.getElementById('add-section-dialog');
		if (dialog) {
			dialog.style.display = 'none';
			// Clear inputs
			const tagNameInput = document.getElementById('add-section-tag-name');
			const contentInput = document.getElementById('add-section-content');
			if (tagNameInput) {
				tagNameInput.value = '';
			}
			if (contentInput) {
				contentInput.value = '';
			}
		}
	}

	function handleAddSection() {
		const tagName = document.getElementById('add-section-tag-name').value.trim();
		const content = document.getElementById('add-section-content').value;

		if (!tagName) {
			alert('Please enter a tag name');
			return;
		}

		// Validate tag name (alphanumeric and hyphens only)
		if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tagName)) {
			alert('Tag name must start with a letter and contain only letters, numbers, and hyphens');
			return;
		}

		vscode.postMessage({
			type: 'addSection',
			tagName: tagName,
			content: content || ''
		});

		hideAddSectionDialog();
	}

	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	// Set up periodic memory optimization for large prompts
	setInterval(() => {
		if (currentState && currentState.sections.length > 50) {
			optimizeMemory();
		}
	}, 30000); // Every 30 seconds
})();