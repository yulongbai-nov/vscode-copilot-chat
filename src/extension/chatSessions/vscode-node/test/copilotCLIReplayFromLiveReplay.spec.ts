/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import type { IGitService } from '../../../../platform/git/common/gitService';
import type { ILiveRequestEditorService } from '../../../prompt/common/liveRequestEditorService';
import type { LiveRequestReplaySnapshot } from '../../../prompt/common/liveRequestEditorModel';
import type { ICopilotCLISessionService } from '../../../agents/copilotcli/node/copilotcliSessionService';
import type { ICopilotCLISession } from '../../../agents/copilotcli/node/copilotcliSession';
import { registerCLIChatCommands, type CopilotCLIChatSessionItemProvider } from '../copilotCLIChatSessionsContribution';

// Mock terminal integration to avoid importing PowerShell asset (.ps1) which Vite cannot parse during tests.
vi.mock('../copilotCLITerminalIntegration', () => {
	// Minimal stand-in for createServiceIdentifier
	const createServiceIdentifier = (name: string) => {
		const fn: any = () => { /* decorator no-op */ };
		fn.toString = () => name;
		return fn;
	};
	class CopilotCLITerminalIntegration {
		dispose() { }
		openTerminal = vi.fn(async () => { });
	}
	return {
		ICopilotCLITerminalIntegration: createServiceIdentifier('ICopilotCLITerminalIntegration'),
		CopilotCLITerminalIntegration
	};
});

vi.mock('vscode', async () => {
	const shim = await import('../../../../util/common/test/shims/vscodeTypesShim');
	const commandHandlers: Record<string, (...args: unknown[]) => unknown> = {};
	const executeCommand = vi.fn().mockImplementation((command: string, ...args: unknown[]) => commandHandlers[command]?.(...args));

	return {
		...shim,
		commands: {
			registerCommand: vi.fn().mockImplementation((command: string, handler: (...args: unknown[]) => unknown) => {
				commandHandlers[command] = handler;
				return { dispose: vi.fn() };
			}),
			executeCommand,
		},
		window: {
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			showInputBox: vi.fn(),
		},
	};
});

