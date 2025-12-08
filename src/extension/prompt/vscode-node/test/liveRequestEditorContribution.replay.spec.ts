/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as vscode from 'vscode';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../../platform/log/common/logService';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { LiveRequestSection, EditableChatRequest } from '../../common/liveRequestEditorModel';
import { ILiveRequestEditorService } from '../../common/liveRequestEditorService';
import { LiveRequestEditorContribution } from '../liveRequestEditorContribution';

const commandRegistry = new Map<string, (...args: any[]) => any>();

vi.mock('vscode', async () => {
	const shim = await import('../../../../util/common/test/shims/vscodeTypesShim');
	return {
		...shim,
		ThemeIcon: class ThemeIcon {
			id: string;
			constructor(id: string) {
				this.id = id;
			}
		},
		TreeItem: class TreeItem {
			label?: string;
			collapsibleState?: number;
			iconPath?: any;
			constructor(label?: string, collapsibleState?: number) {
				this.label = label;
				this.collapsibleState = collapsibleState;
			}
		},
		TreeItemCollapsibleState: {
			None: 0,
			Collapsed: 1,
			Expanded: 2
		},
		StatusBarAlignment: { Left: 1, Right: 2 },
		ConfigurationTarget: { Global: 2, Workspace: 1, WorkspaceFolder: 3 },
		commands: {
			registerCommand: (id: string, cb: (...args: any[]) => any) => {
				commandRegistry.set(id, cb);
				return { dispose: vi.fn() };
			},
			executeCommand: vi.fn(),
		},
		workspace: {
			getConfiguration: vi.fn().mockReturnValue({ get: vi.fn(), update: vi.fn(), inspect: vi.fn() }),
			onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() })
		},
		window: {
			registerWebviewViewProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			registerTreeDataProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			createStatusBarItem: vi.fn().mockReturnValue({
				show: vi.fn(),
				hide: vi.fn(),
				dispose: vi.fn(),
				text: '',
				tooltip: undefined
			}),
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			showErrorMessage: vi.fn()
		},
		chat: {
			createChatParticipant: vi.fn().mockReturnValue({}),
			registerChatSessionContentProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		},
	};
});

