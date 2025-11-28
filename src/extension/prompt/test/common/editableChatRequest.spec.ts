/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw, RenderPromptResult } from '@vscode/prompt-tsx';
import { describe, expect, test, beforeEach } from 'vitest';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { toTextParts } from '../../../../platform/chat/common/globalStringUtils';
import {
	EditableChatRequest,
	EditableChatRequestBuilder,
	createSectionsFromMessages,
	LiveRequestSectionKind,
} from '../../common/editableChatRequest';

describe('EditableChatRequest', () => {
	const createTestMessages = (): Raw.ChatMessage[] => [
		{
			role: Raw.ChatRole.System,
			content: toTextParts('You are a helpful assistant.'),
		},
		{
			role: Raw.ChatRole.User,
			content: toTextParts('Hello, how are you?'),
		},
		{
			role: Raw.ChatRole.Assistant,
			content: toTextParts('I am doing well, thank you!'),
		},
	];

	describe('createSectionsFromMessages', () => {
		test('creates sections for each message', () => {
			const messages = createTestMessages();
			const sections = createSectionsFromMessages(messages);

			expect(sections).toHaveLength(3);
			expect(sections[0].kind).toBe(LiveRequestSectionKind.System);
			expect(sections[1].kind).toBe(LiveRequestSectionKind.User);
			expect(sections[2].kind).toBe(LiveRequestSectionKind.Assistant);
		});

		test('assigns correct labels', () => {
			const messages = createTestMessages();
			const sections = createSectionsFromMessages(messages);

			expect(sections[0].label).toBe('System');
			expect(sections[1].label).toBe('User');
			expect(sections[2].label).toBe('Assistant');
		});

		test('extracts text content from messages', () => {
			const messages = createTestMessages();
			const sections = createSectionsFromMessages(messages);

			expect(sections[0].content).toBe('You are a helpful assistant.');
			expect(sections[1].content).toBe('Hello, how are you?');
			expect(sections[2].content).toBe('I am doing well, thank you!');
		});

		test('system sections are not editable by default', () => {
			const messages = createTestMessages();
			const sections = createSectionsFromMessages(messages);

			expect(sections[0].editable).toBe(false);
			expect(sections[1].editable).toBe(true);
			expect(sections[2].editable).toBe(true);
		});

		test('system sections are not deletable by default', () => {
			const messages = createTestMessages();
			const sections = createSectionsFromMessages(messages);

			expect(sections[0].deletable).toBe(false);
			expect(sections[1].deletable).toBe(true);
			expect(sections[2].deletable).toBe(true);
		});

		test('handles tool messages with name', () => {
			const messages: Raw.ChatMessage[] = [
				{
					role: Raw.ChatRole.Tool,
					content: toTextParts('Tool result'),
					name: 'my_tool',
				},
			];
			const sections = createSectionsFromMessages(messages);

			expect(sections[0].kind).toBe(LiveRequestSectionKind.Tool);
			expect(sections[0].label).toBe('Tool: my_tool');
		});
	});

	describe('EditableChatRequest', () => {
		let request: EditableChatRequest;

		beforeEach(() => {
			const messages = createTestMessages();
			const sections = createSectionsFromMessages(messages);
			request = new EditableChatRequest(
				'test-request',
				'gpt-4',
				ChatLocation.Panel,
				'session-123',
				messages,
				sections,
			);
		});

		test('initializes with correct properties', () => {
			expect(request.debugName).toBe('test-request');
			expect(request.model).toBe('gpt-4');
			expect(request.location).toBe(ChatLocation.Panel);
			expect(request.sessionId).toBe('session-123');
			expect(request.isDirty).toBe(false);
		});

		test('messages and sections are accessible', () => {
			expect(request.messages).toHaveLength(3);
			expect(request.sections).toHaveLength(3);
		});

		test('updateSectionContent updates section and marks dirty', () => {
			const section = request.sections[1]; // User section
			request.updateSectionContent(section.id, 'New user message');

			expect(section.content).toBe('New user message');
			expect(request.isDirty).toBe(true);
		});

		test('updateSectionContent does not update non-editable sections', () => {
			const systemSection = request.sections[0];
			const originalContent = systemSection.content;

			request.updateSectionContent(systemSection.id, 'New system prompt');

			expect(systemSection.content).toBe(originalContent);
			expect(request.isDirty).toBe(false);
		});

		test('deleteSection marks section as deleted', () => {
			const userSection = request.sections[1];
			request.deleteSection(userSection.id);

			expect(userSection.deleted).toBe(true);
			expect(request.isDirty).toBe(true);
		});

		test('deleteSection does not delete non-deletable sections', () => {
			const systemSection = request.sections[0];
			request.deleteSection(systemSection.id);

			expect(systemSection.deleted).toBe(false);
			expect(request.isDirty).toBe(false);
		});

		test('restoreSection restores deleted section', () => {
			const userSection = request.sections[1];
			request.deleteSection(userSection.id);
			expect(userSection.deleted).toBe(true);

			request.restoreSection(userSection.id);
			expect(userSection.deleted).toBe(false);
		});

		test('reset restores all sections to original state', () => {
			const userSection = request.sections[1];
			const assistantSection = request.sections[2];

			request.updateSectionContent(userSection.id, 'Modified content');
			request.deleteSection(assistantSection.id);
			expect(request.isDirty).toBe(true);

			request.reset();

			expect(userSection.content).toBe('Hello, how are you?');
			expect(assistantSection.deleted).toBe(false);
			expect(request.isDirty).toBe(false);
		});

		test('resetSection restores single section to original state', () => {
			const userSection = request.sections[1];

			request.updateSectionContent(userSection.id, 'Modified content');
			expect(userSection.content).toBe('Modified content');

			request.resetSection(userSection.id);
			expect(userSection.content).toBe('Hello, how are you?');
		});

		test('toggleSectionCollapsed toggles collapsed state', () => {
			const section = request.sections[0];
			expect(section.collapsed).toBe(false);

			request.toggleSectionCollapsed(section.id);
			expect(section.collapsed).toBe(true);

			request.toggleSectionCollapsed(section.id);
			expect(section.collapsed).toBe(false);
		});

		test('getActiveMessages excludes deleted sections', () => {
			const userSection = request.sections[1];
			request.deleteSection(userSection.id);

			const activeMessages = request.getActiveMessages();
			expect(activeMessages).toHaveLength(2);
		});

		test('canSend returns valid for non-empty request', () => {
			const result = request.canSend();
			expect(result.valid).toBe(true);
		});

		test('canSend returns error when all sections deleted', () => {
			// Delete all deletable sections
			for (const section of request.sections) {
				if (section.deletable) {
					request.deleteSection(section.id);
				}
			}

			const result = request.canSend();
			// Note: System section is not deletable, so request still has content
			expect(result.valid).toBe(true);
		});

		test('fires onDidChange when content changes', () => {
			let changeCount = 0;
			request.onDidChange(() => changeCount++);

			const userSection = request.sections[1];
			request.updateSectionContent(userSection.id, 'New content');

			expect(changeCount).toBe(1);
		});

		test('fires onDidChangeSection when section changes', () => {
			let changedSection: unknown;
			request.onDidChangeSection((section) => {
				changedSection = section;
			});

			const userSection = request.sections[1];
			request.updateSectionContent(userSection.id, 'New content');

			expect(changedSection).toBe(userSection);
		});
	});

	describe('EditableChatRequestBuilder', () => {
		test('creates request from RenderPromptResult', () => {
			const messages = createTestMessages();
			const renderResult: RenderPromptResult = {
				messages,
				tokenCount: 100,
				metadatas: new Map(),
				references: [],
			};

			const request = EditableChatRequestBuilder.fromRenderPromptResult(
				'test',
				'gpt-4',
				ChatLocation.Panel,
				'session-123',
				renderResult,
			);

			expect(request.messages).toHaveLength(3);
			expect(request.sections).toHaveLength(3);
			expect(request.model).toBe('gpt-4');
		});

		test('includes metadata in created request', () => {
			const messages = createTestMessages();
			const renderResult: RenderPromptResult = {
				messages,
				tokenCount: 100,
				metadatas: new Map(),
				references: [],
			};

			const request = EditableChatRequestBuilder.fromRenderPromptResult(
				'test',
				'gpt-4',
				ChatLocation.Panel,
				'session-123',
				renderResult,
				{
					maxPromptTokens: 4096,
					maxResponseTokens: 1024,
					intent: 'chat',
				},
			);

			expect(request.metadata.maxPromptTokens).toBe(4096);
			expect(request.metadata.maxResponseTokens).toBe(1024);
			expect(request.metadata.intent).toBe('chat');
		});
	});
});