describe('Copilot CLI – Live Replay to CLI fork command', () => {
	let snapshot: LiveRequestReplaySnapshot;
	let newSession: ICopilotCLISession & { addUserMessage: Mock; addUserAssistantMessage: Mock };
	let createSession: Mock;
	let setCustomLabel: Mock;
	let notifySessionsChange: Mock;
	let getReplaySnapshot: Mock;
	let buildReplayForRequest: Mock;

	beforeEach(() => {
		newSession = {
			sessionId: 'cli-session-abcdef',
			addUserMessage: vi.fn(),
			addUserAssistantMessage: vi.fn(),
		} as unknown as ICopilotCLISession & { addUserMessage: Mock; addUserAssistantMessage: Mock };

		createSession = vi.fn().mockResolvedValue({
			object: newSession,
			dispose: vi.fn(),
		});

		setCustomLabel = vi.fn();
		notifySessionsChange = vi.fn();

		snapshot = buildSnapshot();
		getReplaySnapshot = vi.fn().mockReturnValue(snapshot);
		buildReplayForRequest = vi.fn().mockReturnValue(snapshot);

		const copilotcliSessionItemProvider = {
			setCustomLabel,
			notifySessionsChange,
			worktreeManager: {},
		} as unknown as CopilotCLIChatSessionItemProvider;

		const copilotCLISessionService = {
			createSession,
		} as unknown as ICopilotCLISessionService;

		const gitService = {} as unknown as IGitService;

		const liveRequestEditorService = {
			getReplaySnapshot,
			buildReplayForRequest,
		} as unknown as ILiveRequestEditorService;

		// Register all CLI commands, including github.copilot.liveRequestEditor.openInCopilotCLI.
		registerCLIChatCommands(copilotcliSessionItemProvider, copilotCLISessionService, gitService, liveRequestEditorService);
	});

	test('seeds new CLI session from session key via buildReplayForRequest', async () => {
		const key = { sessionId: snapshot.key.sessionId, location: snapshot.key.location };

		await vscode.commands.executeCommand('github.copilot.liveRequestEditor.openInCopilotCLI', key);

		expect(buildReplayForRequest).toHaveBeenCalledTimes(1);
		expect(buildReplayForRequest).toHaveBeenCalledWith(key);

		expect(createSession).toHaveBeenCalledTimes(1);
		expect(newSession.addUserMessage).toHaveBeenCalledWith('hi');
		expect(newSession.addUserAssistantMessage).toHaveBeenCalledTimes(2);
	});

	test('seeds new CLI session from replay payload and opens it', async () => {
		const key = snapshot.key;

		await vscode.commands.executeCommand('github.copilot.liveRequestEditor.openInCopilotCLI', key);

		expect(createSession).toHaveBeenCalledTimes(1);
		expect(createSession.mock.calls[0][0]).toMatchObject({
			model: snapshot.model,
			workingDirectory: undefined,
			isolationEnabled: false,
			agent: undefined,
		});

		// System and assistant messages become assistant turns; user stays user.
		expect(newSession.addUserMessage).toHaveBeenCalledWith('hi');
		expect(newSession.addUserAssistantMessage).toHaveBeenCalledTimes(2);

		const assistantCalls = (newSession.addUserAssistantMessage as Mock).mock.calls.map(call => call[0] as string);
		expect(assistantCalls[0]).toBe('sys');
		expect(assistantCalls[1]).toContain('hello');
		expect(assistantCalls[1]).toContain('[image]');

		// Label and sessions list refresh
		expect(setCustomLabel).toHaveBeenCalledTimes(1);
		const [sessionId, label] = setCustomLabel.mock.calls[0];
		expect(sessionId).toBe('cli-session-abcdef');
		expect(label).toContain('Replay from Live Request Editor');

		expect(notifySessionsChange).toHaveBeenCalledTimes(1);

		// New session is opened via vscode.open with copilotcli scheme.
		const openCalls = (vscode.commands.executeCommand as unknown as Mock).mock.calls.filter(
			call => call[0] === 'vscode.open'
		);
		expect(openCalls.length).toBeGreaterThanOrEqual(1);
		const openResource = openCalls[openCalls.length - 1][1] as vscode.Uri;
		expect(openResource.scheme).toBe('copilotcli');
		expect(openResource.path).toContain('cli-session-abcdef');
	});

	test('shows info message and does not create session when snapshot and replay build are missing', async () => {
		(getReplaySnapshot as Mock).mockReturnValue(undefined);
		(buildReplayForRequest as Mock).mockReturnValue(undefined);

		await vscode.commands.executeCommand('github.copilot.liveRequestEditor.openInCopilotCLI', {
			sessionId: 'missing',
			location: 1,
			requestId: 'req',
		});

		expect(createSession).not.toHaveBeenCalled();
		expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
		const [message] = (vscode.window.showInformationMessage as unknown as Mock).mock.calls[0];
		expect(String(message)).toContain('Nothing to replay for this request.');
	});
});

function buildSnapshot(): LiveRequestReplaySnapshot {
	const payload: Raw.ChatMessage[] = [
		{
			role: Raw.ChatRole.System,
			content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'sys' }],
		},
		{
			role: Raw.ChatRole.User,
			content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'hi' }],
		},
		{
			role: Raw.ChatRole.Assistant,
			content: [
				{ type: Raw.ChatCompletionContentPartKind.Text, text: 'hello' },
				// Use a loosely-typed image_url part so renderReplayMessageText
				// can recognize it without requiring full OpenAI schema fields.
				{ type: 'image_url' } as any,
			],
		},
	];

	return {
		key: { sessionId: 'session-1', location: 1, requestId: 'req-1' },
		state: 'ready',
		version: 1,
		updatedAt: Date.now(),
		payload,
		payloadHash: 1,
		projection: undefined,
		projectionHash: undefined,
		parentSessionId: 'session-1',
		parentTurnId: 'req-1',
		debugName: 'test replay',
		model: 'gpt-4.1',
		intentId: undefined,
		requestCreatedAt: undefined,
		requestLastUpdated: undefined,
		lastLoggedHash: undefined,
		lastLoggedMatches: undefined,
		forkSessionId: undefined,
		staleReason: undefined,
		restoreOfVersion: undefined,
	};
}
