/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ILogService } from '../../../../platform/log/common/logService';
import { IPromptStateManager, IPromptVisualizerController } from '../../common/services';
import { PromptSection, VisualizerState } from '../../common/types';
import { PromptVisualizerChatParticipant } from '../../vscode-node/chatParticipant';

/**
 * Mock ChatResponseStream for testing
 */
class MockChatResponseStream {
	public markdownParts: string[] = [];
	public warningParts: string[] = [];
	public buttonParts: Array<{ title: string; command: string; arguments?: any[] }> = [];
	public progressParts: string[] = [];

	markdown(value: string | vscode.MarkdownString): void {
		this.markdownParts.push(typeof value === 'string' ? value : value.value);
	}

	warning(value: string | vscode.MarkdownString): void {
		this.warningParts.push(typeof value === 'string' ? value : value.value);
	}

	button(part: vscode.ChatResponseCommandButtonPart | vscode.Command): this {
		const command = (part as vscode.ChatResponseCommandButtonPart).value ?? part as vscode.Command;
		this.buttonParts.push({
			title: command.title ?? '',
			command: command.command,
			arguments: command.arguments
		});
		return this;
	}

	progress(value: string): void {
		this.progressParts.push(value);
	}

	reference(value: vscode.Uri | vscode.Location, iconPath?: vscode.ThemeIcon): void {
		// Not used in current implementation
	}

	push(part: vscode.ChatResponsePart): void {
		// Not used in current implementation
	}

	anchor(value: vscode.Uri | vscode.Location, title?: string): void {
		// Not used in current implementation
	}

	filetree(value: vscode.ChatResponseFileTree[], baseUri: vscode.Uri): void {
		// Not used in current implementation
	}

	thinkingProgress(value: string): this {
		// Not used in current implementation
		return this;
	}

	textEdit(target: vscode.Location | vscode.Uri, edits: vscode.TextEdit[] | string): this {
		// Not used in current implementation
		return this;
	}

	notebookEdit(target: vscode.Uri, edits: vscode.NotebookEdit): this {
		// Not used in current implementation
		return this;
	}

	externalEdit(target: vscode.Uri, edits: vscode.WorkspaceEdit): this {
		// Not used in current implementation
		return this;
	}

	confirmation(title: string, message: string, data: any, buttons?: vscode.ChatResponseConfirmationPart[]): this {
		// Not used in current implementation
		return this;
	}

	detectedParticipant(participant: vscode.ChatParticipantDetectionResult, command?: vscode.ChatCommand): void {
		// Not used in current implementation
	}

	codeblockUri(uri: vscode.Uri): void {
		// Not used in current implementation
	}
}

