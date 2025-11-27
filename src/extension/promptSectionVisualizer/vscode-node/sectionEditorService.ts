/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { PromptSection } from '../common/types';

/**
 * Editor options for section editing
 */
export interface EditorOptions {
	/** Editor mode: document-based or inline */
	mode: 'document' | 'inline';

	/** Language mode for syntax highlighting */
	language?: string;

	/** Whether to show the editor in a preview tab */
	preview?: boolean;

	/** View column for document editor */
	viewColumn?: vscode.ViewColumn;

	/** Validation function for content */
	validator?: (content: string) => string | undefined;

	/** Placeholder text for inline editor */
	placeholder?: string;

	/** Title for the editor */
	title?: string;
}

/**
 * Editor state for preserving cursor and scroll position
 */
interface EditorState {
	/** Section ID */
	sectionId: string;

	/** Cursor position */
	cursorPosition?: vscode.Position;

	/** Scroll position */
	scrollPosition?: number;

	/** Original content for undo support */
	originalContent: string;

	/** Edit history for undo/redo */
	editHistory: string[];

	/** Current position in edit history */
	historyIndex: number;

	/** Timestamp of last edit */
	lastEditTime: number;
}

/**
 * Service for editing prompt sections using VS Code's native editing capabilities
 */
export class SectionEditorService extends Disposable {
	private readonly _editorStates = new Map<string, EditorState>();
	private readonly _activeEditors = new Map<string, vscode.TextEditor>();
	private static readonly MAX_HISTORY_SIZE = 50;

	constructor(
		@ILogService private readonly _logService: ILogService
	) {
		super();

		// Listen for document close events to clean up state
		this._register(vscode.workspace.onDidCloseTextDocument(doc => {
			this._cleanupEditorState(doc);
		}));

		// Register undo/redo commands
		this._registerUndoRedoCommands();
	}

	/**
	 * Edit a section using the configured editor mode
	 */
	async editSection(section: PromptSection, options?: Partial<EditorOptions>): Promise<string | undefined> {
		const editorOptions = this._getEditorOptions(section, options);

		if (editorOptions.mode === 'document') {
			return this.editSectionInDocument(section, editorOptions);
		} else {
			return this.editSectionInline(section, editorOptions);
		}
	}