describe('LiveRequestEditorContribution replay command', () => {
	const disposables = new DisposableStore();
	let contribution: LiveRequestEditorContribution;
	let liveRequestEditorService: ILiveRequestEditorService;
	let configurationService: IConfigurationService;
	let telemetry: { sendMSFTTelemetryEvent: ReturnType<typeof vi.fn> };
	let replayEnabled = true;

	beforeEach(() => {
		commandRegistry.clear();
		disposables.clear();
		(vscode.commands.executeCommand as any as ReturnType<typeof vi.fn>).mockClear?.();
		(vscode.window.showInformationMessage as any as ReturnType<typeof vi.fn>).mockClear?.();
		const fakeRequest = createRequest();
		liveRequestEditorService = {
			_serviceBrand: undefined,
			onDidChange: vi.fn() as any,
			onDidRemoveRequest: vi.fn() as any,
			onDidUpdateSubagentHistory: vi.fn() as any,
			onDidChangeInterception: vi.fn().mockReturnValue({ dispose: vi.fn() }) as any,
			onDidChangeMetadata: vi.fn() as any,
			isEnabled: () => true,
			isInterceptionEnabled: () => false,
			prepareRequest: vi.fn(),
			getRequest: key => key.sessionId === fakeRequest.sessionId ? fakeRequest : undefined,
			updateSectionContent: vi.fn(),
			deleteSection: vi.fn(),
			restoreSection: vi.fn(),
			resetRequest: vi.fn(),
			updateTokenCounts: vi.fn(),
			applyTraceData: vi.fn(),
			updateRequestOptions: vi.fn(),
			getMessagesForSend: vi.fn(),
			getInterceptionState: () => ({ enabled: false, mode: 'off', paused: false }),
			setMode: vi.fn(),
			getMode: () => 'off',
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

		configurationService = {
			_serviceBrand: undefined,
			getConfig: vi.fn((key: any) => key === ConfigKey.LiveRequestEditorTimelineReplayEnabled ? replayEnabled : false) as any,
			getConfigObservable: vi.fn(),
			inspectConfig: vi.fn(),
			isConfigured: vi.fn(),
			getNonExtensionConfig: vi.fn(),
			setConfig: vi.fn(),
			getExperimentBasedConfig: vi.fn(),
			getExperimentBasedConfigObservable: vi.fn(),
			getConfigMixedWithDefaults: vi.fn(),
			getDefaultValue: vi.fn(),
			onDidChangeConfiguration: vi.fn() as any,
			updateExperimentBasedConfiguration: vi.fn(),
			dumpConfig: vi.fn(),
		};

		telemetry = { sendMSFTTelemetryEvent: vi.fn() };

		// avoid side effects from constructor-registered methods
		const proto = LiveRequestEditorContribution.prototype as any;
		const originalRegisterProvider = proto._registerProvider;
		const originalRegisterMetadata = proto._registerMetadataProvider;
		const originalRegisterReplay = proto._registerReplayProvider;
		proto._registerProvider = vi.fn();
		proto._registerMetadataProvider = vi.fn();
		proto._registerReplayProvider = vi.fn();

		contribution = new LiveRequestEditorContribution(
			{
				createInstance: vi.fn()
			} as any,
			createLog(),
			configurationService,
			{ extensionUri: vscode.Uri.parse('file:///tmp'), extension: {} as any } as any,
			liveRequestEditorService,
			telemetry as any
		);

		// restore prototype to avoid leaking stubs
		proto._registerProvider = originalRegisterProvider;
		proto._registerMetadataProvider = originalRegisterMetadata;
		proto._registerReplayProvider = originalRegisterReplay;

		// Inject a stub provider for current request lookup
		(contribution as any)._provider = {
			getCurrentRequest: () => fakeRequest,
			show: vi.fn()
		};
	});

	test('replay command opens a replay URI with session metadata', async () => {
		const cmd = commandRegistry.get('github.copilot.liveRequestEditor.replayPrompt');
		expect(cmd).toBeTruthy();

		await cmd?.();

		const calls = (vscode.commands.executeCommand as any as ReturnType<typeof vi.fn>).mock.calls;
		const executed = calls.find(call => call[0] === 'vscode.open');
		expect(executed).toBeTruthy();
		const uri = executed![1] as vscode.Uri;
		expect(uri.scheme).toBe('copilot-live-replay');
		expect(decodeURIComponent(uri.path)).toContain('session-123');
		expect(uri.query).toContain('sessionKey=session-123%3A%3A1');
		expect(telemetry.sendMSFTTelemetryEvent).toHaveBeenCalledWith('liveRequestEditor.replayPrompt', expect.objectContaining({
			location: String(ChatLocation.Panel),
			model: 'gpt'
		}));
	});

	test('replay command is gated by configuration flag', async () => {
		replayEnabled = false;
		const cmd = commandRegistry.get('github.copilot.liveRequestEditor.replayPrompt');
		expect(cmd).toBeTruthy();

		await cmd?.();

		// Should not open the chat view
		const calls = (vscode.commands.executeCommand as any as ReturnType<typeof vi.fn>).mock.calls;
		expect(calls.find(call => call[0] === 'vscode.open')).toBeUndefined();
		expect(vscode.window.showInformationMessage).toHaveBeenCalled();
	});

	test('replay command bails when no request is available', async () => {
		replayEnabled = true;
		(contribution as any)._provider = {
			getCurrentRequest: () => undefined,
			show: vi.fn()
		};

		const cmd = commandRegistry.get('github.copilot.liveRequestEditor.replayPrompt');
		expect(cmd).toBeTruthy();

		await cmd?.();

		const calls = (vscode.commands.executeCommand as any as ReturnType<typeof vi.fn>).mock.calls;
		expect(calls.find(call => call[0] === 'vscode.open')).toBeUndefined();
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No edited prompt available to replay.');
	});

	function createRequest(): EditableChatRequest {
		return {
			id: 'request-id',
			sessionId: 'session-123',
			location: ChatLocation.Panel,
			debugName: 'dbg',
			model: 'gpt',
			isSubagent: false,
			messages: [],
			originalMessages: [],
			sections: [section('user', 'hello', 0)],
			metadata: {
				requestId: 'req-1',
				createdAt: Date.now()
			},
			isDirty: false
		};
	}

	function section(kind: LiveRequestSection['kind'], content: string, index: number): LiveRequestSection {
		return {
			id: `${kind}-${index}`,
			kind,
			label: `${kind}-${index}`,
			content,
			originalContent: content,
			collapsed: false,
			editable: true,
			deletable: true,
			sourceMessageIndex: index
		};
	}

	function createLog(): ILogService {
		return {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as unknown as ILogService;
	}
});