describe('PromptVisualizerChatParticipant', () => {
	let participant: PromptVisualizerChatParticipant;
	let mockLogService: ILogService;
	let mockStateManager: IPromptStateManager;
	let mockController: IPromptVisualizerController;

	const createMockSection = (id: string, tagName: string, content: string): PromptSection => ({
		id,
		tagName,
		content,
		startIndex: 0,
		endIndex: content.length,
		tokenCount: 10,
		isEditing: false,
		isCollapsed: false,
		hasRenderableElements: false
	});

	const createMockState = (sections: PromptSection[]): VisualizerState => ({
		sections,
		totalTokens: sections.reduce((sum, s) => sum + s.tokenCount, 0),
		isEnabled: true,
		currentLanguageModel: 'gpt-4',
		uiTheme: 'dark'
	});

	const createMockRequest = (command?: string, prompt: string = ''): vscode.ChatRequest => ({
		command,
		prompt,
		references: [],
		location: vscode.ChatLocation.Panel,
		attempt: 0,
		enableCommandDetection: false,
		toolReferences: [],
		model: {} as any,
		tools: new Map<string, boolean>(),
		acceptedConfirmationData: [],
		rejectedConfirmationData: [],
		variables: {}
	} as any);

	const createMockContext = (): vscode.ChatContext => ({
		history: []
	});

	beforeEach(() => {
		// Create mock log service
		mockLogService = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn()
		} as any;

		// Create mock state manager
		mockStateManager = {
			getCurrentState: vi.fn().mockReturnValue(createMockState([])),
			updatePrompt: vi.fn(),
			updateSection: vi.fn(),
			reorderSections: vi.fn(),
			addSection: vi.fn(),
			removeSection: vi.fn(),
			toggleSectionCollapse: vi.fn(),
			switchSectionMode: vi.fn(),
			onDidChangeState: vi.fn(() => ({ dispose: vi.fn() })),
			dispose: vi.fn()
		} as any;

		// Create mock controller
		mockController = {
			handleChatContext: vi.fn().mockResolvedValue(undefined),
			renderInline: vi.fn().mockResolvedValue(undefined),
			renderStandalone: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn()
		} as any;

		// Create participant instance
		participant = new PromptVisualizerChatParticipant(
			mockLogService,
			mockStateManager,
			mockController
		);
	});

	describe('command routing', () => {
		it('should route /visualize-prompt command correctly', async () => {
			const sections = [createMockSection('1', 'context', 'Test content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const request = createMockRequest('visualize-prompt');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(result.metadata?.command).toBe('visualize-prompt');
			expect(mockController.renderInline).toHaveBeenCalled();
		});

		it('should route /edit-section command correctly', async () => {
			const sections = [createMockSection('1', 'context', 'Test content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const request = createMockRequest('edit-section', 'context');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(result.metadata?.command).toBe('edit-section');
			expect(result.metadata?.sectionTagName).toBe('context');
		});

		it('should default to visualize-prompt when no command is provided', async () => {
			const sections = [createMockSection('1', 'context', 'Test content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const request = createMockRequest(undefined, '');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(result.metadata?.command).toBe('visualize-prompt');
		});

		it('should handle unknown commands', async () => {
			const request = createMockRequest('unknown-command');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(stream.markdownParts.some(part => part.includes('Unknown command'))).toBe(true);
			expect(result.metadata?.command).toBe('unknown-command');
		});
	});

	describe('/visualize-prompt handler', () => {
		it('should visualize existing sections when no prompt provided', async () => {
			const sections = [
				createMockSection('1', 'context', 'Context content'),
				createMockSection('2', 'instructions', 'Instructions content')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const request = createMockRequest('visualize-prompt', '');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(result.metadata?.sectionsCount).toBe(2);
			expect(mockController.renderInline).toHaveBeenCalled();
			expect(mockStateManager.updatePrompt).not.toHaveBeenCalled();
		});

		it('should parse and visualize provided prompt', async () => {
			const prompt = '<context>New context</context><instructions>New instructions</instructions>';
			const sections = [
				createMockSection('1', 'context', 'New context'),
				createMockSection('2', 'instructions', 'New instructions')
			];

			// Mock state manager to return sections after updatePrompt
			vi.mocked(mockStateManager.updatePrompt).mockImplementation(() => {
				vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));
			});

			const request = createMockRequest('visualize-prompt', prompt);
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(mockStateManager.updatePrompt).toHaveBeenCalledWith(prompt);
			expect(result.metadata?.sectionsCount).toBe(2);
			expect(mockController.renderInline).toHaveBeenCalled();
		});

		it('should handle empty prompt with no existing sections', async () => {
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState([]));

			const request = createMockRequest('visualize-prompt', '');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(stream.markdownParts.some(part => part.includes('No prompt sections found'))).toBe(true);
			expect(result.metadata?.sectionsCount).toBe(0);
		});

		it('should handle prompt with no valid sections', async () => {
			const prompt = 'This is just plain text without any tags';

			// Mock state manager to return empty sections after parsing
			vi.mocked(mockStateManager.updatePrompt).mockImplementation(() => {
				vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState([]));
			});

			const request = createMockRequest('visualize-prompt', prompt);
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(stream.markdownParts.some(part => part.includes('No sections found'))).toBe(true);
			expect(result.metadata?.sectionsCount).toBe(0);
		});

		it('should provide follow-up prompts after successful visualization', async () => {
			const sections = [createMockSection('1', 'context', 'Test content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const request = createMockRequest('visualize-prompt', '');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			await (participant as any)._handleRequest(request, context, stream, token);

			// Check follow-up buttons were provided
			expect(stream.buttonParts.length).toBeGreaterThan(0);
			expect(stream.buttonParts.some(btn => btn.title.includes('Edit'))).toBe(true);
			expect(stream.buttonParts.some(btn => btn.title.includes('Add'))).toBe(true);
		});
	});

	describe('/edit-section handler', () => {
		it('should handle edit-section with valid tag name', async () => {
			const sections = [
				createMockSection('1', 'context', 'Context content'),
				createMockSection('2', 'instructions', 'Instructions content')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const request = createMockRequest('edit-section', 'context');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(result.metadata?.sectionId).toBe('1');
			expect(result.metadata?.sectionTagName).toBe('context');
			expect(stream.markdownParts.some(part => part.includes('Editing Section'))).toBe(true);
			expect(stream.buttonParts.some(btn => btn.title === 'Edit in Editor')).toBe(true);
		});

		it('should handle edit-section with valid index', async () => {
			const sections = [
				createMockSection('1', 'context', 'Context content'),
				createMockSection('2', 'instructions', 'Instructions content')
			];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const request = createMockRequest('edit-section', '1');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(result.metadata?.sectionId).toBe('2');
			expect(result.metadata?.sectionTagName).toBe('instructions');
		});

		it('should handle edit-section with invalid section identifier', async () => {
			const sections = [createMockSection('1', 'context', 'Context content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const request = createMockRequest('edit-section', 'nonexistent');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(stream.markdownParts.some(part => part.includes('not found'))).toBe(true);
			expect(result.metadata?.error).toBe('section-not-found');
		});

		it('should handle edit-section with missing section identifier', async () => {
			const request = createMockRequest('edit-section', '');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(stream.markdownParts.some(part => part.includes('specify which section'))).toBe(true);
			expect(result.metadata?.error).toBe('missing-section-id');
		});

		it('should display current section content', async () => {
			const sections = [createMockSection('1', 'context', 'Test content to edit')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const request = createMockRequest('edit-section', 'context');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			await (participant as any)._handleRequest(request, context, stream, token);

			expect(stream.markdownParts.some(part => part.includes('Test content to edit'))).toBe(true);
		});
	});

	describe('error handling', () => {
		it('should handle errors in visualize-prompt gracefully', async () => {
			vi.mocked(mockStateManager.getCurrentState).mockImplementation(() => {
				throw new Error('State manager error');
			});

			const request = createMockRequest('visualize-prompt', '');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(stream.markdownParts.some(part => part.includes('Failed to visualize'))).toBe(true);
			expect(result.errorDetails).toBeDefined();
		});

		it('should handle errors in edit-section gracefully', async () => {
			vi.mocked(mockStateManager.getCurrentState).mockImplementation(() => {
				throw new Error('State manager error');
			});

			const request = createMockRequest('edit-section', 'context');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(stream.markdownParts.some(part => part.includes('Failed to edit'))).toBe(true);
			expect(result.errorDetails).toBeDefined();
		});

		it('should handle controller rendering errors', async () => {
			const sections = [createMockSection('1', 'context', 'Test content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));
			vi.mocked(mockController.renderInline).mockRejectedValue(new Error('Rendering error'));

			const request = createMockRequest('visualize-prompt', '');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			const result = await (participant as any)._handleRequest(request, context, stream, token);

			expect(result.errorDetails).toBeDefined();
		});
	});

	describe('follow-up prompt generation', () => {
		it('should provide follow-up actions after visualization', async () => {
			const sections = [createMockSection('1', 'context', 'Test content')];
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState(sections));

			const request = createMockRequest('visualize-prompt', '');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			await (participant as any)._handleRequest(request, context, stream, token);

			// Check that follow-up buttons are provided
			const editButton = stream.buttonParts.find(btn => btn.command.includes('editSection'));
			const addButton = stream.buttonParts.find(btn => btn.command.includes('addSection'));
			const deleteButton = stream.buttonParts.find(btn => btn.command.includes('deleteSection'));

			expect(editButton).toBeDefined();
			expect(addButton).toBeDefined();
			expect(deleteButton).toBeDefined();
		});

		it('should not provide follow-up actions when no sections found', async () => {
			vi.mocked(mockStateManager.getCurrentState).mockReturnValue(createMockState([]));

			const request = createMockRequest('visualize-prompt', '');
			const context = createMockContext();
			const stream = new MockChatResponseStream();
			const token = new vscode.CancellationTokenSource().token;

			await (participant as any)._handleRequest(request, context, stream, token);

			// Should not have follow-up action buttons
			const actionButtons = stream.buttonParts.filter(btn =>
				btn.command.includes('editSection') ||
				btn.command.includes('addSection') ||
				btn.command.includes('deleteSection')
			);

			expect(actionButtons.length).toBe(0);
		});
	});

	describe('disposal', () => {
		it('should dispose without errors', () => {
			expect(() => participant.dispose()).not.toThrow();
		});

		it('should log disposal', () => {
			participant.dispose();
			expect(mockLogService.info).toHaveBeenCalledWith(expect.stringContaining('disposed'));
		});
	});
});
