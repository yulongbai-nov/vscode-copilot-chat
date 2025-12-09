/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { ILiveRequestEditorService } from '../../common/liveRequestEditorService';
import { LiveReplayChatProvider } from '../liveReplayChatProvider';
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', 'package.json'), 'utf8')) as {
	contributes?: {
		commands?: Array<{ command: string }>;
		chatSessions?: Array<{ type: string }>;
	};
};

vi.mock('vscode', async () => {
	const shim = await import('../../../../util/common/test/shims/vscodeTypesShim');
	return {
		...shim,
		chat: {
			createChatParticipant: vi.fn().mockReturnValue({}),
			registerChatSessionContentProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			registerChatSessionItemProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		},
		commands: {
			registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			executeCommand: vi.fn(),
		}
	};
});

describe('LiveReplay registration', () => {
	test('registers chat providers and command on construction', () => {
		const instantiationService = { createInstance: vi.fn() } as unknown as IInstantiationService;
		const liveRequestEditorService = {} as unknown as ILiveRequestEditorService;
		const logService = {
			_serviceBrand: undefined,
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			show: vi.fn(),
		};

		new LiveReplayChatProvider(instantiationService, liveRequestEditorService, logService);

		expect(vscode.chat.registerChatSessionContentProvider).toHaveBeenCalledWith(
			'copilot-live-replay',
			expect.anything(),
			expect.anything()
		);
		expect(vscode.chat.registerChatSessionItemProvider).toHaveBeenCalledWith(
			'copilot-live-replay',
			expect.anything()
		);
		expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
			'github.copilot.liveRequestEditor.startReplayChat',
			expect.any(Function)
		);
		expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
			'github.copilot.liveRequestEditor.toggleReplayView',
			expect.any(Function)
		);
	});

	test('manifest declares replay participant, session type, and command', () => {
		const commands = (manifest as any).contributes?.commands ?? [];
		const chatSessions = (manifest as any).contributes?.chatSessions ?? [];

		expect(commands.some((c: any) => c.command === 'github.copilot.liveRequestEditor.startReplayChat')).toBe(true);
		expect(commands.some((c: any) => c.command === 'github.copilot.liveRequestEditor.debugReplaySample')).toBe(true);
		expect(chatSessions.some((s: any) => s.type === 'copilot-live-replay')).toBe(true);
	});
});