	/**
	 * Edit section in a temporary document with Monaco editor integration
	 */
	async editSectionInDocument(section: PromptSection, options: EditorOptions): Promise<string | undefined> {
		try {
			this._logService.trace(`[SectionEditorService] Opening document editor for section ${section.id}`);

			// Create a temporary document with the section content
			const doc = await vscode.workspace.openTextDocument({
				content: section.content,
				language: options.language || 'markdown'
			});

			const editor = await vscode.window.showTextDocument(doc, {
				preview: options.preview ?? true,
				viewColumn: options.viewColumn ?? vscode.ViewColumn.Beside,
				preserveFocus: false
			});

			// Save the original state
			this.saveEditorState(section.id, editor);

			// Restore any previous editor state
			this.restoreEditorState(section.id, editor);

			// Wait for user to save or close
			return new Promise<string | undefined>((resolve) => {
				let resolved = false;

				// Listen for document save
				const saveDisposable = vscode.workspace.onDidSaveTextDocument((savedDoc) => {
					if (savedDoc === doc && !resolved) {
						resolved = true;
						this._logService.trace(`[SectionEditorService] Document saved for section ${section.id}`);

						// Update editor state
						this.saveEditorState(section.id, editor);

						// Don't resolve yet - let user continue editing
					}
				});

				// Listen for document close
				const closeDisposable = vscode.workspace.onDidCloseTextDocument((closedDoc) => {
					if (closedDoc === doc && !resolved) {
						resolved = true;
						saveDisposable.dispose();
						closeDisposable.dispose();

						const finalContent = doc.getText();

						// Validate content if validator provided
						if (options.validator) {
							const error = options.validator(finalContent);
							if (error) {
								this._logService.warn(`[SectionEditorService] Validation failed: ${error}`);
								vscode.window.showWarningMessage(`Section validation failed: ${error}`);
							}
						}

						this._logService.trace(`[SectionEditorService] Document closed for section ${section.id}`);
						resolve(finalContent);
					}
				});

				// Listen for editor changes to update state
				const changeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
					if (e.document === doc) {
						// Update editor state on changes
						const activeEditor = vscode.window.activeTextEditor;
						if (activeEditor && activeEditor.document === doc) {
							this.saveEditorState(section.id, activeEditor);
						}
					}
				});

				// Clean up change listener when document closes
				const cleanupDisposable = vscode.workspace.onDidCloseTextDocument((closedDoc) => {
					if (closedDoc === doc) {
						changeDisposable.dispose();
						cleanupDisposable.dispose();
					}
				});
			});
		} catch (error) {
			this._logService.error(`[SectionEditorService] Failed to open document editor: ${error}`);
			vscode.window.showErrorMessage(`Failed to open editor: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}

	/**
	 * Edit section inline using input box with multi-line support
	 */
	async editSectionInline(section: PromptSection, options: EditorOptions): Promise<string | undefined> {
		try {
			this._logService.trace(`[SectionEditorService] Opening inline editor for section ${section.id}`);

			// For small sections, use showInputBox
			// For larger sections, use showQuickPick with custom input
			const contentLength = section.content.length;
			const lineCount = section.content.split('\n').length;

			// Use input box for single-line or short content
			if (lineCount === 1 && contentLength < 200) {
				return this._showSimpleInputBox(section, options);
			}

			// For multi-line content, use a more sophisticated approach
			return this._showMultiLineInput(section, options);
		} catch (error) {
			this._logService.error(`[SectionEditorService] Failed to open inline editor: ${error}`);
			vscode.window.showErrorMessage(`Failed to open inline editor: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}

	/**
	 * Show simple input box for short content
	 */
	private async _showSimpleInputBox(section: PromptSection, options: EditorOptions): Promise<string | undefined> {
		const result = await vscode.window.showInputBox({
			title: options.title || `Edit Section: ${section.tagName}`,
			value: section.content,
			prompt: `Edit the content of the ${section.tagName} section`,
			placeHolder: options.placeholder || 'Enter section content...',
			ignoreFocusOut: true,
			validateInput: (value) => {
				// Use custom validator if provided
				if (options.validator) {
					return options.validator(value);
				}

				// Basic validation
				if (value.trim().length === 0) {
					return 'Section content cannot be empty';
				}

				return undefined;
			}
		});

		return result;
	}

	/**
	 * Show multi-line input using quick pick with edit action
	 */
	private async _showMultiLineInput(section: PromptSection, options: EditorOptions): Promise<string | undefined> {
		// For multi-line content, we'll guide the user to use document editing
		// or provide a simplified inline experience

		const choice = await vscode.window.showQuickPick([
			{
				label: '$(edit) Edit in Document',
				description: 'Open in a full editor with syntax highlighting',
				action: 'document'
			},
			{
				label: '$(text-size) Edit Inline',
				description: 'Edit in a simple text box (limited features)',
				action: 'inline'
			},
			{
				label: '$(close) Cancel',
				description: 'Cancel editing',
				action: 'cancel'
			}
		], {
			title: options.title || `Edit Section: ${section.tagName}`,
			placeHolder: 'Choose how to edit this section'
		});

		if (!choice || choice.action === 'cancel') {
			return undefined;
		}

		if (choice.action === 'document') {
			// Switch to document editing
			return this.editSectionInDocument(section, { ...options, mode: 'document' });
		}

		// For inline, show a text input with multi-line support hint
		const result = await vscode.window.showInputBox({
			title: options.title || `Edit Section: ${section.tagName}`,
			value: section.content,
			prompt: 'Edit the section content (Note: Use document mode for better multi-line editing)',
			placeHolder: options.placeholder || 'Enter section content...',
			ignoreFocusOut: true,
			validateInput: (value) => {
				// Use custom validator if provided
				if (options.validator) {
					return options.validator(value);
				}

				// Basic validation
				if (value.trim().length === 0) {
					return 'Section content cannot be empty';
				}

				// Warn about very long content
				if (value.length > 1000) {
					return 'Content is very long. Consider using document mode for better editing experience.';
				}

				return undefined;
			}
		});

		return result;
	}

	/**
	 * Save editor state for a section with history tracking
	 */
	saveEditorState(sectionId: string, editor: vscode.TextEditor): void {
		const content = editor.document.getText();
		const existingState = this._editorStates.get(sectionId);

		if (existingState) {
			// Update existing state
			existingState.cursorPosition = editor.selection.active;
			existingState.scrollPosition = editor.visibleRanges[0]?.start.line;

			// Add to history if content changed
			if (existingState.editHistory[existingState.historyIndex] !== content) {
				this._addToHistory(existingState, content);
			}

			existingState.lastEditTime = Date.now();
		} else {
			// Create new state
			const state: EditorState = {
				sectionId,
				cursorPosition: editor.selection.active,
				scrollPosition: editor.visibleRanges[0]?.start.line,
				originalContent: content,
				editHistory: [content],
				historyIndex: 0,
				lastEditTime: Date.now()
			};

			this._editorStates.set(sectionId, state);
		}

		this._activeEditors.set(sectionId, editor);
	}

	/**
	 * Add content to edit history
	 */
	private _addToHistory(state: EditorState, content: string): void {
		// Remove any history after current index (when user edits after undo)
		state.editHistory = state.editHistory.slice(0, state.historyIndex + 1);

		// Add new content
		state.editHistory.push(content);

		// Limit history size
		if (state.editHistory.length > SectionEditorService.MAX_HISTORY_SIZE) {
			state.editHistory.shift();
		} else {
			state.historyIndex++;
		}
	}

	/**
	 * Restore editor state for a section
	 */
	restoreEditorState(sectionId: string, editor: vscode.TextEditor): void {
		const state = this._editorStates.get(sectionId);
		if (!state) {
			return;
		}

		// Restore cursor position
		if (state.cursorPosition) {
			const position = new vscode.Position(
				Math.min(state.cursorPosition.line, editor.document.lineCount - 1),
				state.cursorPosition.character
			);
			editor.selection = new vscode.Selection(position, position);
		}

		// Restore scroll position
		if (state.scrollPosition !== undefined) {
			const range = new vscode.Range(
				state.scrollPosition,
				0,
				state.scrollPosition,
				0
			);
			editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
		}
	}

	/**
	 * Get editor state for a section
	 */
	getEditorState(sectionId: string): EditorState | undefined {
		return this._editorStates.get(sectionId);
	}

	/**
	 * Clear editor state for a section
	 */
	clearEditorState(sectionId: string): void {
		this._editorStates.delete(sectionId);
		this._activeEditors.delete(sectionId);
	}

	/**
	 * Get default editor options based on section and user preferences
	 */
	private _getEditorOptions(section: PromptSection, options?: Partial<EditorOptions>): EditorOptions {
		const defaultOptions: EditorOptions = {
			mode: 'document',
			language: this._detectLanguage(section.content),
			preview: true,
			viewColumn: vscode.ViewColumn.Beside,
			title: `Edit Section: ${section.tagName}`,
			placeholder: 'Enter section content...'
		};

		return { ...defaultOptions, ...options };
	}

	/**
	 * Detect language mode from content
	 */
	private _detectLanguage(content: string): string {
		// Check for code block markers
		const codeBlockMatch = content.match(/```(\w+)/);
		if (codeBlockMatch) {
			return codeBlockMatch[1];
		}

		// Default to markdown
		return 'markdown';
	}

	/**
	 * Undo last edit for a section
	 */
	async undoEdit(sectionId: string): Promise<boolean> {
		const state = this._editorStates.get(sectionId);
		const editor = this._activeEditors.get(sectionId);

		if (!state || !editor || state.historyIndex <= 0) {
			return false;
		}

		// Move back in history
		state.historyIndex--;
		const previousContent = state.editHistory[state.historyIndex];

		// Apply the previous content
		const edit = new vscode.WorkspaceEdit();
		const fullRange = new vscode.Range(
			editor.document.positionAt(0),
			editor.document.positionAt(editor.document.getText().length)
		);
		edit.replace(editor.document.uri, fullRange, previousContent);

		const success = await vscode.workspace.applyEdit(edit);
		if (success) {
			this._logService.trace(`[SectionEditorService] Undo applied for section ${sectionId}`);
		}

		return success;
	}

	/**
	 * Redo last undone edit for a section
	 */
	async redoEdit(sectionId: string): Promise<boolean> {
		const state = this._editorStates.get(sectionId);
		const editor = this._activeEditors.get(sectionId);

		if (!state || !editor || state.historyIndex >= state.editHistory.length - 1) {
			return false;
		}

		// Move forward in history
		state.historyIndex++;
		const nextContent = state.editHistory[state.historyIndex];

		// Apply the next content
		const edit = new vscode.WorkspaceEdit();
		const fullRange = new vscode.Range(
			editor.document.positionAt(0),
			editor.document.positionAt(editor.document.getText().length)
		);
		edit.replace(editor.document.uri, fullRange, nextContent);

		const success = await vscode.workspace.applyEdit(edit);
		if (success) {
			this._logService.trace(`[SectionEditorService] Redo applied for section ${sectionId}`);
		}

		return success;
	}

	/**
	 * Check if undo is available for a section
	 */
	canUndo(sectionId: string): boolean {
		const state = this._editorStates.get(sectionId);
		return state !== undefined && state.historyIndex > 0;
	}

	/**
	 * Check if redo is available for a section
	 */
	canRedo(sectionId: string): boolean {
		const state = this._editorStates.get(sectionId);
		return state !== undefined && state.historyIndex < state.editHistory.length - 1;
	}

	/**
	 * Register undo/redo commands for section editing
	 */
	private _registerUndoRedoCommands(): void {
		// Note: These commands would typically be registered in the contribution point
		// This is a placeholder for the command handlers
		this._logService.trace('[SectionEditorService] Undo/redo command handlers initialized');
	}

	/**
	 * Clean up editor state when document is closed
	 */
	private _cleanupEditorState(doc: vscode.TextDocument): void {
		// Find and remove state for this document
		for (const [sectionId, editor] of this._activeEditors.entries()) {
			if (editor.document === doc) {
				this._editorStates.delete(sectionId);
				this._activeEditors.delete(sectionId);
				this._logService.trace(`[SectionEditorService] Cleaned up state for section ${sectionId}`);
			}
		}
	}
}
