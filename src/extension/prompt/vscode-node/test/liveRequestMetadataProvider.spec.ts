/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { ILogService } from '../../../../platform/log/common/logService';
import { Emitter } from '../../../../util/vs/base/common/event';
import { EditableChatRequest } from '../../common/liveRequestEditorModel';
import { ILiveRequestEditorService, LiveRequestMetadataEvent } from '../../common/liveRequestEditorService';
import { LiveRequestMetadataProvider } from '../liveRequestMetadataProvider';

type ConfigStub = {
	get: Mock;
	update: Mock;
	inspect: Mock;
};

const { configurationStub } = vi.hoisted(() => {
	const stub: ConfigStub = {
		get: vi.fn(),
		update: vi.fn(),
		inspect: vi.fn().mockReturnValue({})
	};
	return { configurationStub: stub };
});

vi.mock('vscode', async () => {
	const shim = await import('../../../../util/common/test/shims/vscodeTypesShim');
	const onDidChangeConfiguration = vi.fn().mockReturnValue({ dispose: vi.fn() });
	const configurationTarget = { Global: 2, Workspace: 1, WorkspaceFolder: 3 };
	class ThemeIcon {
		id: string;
		constructor(id: string) {
			this.id = id;
		}
	}

	class TreeItem {
		label?: string;
		collapsibleState?: number;
		constructor(label?: string, collapsibleState?: number) {
			this.label = label;
			this.collapsibleState = collapsibleState;
		}
	}

	const TreeItemCollapsibleState = {
		None: 0,
		Collapsed: 1,
		Expanded: 2
	};

	return {
		...shim,
		ThemeIcon,
		TreeItem,
		TreeItemCollapsibleState,
		ConfigurationTarget: configurationTarget,
		workspace: {
			getConfiguration: vi.fn().mockReturnValue(configurationStub),
			onDidChangeConfiguration
		},
		window: {
			showQuickPick: vi.fn(),
			setStatusBarMessage: vi.fn(),
			showErrorMessage: vi.fn()
		},
		env: {
			clipboard: {
				writeText: vi.fn()
			}
		}
	};
});

describe('LiveRequestMetadataProvider', () => {
	let provider: LiveRequestMetadataProvider;
	let logService: ILogService;
	let service: ILiveRequestEditorService;
	let metadataEmitter: Emitter<LiveRequestMetadataEvent>;
	let requestEmitter: Emitter<EditableChatRequest>;

	beforeEach(() => {
		vi.clearAllMocks();
		logService = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as unknown as ILogService;

		metadataEmitter = new Emitter<LiveRequestMetadataEvent>();
		requestEmitter = new Emitter<EditableChatRequest>();
		service = {
			_serviceBrand: undefined,
			onDidChangeMetadata: metadataEmitter.event,
			onDidChange: requestEmitter.event,
			onDidRemoveRequest: new Emitter().event
		} as unknown as ILiveRequestEditorService;

		(configurationStub.get as Mock).mockImplementation((section: string) => {
			if (section === 'sessionMetadata.fields') {
				return ['sessionId', 'requestId'];
			}
			if (section === 'extraSections') {
				return ['requestOptions', 'rawRequest'];
			}
			return undefined;
		});

		(configurationStub.update as Mock).mockResolvedValue(undefined);

		provider = new LiveRequestMetadataProvider(logService, service);
	});

	test('configure fields updates configuration and local state', async () => {
		(vscode.window.showQuickPick as Mock).mockResolvedValue([
			{ field: 'sessionId' },
			{ field: 'model' }
		]);

		await provider.configureFields();

		expect(configurationStub.update).toHaveBeenCalledWith(
			'sessionMetadata.fields',
			['sessionId', 'model'],
			vscode.ConfigurationTarget.Global
		);
		expect((provider as any)._fields).toEqual(['sessionId', 'model']);
	});

	test('copy value writes to clipboard and shows status message', async () => {
		await provider.copyValue('abc123', 'Session');
		expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('abc123');
		expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith('Session copied to clipboard', 1500);
	});

	test('getChildren returns placeholder when no metadata present', () => {
		const children = provider.getChildren();
		expect(children).toHaveLength(1);
		expect(children[0].label).toContain('Live Request Editor idle');
	});

	test('request options outline renders sampling parameters', () => {
		const key = { sessionId: 'session', location: ChatLocation.Panel };
		const request: EditableChatRequest = {
			id: 'req',
			sessionId: key.sessionId,
			location: key.location,
			debugName: 'debug',
			model: 'gpt',
			messages: [],
			sections: [],
			originalMessages: [],
			isDirty: false,
			metadata: {
				requestId: 'req',
				createdAt: Date.now(),
				tokenCount: 10,
				maxPromptTokens: 1000,
				modelFamily: 'gpt',
				requestOptions: {
					temperature: 0.2,
					top_p: 0.9,
					n: 1,
					tools: []
				}
			}
		};
		requestEmitter.fire(request);
		metadataEmitter.fire({
			key,
			metadata: {
				sessionId: key.sessionId,
				location: key.location,
				requestId: 'req',
				debugName: 'debug',
				model: 'gpt',
				isDirty: false,
				createdAt: Date.now(),
				lastUpdated: Date.now(),
				interceptionState: 'idle',
				tokenCount: 10,
				maxPromptTokens: 1000
			}
		});

		const roots = provider.getChildren();
		const requestOptionsRoot = roots.find(root => root.label === 'Request Options');
		expect(requestOptionsRoot).toBeDefined();
		const outlineChildren = provider.getChildren(requestOptionsRoot as vscode.TreeItem);
		const labels = outlineChildren.map(child => child.label);
		expect(labels).toEqual(expect.arrayContaining(['temperature', 'top_p', 'n']));
	});

	test('renders parity warning when hashes mismatch', () => {
		const key = { sessionId: 'session', location: ChatLocation.Panel };
		const request: EditableChatRequest = {
			id: 'req',
			sessionId: key.sessionId,
			location: key.location,
			debugName: 'debug',
			model: 'gpt',
			messages: [],
			sections: [],
			originalMessages: [],
			isDirty: false,
			metadata: {
				requestId: 'req',
				createdAt: Date.now(),
			}
		};
		requestEmitter.fire(request);
		metadataEmitter.fire({
			key,
			metadata: {
				sessionId: key.sessionId,
				location: key.location,
				requestId: 'req',
				debugName: 'debug',
				model: 'gpt',
				isDirty: false,
				createdAt: Date.now(),
				lastUpdated: Date.now(),
				interceptionState: 'idle',
				parityStatus: 'mismatch',
				payloadHash: 111,
				lastLoggedHash: 222
			}
		});

		const roots = provider.getChildren();
		const warning = roots.find(root => root.contextValue === 'copilotLiveRequestMetadataParityWarning');
		expect(warning).toBeDefined();
		expect(warning?.description).toContain('111');
		expect(warning?.description).toContain('222');
	});
});
