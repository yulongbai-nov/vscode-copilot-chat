/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as vscode from 'vscode';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { LiveRequestEditorContribution } from '../liveRequestEditorContribution';
import { LiveRequestReplaySessionProvider } from '../liveRequestReplaySessionProvider';

// This “simulation” test wires up the replay provider + command and
// drives them end-to-end using the vscode shims, without hitting real chat UI.

const registeredProviders: vscode.ChatSessionContentProvider[] = [];
const registeredParticipantHandlers: Array<(req: any, ctx: any, stream: any) => any> = [];

vi.mock('vscode', async () => {
	const shim = await import('../../../../util/common/test/shims/vscodeTypesShim');
	return {
		...shim,
		commands: {
			registerCommand: vi.fn(),
			executeCommand: vi.fn(),
			getCommands: vi.fn().mockResolvedValue(['github.copilot.liveRequestEditor.focus'])
		},
		chat: {
			createChatParticipant: vi.fn().mockImplementation((_id, handler) => {
				registeredParticipantHandlers.push(handler);
				return {};
			}),
			registerChatSessionContentProvider: vi.fn().mockImplementation((_scheme, provider) => {
				registeredProviders.push(provider);
				return { dispose: vi.fn() };
			})
		},
		window: {
			registerWebviewViewProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			registerTreeDataProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			createStatusBarItem: vi.fn().mockReturnValue({
				show: vi.fn(),
				hide: vi.fn(),
				dispose: vi.fn(),
				text: ''
			}),
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			showErrorMessage: vi.fn()
		},
		workspace: {
			getConfiguration: vi.fn().mockReturnValue({ get: vi.fn(), update: vi.fn(), inspect: vi.fn() }),
			onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() })
		},
		env: {
			clipboard: { writeText: vi.fn() }
		},
		StatusBarAlignment: { Left: 1, Right: 2 },
		ThemeIcon: class ThemeIcon { id: string; constructor(id: string) { this.id = id; } },
		TreeItem: class TreeItem { },
		TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
	};
});

describe('LiveRequestReplay simulation', () => {
	beforeAll(() => {
		const contribution = createContribution();
		expect(contribution).toBeDefined();
	});

	test('opens replay content for existing request', async () => {
		const provider = registeredProviders.find(p => p instanceof LiveRequestReplaySessionProvider);
		expect(provider).toBeDefined();

		const uri = buildReplayUri({
			sessionId: 'session-abc',
			location: ChatLocation.Panel,
			requestId: 'req-123',
			debugName: 'dbg'
		});

		const session = provider!.provideChatSessionContent(uri, {} as any);
		expect(session.history.length).toBeGreaterThan(0);
	});
});

function buildReplayUri(ctx: { sessionId: string; location: ChatLocation; requestId?: string; debugName?: string }): vscode.Uri {
	const query = new URLSearchParams({
		sessionId: ctx.sessionId,
		location: String(ctx.location),
		requestId: ctx.requestId ?? '',
		debugName: ctx.debugName ?? '',
		sessionKey: `${ctx.sessionId}::${ctx.location}`
	}).toString();

	return vscode.Uri.from({
		scheme: LiveRequestReplaySessionProvider.scheme,
		path: `/replay/${encodeURIComponent(ctx.sessionId)}`,
		query
	});
}

function createContribution(): LiveRequestEditorContribution {
	const liveRequestEditorService = {
		_serviceBrand: undefined,
		onDidChange: vi.fn() as any,
		onDidRemoveRequest: vi.fn() as any,
		onDidUpdateSubagentHistory: vi.fn() as any,
		onDidChangeInterception: vi.fn().mockReturnValue({ dispose: vi.fn() }) as any,
		onDidChangeMetadata: vi.fn() as any,
		isEnabled: () => true,
		isInterceptionEnabled: () => false,
		getRequest: () => ({
			id: 'request-id',
			sessionId: 'session-abc',
			location: ChatLocation.Panel,
			debugName: 'dbg',
			model: 'gpt',
			isSubagent: false,
			messages: [],
			originalMessages: [],
			sections: [],
			metadata: { requestId: 'req-123', createdAt: Date.now() },
			isDirty: false
		}),
		prepareRequest: vi.fn(),
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
		getMetadataSnapshot: vi.fn()
	};

	const configurationService = {
		_serviceBrand: undefined,
		getConfig: vi.fn((key: any) => key === 'chat.liveRequestEditor.timelineReplay.enabled' ? true : false),
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

	const telemetry = { sendMSFTTelemetryEvent: vi.fn() };

	// Avoid constructing the webview/metadata providers; focus on replay provider wiring.
	const proto = LiveRequestEditorContribution.prototype as any;
	const originalRegisterProvider = proto._registerProvider;
	const originalRegisterMetadataProvider = proto._registerMetadataProvider;
	proto._registerProvider = vi.fn();
	proto._registerMetadataProvider = vi.fn();

	const log = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
	const instantiationService = {
		createInstance: (Ctor: any, ...args: any[]) => {
			if (Ctor === LiveRequestReplaySessionProvider) {
				return new LiveRequestReplaySessionProvider(liveRequestEditorService as any, log as any);
			}
			return new (Ctor as any)(...args);
		}
	};

	const contribution = new LiveRequestEditorContribution(
		instantiationService as any,
		log,
		configurationService as any,
		{ extensionUri: vscode.Uri.parse('file:///tmp'), extension: {} as any } as any,
		liveRequestEditorService as any,
		telemetry as any
	);

	// Restore to avoid leaking stubs if other tests run
	proto._registerProvider = originalRegisterProvider;
	proto._registerMetadataProvider = originalRegisterMetadataProvider;

	return contribution;
}
