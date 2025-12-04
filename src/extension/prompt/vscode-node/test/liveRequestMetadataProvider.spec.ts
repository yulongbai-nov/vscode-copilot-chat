/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { ILogService } from '../../../../platform/log/common/logService';
import { Emitter } from '../../../../util/vs/base/common/event';
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

	beforeEach(() => {
		vi.clearAllMocks();
		logService = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as unknown as ILogService;

		const metadataEmitter = new Emitter<LiveRequestMetadataEvent>();
		service = {
			_serviceBrand: undefined,
			onDidChangeMetadata: metadataEmitter.event,
			onDidChange: new Emitter().event,
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
});
