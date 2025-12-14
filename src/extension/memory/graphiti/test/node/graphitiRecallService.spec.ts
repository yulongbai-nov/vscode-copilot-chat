/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'vitest';
import { ConfigKey, IConfigurationService } from '../../../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../../../platform/log/common/logService';
import { FetchOptions, IFetcherService, IAbortController, PaginationOptions, Response } from '../../../../../platform/networking/common/fetcherService';
import { createFakeResponse } from '../../../../../platform/test/node/fetcher';
import { IWorkspaceService } from '../../../../../platform/workspace/common/workspaceService';
import { IWorkspaceTrustService } from '../../../../../platform/workspace/common/workspaceTrustService';
import { Emitter } from '../../../../../util/vs/base/common/event';
import { GraphitiWorkspaceConsentStorageKey } from '../../common/graphitiConsent';
import { GraphitiUserScopeKeyStorageKey } from '../../common/graphitiStorageKeys';
import { GraphitiRecallService } from '../../node/graphitiRecallService';

class MapMemento {
	private readonly map = new Map<string, unknown>();

	get<T>(key: string, defaultValue?: T): T {
		if (!this.map.has(key)) {
			return defaultValue as T;
		}
		return this.map.get(key) as T;
	}

	update(key: string, value: unknown): Thenable<void> {
		if (value === undefined) {
			this.map.delete(key);
		} else {
			this.map.set(key, value);
		}
		return Promise.resolve();
	}
}

class TestConfigurationService implements IConfigurationService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidChangeConfiguration = new Emitter<any>();
	readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

	constructor(private readonly values: Map<string, unknown>) { }

	getConfig<T>(key: any): T {
		return (this.values.get(key.fullyQualifiedId) ?? key.defaultValue) as T;
	}

	// Unused members
	getConfigObservable<T>(_key: any): any { throw new Error('not implemented'); }
	inspectConfig<T>(_key: any): any { throw new Error('not implemented'); }
	isConfigured<T>(_key: any): boolean { throw new Error('not implemented'); }
	getNonExtensionConfig<T>(_configKey: string): T | undefined { throw new Error('not implemented'); }
	setConfig<T>(_key: any, _value: T): Thenable<void> { throw new Error('not implemented'); }
	getExperimentBasedConfig<T>(_key: any): T { throw new Error('not implemented'); }
	getExperimentBasedConfigObservable<T>(_key: any): any { throw new Error('not implemented'); }
	getConfigMixedWithDefaults<T>(_key: any): T { throw new Error('not implemented'); }
	getDefaultValue<T>(_key: any): T { throw new Error('not implemented'); }
	updateExperimentBasedConfiguration(_treatments: string[]): void { throw new Error('not implemented'); }
	dumpConfig(): { [key: string]: string } { throw new Error('not implemented'); }
}

class SequencedFetcherService implements IFetcherService {
	declare readonly _serviceBrand: undefined;

	public calls: Array<{ url: string; options: FetchOptions }> = [];
	constructor(private readonly responses: Response[]) { }

	getUserAgentLibrary(): string {
		return 'test-stub';
	}

	fetch(url: string, options: FetchOptions): Promise<Response> {
		this.calls.push({ url, options });
		const next = this.responses.shift();
		if (!next) {
			throw new Error('No more responses configured');
		}
		return Promise.resolve(next);
	}

	// Unused members
	disconnectAll(): Promise<unknown> { throw new Error('not implemented'); }
	makeAbortController(): IAbortController { return new AbortController(); }
	isAbortError(_e: any): boolean { return false; }
	isInternetDisconnectedError(_e: any): boolean { throw new Error('not implemented'); }
	isFetcherError(_e: any): boolean { throw new Error('not implemented'); }
	getUserMessageForFetcherError(_err: any): string { throw new Error('not implemented'); }
	fetchWithPagination<T>(_baseUrl: string, _options: PaginationOptions<T>): Promise<T[]> { throw new Error('not implemented'); }
}

const silentLogService: ILogService = {
	_serviceBrand: undefined,
	trace: () => { },
	debug: () => { },
	info: () => { },
	warn: () => { },
	error: () => { },
	show: () => { },
};

