/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test, vi } from 'vitest';
import * as vscode from 'vscode';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { ILogService } from '../../../../platform/log/common/logService';
import { LiveRequestSection, LiveRequestSectionKind, EditableChatRequest } from '../../common/liveRequestEditorModel';
import { ILiveRequestEditorService } from '../../common/liveRequestEditorService';
import { LiveRequestReplaySessionProvider } from '../liveRequestReplaySessionProvider';

vi.mock('vscode', async () => {
	const shim = await import('../../../../util/common/test/shims/vscodeTypesShim');
	return {
		...shim,
		chat: {
			createChatParticipant: vi.fn(),
			registerChatSessionContentProvider: vi.fn(),
		},
		commands: {
			executeCommand: vi.fn()
		}
	};
});

describe('LiveRequestReplaySessionProvider', () => {
	function createProvider(requests?: Record<string, EditableChatRequest>) {
		const store = requests ?? {};
		const service: ILiveRequestEditorService = {
			_serviceBrand: undefined,
			onDidChange: vi.fn() as any,
			onDidRemoveRequest: vi.fn() as any,
			onDidUpdateSubagentHistory: vi.fn() as any,
			onDidChangeInterception: vi.fn() as any,
			onDidChangeMetadata: vi.fn() as any,
			isEnabled: () => true,
			isInterceptionEnabled: () => true,
			prepareRequest: vi.fn(),
			getRequest: key => store[`${key.sessionId}::${key.location}`],
			updateSectionContent: vi.fn(),
			deleteSection: vi.fn(),
			restoreSection: vi.fn(),
			resetRequest: vi.fn(),
			updateTokenCounts: vi.fn(),
			applyTraceData: vi.fn(),
			updateRequestOptions: vi.fn(),
			getMessagesForSend: vi.fn(),
			getInterceptionState: vi.fn(),
			setMode: vi.fn(),
			getMode: vi.fn(),
			setAutoOverrideScope: vi.fn(),
			getAutoOverrideScope: vi.fn(),
			configureAutoOverridePreviewLimit: vi.fn(),
			clearAutoOverrides: vi.fn(),
			beginAutoOverrideCapture: vi.fn(),
			getAutoOverrideEntry: vi.fn(),
			waitForInterceptionApproval: vi.fn(),
			resolvePendingIntercept: vi.fn(),
			handleContextChange: vi.fn(),
			recordLoggedRequest: vi.fn(),
			getSubagentRequests: vi.fn(),
			clearSubagentHistory: vi.fn(),
			getMetadataSnapshot: vi.fn(),
		};

		const log: ILogService = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as unknown as ILogService;

		return new LiveRequestReplaySessionProvider(service, log);
	}

	function section(kind: LiveRequestSectionKind, content: string, index: number, extra?: Partial<LiveRequestSection>): LiveRequestSection {
		return {
			id: `${kind}-${index}`,
			kind,
			label: `${kind}-${index}`,
			content,
			originalContent: content,
			collapsed: false,
			editable: true,
			deletable: true,
			sourceMessageIndex: index,
			...extra,
		};
	}

	function requestWithSections(sections: LiveRequestSection[]): EditableChatRequest {
		return {
			id: 'req-id',
			sessionId: 'session-123',
			location: ChatLocation.Panel,
			debugName: 'dbg',
			model: 'gpt',
			isSubagent: false,
			messages: [],
			originalMessages: [],
			sections,
			metadata: {
				requestId: 'rid',
				createdAt: Date.now()
			},
			isDirty: false
		};
	}

	test('returns friendly message when request is missing', () => {
		const provider = createProvider();
		const uri = vscode.Uri.parse('copilot-live-replay:/replay/foo');
		const session = provider.provideChatSessionContent(uri, {} as any);
		const header = (session.history[0] as vscode.ChatResponseTurn2).response[0] as vscode.ChatResponseMarkdownPart;
		expect(header.value.value).toContain('Nothing to replay');
	});

	test('caps visible sections at 30 and indicates overflow', () => {
		const sections: LiveRequestSection[] = Array.from({ length: 32 }, (_, idx) =>
			section('user', `content-${idx}`, idx)
		);
		const provider = createProvider({ 'session-123::1': requestWithSections(sections) });
		const query = new URLSearchParams({
			sessionId: 'session-123',
			location: String(ChatLocation.Panel),
			sessionKey: 'session-123::1'
		}).toString();
		const uri = vscode.Uri.from({ scheme: 'copilot-live-replay', path: '/replay/session-123', query });
		const session = provider.provideChatSessionContent(uri, {} as any);

		expect(session.history.length).toBe(31); // header + 30 visible sections
		const header = (session.history[0] as vscode.ChatResponseTurn2).response[0] as vscode.ChatResponseMarkdownPart;
		expect(header.value.value).toContain('latest 30 of 32 sections');

		// First visible section should be the third original entry (index 2)
		const firstTurn = session.history[1] as vscode.ChatRequestTurn;
		expect(firstTurn.prompt).toContain('content-2');
		expect(firstTurn.prompt).toContain('User');
	});

	test('renders tool sections with edited marker and tool name', () => {
		const toolSection = section('tool', 'tool-body', 0, {
			originalContent: 'orig',
			editedContent: 'tool-body',
			metadata: {
				toolInvocation: { name: 'myTool' }
			}
		});
		const provider = createProvider({ 'session-123::1': requestWithSections([toolSection]) });
		const query = new URLSearchParams({
			sessionId: 'session-123',
			location: String(ChatLocation.Panel),
			sessionKey: 'session-123::1'
		}).toString();
		const uri = vscode.Uri.from({ scheme: 'copilot-live-replay', path: '/replay/session-123', query });
		const session = provider.provideChatSessionContent(uri, {} as any);

		const sectionTurn = session.history[1] as vscode.ChatResponseTurn2;
		const markdown = (sectionTurn.response[0] as vscode.ChatResponseMarkdownPart).value.value;
		expect(markdown).toContain('Tool · myTool');
		expect(markdown).toContain('Edited');
		expect(markdown).toContain('tool-body');
	});

	test('omits deleted sections and shows empty replay message when all are deleted', () => {
		const provider = createProvider({
			'session-123::1': requestWithSections([
				section('user', 'visible', 0, { deleted: true })
			])
		});
		const query = new URLSearchParams({
			sessionId: 'session-123',
			location: String(ChatLocation.Panel),
			sessionKey: 'session-123::1'
		}).toString();
		const uri = vscode.Uri.from({ scheme: 'copilot-live-replay', path: '/replay/session-123', query });
		const session = provider.provideChatSessionContent(uri, {} as any);

		expect(session.history.length).toBe(2); // header + empty message
		const emptyMessage = (session.history[1] as vscode.ChatResponseTurn2).response[0] as vscode.ChatResponseMarkdownPart;
		expect(emptyMessage.value.value).toContain('Nothing to replay');
	});

	test('shows validation warning banner when prompt was empty', () => {
		const req = requestWithSections([
			section('user', '', 0, { deleted: true })
		]);
		req.metadata.lastValidationErrorCode = 'empty';
		const provider = createProvider({ 'session-123::1': req });
		const query = new URLSearchParams({
			sessionId: 'session-123',
			location: String(ChatLocation.Panel),
			sessionKey: 'session-123::1'
		}).toString();
		const uri = vscode.Uri.from({ scheme: 'copilot-live-replay', path: '/replay/session-123', query });
		const session = provider.provideChatSessionContent(uri, {} as any);

		const header = (session.history[0] as vscode.ChatResponseTurn2).response[0] as vscode.ChatResponseMarkdownPart;
		expect(header.value.value).toContain('prompt was empty');
	});
});
