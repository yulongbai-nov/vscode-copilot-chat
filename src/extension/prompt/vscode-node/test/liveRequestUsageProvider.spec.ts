/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { ILogService } from '../../../../platform/log/common/logService';
import { Emitter } from '../../../../util/vs/base/common/event';
import { ILiveRequestEditorService, LiveRequestMetadataEvent } from '../../common/liveRequestEditorService';
import { LiveRequestUsageProvider } from '../liveRequestUsageProvider';

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
	return {
		...shim,
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

describe('LiveRequestUsageProvider', () => {
	let provider: LiveRequestUsageProvider;
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
			onDidChangeMetadata: metadataEmitter.event
		} as unknown as ILiveRequestEditorService;

		(configurationStub.get as Mock).mockImplementation((section: string) => {
			if (section === 'sessionMetadata.fields') {
				return ['sessionId', 'requestId'];
			}
			return undefined;
		});

		(configurationStub.update as Mock).mockResolvedValue(undefined);

		const extensionUri = vscode.Uri.parse('file:///test');
		provider = new LiveRequestUsageProvider(extensionUri, logService, service);
	});

	test('configure fields updates configuration and local state', async () => {
		(vscode.window.showQuickPick as Mock).mockResolvedValue([
			{ field: 'sessionId' },
			{ field: 'model' }
		]);

		await (provider as any)._configureFields();

		expect(configurationStub.update).toHaveBeenCalledWith(
			'sessionMetadata.fields',
			['sessionId', 'model'],
			vscode.ConfigurationTarget.Global
		);
		expect((provider as any)._fields).toEqual(['sessionId', 'model']);
	});

	test('copy field writes to clipboard and posts acknowledgement', async () => {
		const postMessage = vi.fn();
		(provider as any)._view = {
			webview: {
				postMessage
			}
		};

		await (provider as any)._copyField({ value: 'abc123', label: 'Session', field: 'sessionId' });

		expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('abc123');
		expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith('Session copied to clipboard', 1500);
		expect(postMessage).toHaveBeenCalledWith({
			type: 'copyAck',
			field: 'sessionId',
			label: 'Session'
		});
	});
});