suite('GraphitiRecallService', () => {
	test('merges facts in scope order and caps output', async () => {
		const endpoint = 'http://graph:8000';
		const configValues = new Map<string, unknown>([
			[ConfigKey.MemoryGraphitiEnabled.fullyQualifiedId, true],
			[ConfigKey.MemoryGraphitiEndpoint.fullyQualifiedId, endpoint],
			[ConfigKey.MemoryGraphitiGroupIdStrategy.fullyQualifiedId, 'raw'],
			[ConfigKey.MemoryGraphitiRecallEnabled.fullyQualifiedId, true],
			[ConfigKey.MemoryGraphitiRecallTimeoutMs.fullyQualifiedId, 1000],
			[ConfigKey.MemoryGraphitiRecallMaxFacts.fullyQualifiedId, 3],
			[ConfigKey.MemoryGraphitiRecallScopes.fullyQualifiedId, 'all'],
		]);
		const configService = new TestConfigurationService(configValues);

		const workspaceState = new MapMemento();
		await workspaceState.update(GraphitiWorkspaceConsentStorageKey, { version: 1, endpoint, consentedAt: '2025-01-01T00:00:00.000Z' });
		const globalState = new MapMemento();
		await globalState.update(GraphitiUserScopeKeyStorageKey, 'user-key-1');

		const extensionContext = {
			_serviceBrand: undefined,
			workspaceState,
			globalState,
		} as unknown as IVSCodeExtensionContext;

		const trustService = {
			_serviceBrand: undefined,
			isTrusted: true,
			onDidGrantWorkspaceTrust: new Emitter<void>().event,
		} satisfies IWorkspaceTrustService;

		const workspaceService = {
			_serviceBrand: undefined,
			getWorkspaceFolders: () => [],
		} as unknown as IWorkspaceService;

		const fetcher = new SequencedFetcherService([
			createFakeResponse(200, {
				facts: [
					{ uuid: 'dup', name: 'n', fact: 'duplicate', created_at: '2025-01-01T00:00:00.000Z' },
				]
			}),
			createFakeResponse(200, {
				facts: [
					{ uuid: 'dup', name: 'n', fact: 'duplicate', created_at: '2025-01-01T00:00:00.000Z' },
					{ uuid: 'w1', name: 'n', fact: 'workspace', created_at: '2025-01-01T00:00:00.000Z' },
				]
			}),
			createFakeResponse(200, {
				facts: [
					{ uuid: 'u1', name: 'n', fact: 'user', created_at: '2025-01-01T00:00:00.000Z' },
				]
			}),
		]);

		const svc = new GraphitiRecallService(configService, extensionContext, trustService, workspaceService, fetcher, silentLogService);
		const facts = await svc.recallFacts({ sessionId: 'session_1', query: 'how do we build' });

		assert.deepStrictEqual(facts.map(f => [f.scope, f.fact.fact]), [
			['session', 'duplicate'],
			['workspace', 'workspace'],
			['user', 'user'],
		]);

		assert.strictEqual(fetcher.calls.length, 3);
		assert.strictEqual(fetcher.calls[0].url, `${endpoint}/search`);
		assert.deepStrictEqual(fetcher.calls[0].options.json.group_ids, ['copilotchat_session_session_1']);
		assert.deepStrictEqual(fetcher.calls[1].options.json.group_ids, ['copilotchat_workspace_no-workspace-folders']);
		assert.deepStrictEqual(fetcher.calls[2].options.json.group_ids, ['copilotchat_user_user-key-1']);
	});

	test('does not call Graphiti when recall is disabled', async () => {
		const endpoint = 'http://graph:8000';
		const configValues = new Map<string, unknown>([
			[ConfigKey.MemoryGraphitiEnabled.fullyQualifiedId, true],
			[ConfigKey.MemoryGraphitiEndpoint.fullyQualifiedId, endpoint],
			[ConfigKey.MemoryGraphitiGroupIdStrategy.fullyQualifiedId, 'raw'],
			[ConfigKey.MemoryGraphitiRecallEnabled.fullyQualifiedId, false],
		]);
		const configService = new TestConfigurationService(configValues);
		const extensionContext = {
			_serviceBrand: undefined,
			workspaceState: new MapMemento(),
			globalState: new MapMemento(),
		} as unknown as IVSCodeExtensionContext;

		const trustService = {
			_serviceBrand: undefined,
			isTrusted: true,
			onDidGrantWorkspaceTrust: new Emitter<void>().event,
		} satisfies IWorkspaceTrustService;

		const workspaceService = {
			_serviceBrand: undefined,
			getWorkspaceFolders: () => [],
		} as unknown as IWorkspaceService;

		const fetcher = new SequencedFetcherService([]);
		const svc = new GraphitiRecallService(configService, extensionContext, trustService, workspaceService, fetcher, silentLogService);
		const facts = await svc.recallFacts({ sessionId: 's', query: 'q' });
		assert.deepStrictEqual(facts, []);
		assert.strictEqual(fetcher.calls.length, 0);
	});
});
