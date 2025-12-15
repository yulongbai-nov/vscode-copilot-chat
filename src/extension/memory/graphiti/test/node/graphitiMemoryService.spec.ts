/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { beforeEach, afterEach, suite, test, vi } from 'vitest';
import { IAuthenticationService } from '../../../../../platform/authentication/common/authentication';
import { ConfigKey, IConfigurationService } from '../../../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../../../platform/extContext/common/extensionContext';
import { IGitService } from '../../../../../platform/git/common/gitService';
import { ILogService } from '../../../../../platform/log/common/logService';
import { FetchOptions, IFetcherService, IAbortController, PaginationOptions, Response } from '../../../../../platform/networking/common/fetcherService';
import { createFakeResponse } from '../../../../../platform/test/node/fetcher';
import { IWorkspaceService } from '../../../../../platform/workspace/common/workspaceService';
import { IWorkspaceTrustService } from '../../../../../platform/workspace/common/workspaceTrustService';
import { Emitter } from '../../../../../util/vs/base/common/event';
import { GraphitiWorkspaceConsentStorageKey } from '../../common/graphitiConsent';
import { GraphitiMemoryService } from '../../node/graphitiMemoryService';

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

suite('GraphitiMemoryService', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('retries ingestion with backoff after a failure', async () => {
		const endpoint = 'http://graph:8000';
		const configValues = new Map<string, unknown>([
			[ConfigKey.MemoryGraphitiEnabled.fullyQualifiedId, true],
			[ConfigKey.MemoryGraphitiEndpoint.fullyQualifiedId, endpoint],
			[ConfigKey.MemoryGraphitiTimeoutMs.fullyQualifiedId, 1000],
			[ConfigKey.MemoryGraphitiMaxBatchSize.fullyQualifiedId, 10],
			[ConfigKey.MemoryGraphitiMaxQueueSize.fullyQualifiedId, 200],
			[ConfigKey.MemoryGraphitiMaxMessageChars.fullyQualifiedId, 1000],
			[ConfigKey.MemoryGraphitiScopes.fullyQualifiedId, 'session'],
			[ConfigKey.MemoryGraphitiGroupIdStrategy.fullyQualifiedId, 'raw'],
		]);
		const configService = new TestConfigurationService(configValues);

		const workspaceState = new MapMemento();
		await workspaceState.update(GraphitiWorkspaceConsentStorageKey, { version: 1, endpoint, consentedAt: '2025-01-01T00:00:00.000Z' });
		const extensionContext = {
			_serviceBrand: undefined,
			workspaceState,
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

		const gitService = {
			_serviceBrand: undefined,
			activeRepository: { get: () => undefined },
			repositories: [],
		} as unknown as IGitService;

		const fetcher = new SequencedFetcherService([
			createFakeResponse(500, 'Internal Server Error'),
			createFakeResponse(202, { message: 'ok', success: true }),
		]);

		const authenticationService = {
			_serviceBrand: undefined,
			anyGitHubSession: undefined,
		} as unknown as IAuthenticationService;

		const service = new GraphitiMemoryService(
			configService,
			extensionContext,
			authenticationService,
			trustService,
			workspaceService,
			fetcher,
			gitService,
			silentLogService,
		);

		service.enqueueConversationSnapshot('session_1', [
			{ turnId: 'turn_1', userMessage: 'hello', assistantMessage: 'world', timestampMs: Date.parse('2025-01-02T03:04:05.000Z') },
		]);

		// Initial flush timer
		await vi.advanceTimersByTimeAsync(250);
		assert.strictEqual(fetcher.calls.length, 1);
		assert.strictEqual(fetcher.calls[0].url, `${endpoint}/messages`);
		assert.strictEqual(fetcher.calls[0].options.json.group_id, 'copilotchat_session_session_1');
		assert.strictEqual(fetcher.calls[0].options.json.messages[0].content, 'hello');
		assert.strictEqual(fetcher.calls[0].options.json.messages[1].content, 'world');
		assert.strictEqual(typeof fetcher.calls[0].options.json.messages[0].timestamp, 'string');
		assert.strictEqual(typeof fetcher.calls[0].options.json.messages[1].timestamp, 'string');

		// First backoff retry (500ms)
		await vi.advanceTimersByTimeAsync(500);
		assert.strictEqual(fetcher.calls.length, 2);

		service.dispose();
	});

	test('includes git metadata in source_description when enabled', async () => {
		const endpoint = 'http://graph:8000';
		const configValues = new Map<string, unknown>([
			[ConfigKey.MemoryGraphitiEnabled.fullyQualifiedId, true],
			[ConfigKey.MemoryGraphitiEndpoint.fullyQualifiedId, endpoint],
			[ConfigKey.MemoryGraphitiTimeoutMs.fullyQualifiedId, 1000],
			[ConfigKey.MemoryGraphitiMaxBatchSize.fullyQualifiedId, 10],
			[ConfigKey.MemoryGraphitiMaxQueueSize.fullyQualifiedId, 200],
			[ConfigKey.MemoryGraphitiMaxMessageChars.fullyQualifiedId, 1000],
			[ConfigKey.MemoryGraphitiScopes.fullyQualifiedId, 'session'],
			[ConfigKey.MemoryGraphitiGroupIdStrategy.fullyQualifiedId, 'raw'],
			[ConfigKey.MemoryGraphitiIncludeGitMetadata.fullyQualifiedId, true],
		]);
		const configService = new TestConfigurationService(configValues);

		const workspaceState = new MapMemento();
		await workspaceState.update(GraphitiWorkspaceConsentStorageKey, { version: 1, endpoint, consentedAt: '2025-01-01T00:00:00.000Z' });
		const extensionContext = {
			_serviceBrand: undefined,
			workspaceState,
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

		const gitService = {
			_serviceBrand: undefined,
			activeRepository: {
				get: () => ({
					headBranchName: 'main',
					headCommitHash: 'abc123',
					changes: { mergeChanges: [], indexChanges: [], workingTree: [{}], untrackedChanges: [] },
				}),
			},
			repositories: [],
		} as unknown as IGitService;

		const authenticationService = {
			_serviceBrand: undefined,
			anyGitHubSession: undefined,
		} as unknown as IAuthenticationService;

		const fetcher = new SequencedFetcherService([
			createFakeResponse(202, { message: 'ok', success: true }),
		]);

		const service = new GraphitiMemoryService(
			configService,
			extensionContext,
			authenticationService,
			trustService,
			workspaceService,
			fetcher,
			gitService,
			silentLogService,
		);

		service.enqueueConversationSnapshot('session_1', [
			{ turnId: 'turn_1', userMessage: 'hello', assistantMessage: 'world', timestampMs: Date.parse('2025-01-02T03:04:05.000Z') },
		]);

		await vi.advanceTimersByTimeAsync(250);
		assert.strictEqual(fetcher.calls.length, 1);

		const firstMessage = fetcher.calls[0].options.json.messages[0];
		const secondMessage = fetcher.calls[0].options.json.messages[1];
		assert.strictEqual(typeof firstMessage.source_description, 'string');
		assert.strictEqual(typeof secondMessage.source_description, 'string');

		const parsed = JSON.parse(firstMessage.source_description);
		assert.deepStrictEqual(parsed, { source: 'copilotchat', scope: 'session', git: { branch: 'main', commit: 'abc123', dirty: true } });

		service.dispose();
	});

	test('backfills older turns and de-duplicates rehydrated turns', async () => {
		const endpoint = 'http://graph:8000';
		const configValues = new Map<string, unknown>([
			[ConfigKey.MemoryGraphitiEnabled.fullyQualifiedId, true],
			[ConfigKey.MemoryGraphitiEndpoint.fullyQualifiedId, endpoint],
			[ConfigKey.MemoryGraphitiTimeoutMs.fullyQualifiedId, 1000],
			[ConfigKey.MemoryGraphitiMaxBatchSize.fullyQualifiedId, 10],
			[ConfigKey.MemoryGraphitiMaxQueueSize.fullyQualifiedId, 200],
			[ConfigKey.MemoryGraphitiMaxMessageChars.fullyQualifiedId, 1000],
			[ConfigKey.MemoryGraphitiScopes.fullyQualifiedId, 'session'],
			[ConfigKey.MemoryGraphitiGroupIdStrategy.fullyQualifiedId, 'raw'],
		]);
		const configService = new TestConfigurationService(configValues);

		const workspaceState = new MapMemento();
		await workspaceState.update(GraphitiWorkspaceConsentStorageKey, { version: 1, endpoint, consentedAt: '2025-01-01T00:00:00.000Z' });
		const extensionContext = {
			_serviceBrand: undefined,
			workspaceState,
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

		const gitService = {
			_serviceBrand: undefined,
			activeRepository: { get: () => undefined },
			repositories: [],
		} as unknown as IGitService;

		const authenticationService = {
			_serviceBrand: undefined,
			anyGitHubSession: undefined,
		} as unknown as IAuthenticationService;

		const fetcher = new SequencedFetcherService([
			createFakeResponse(202, { message: 'ok', success: true }),
			createFakeResponse(202, { message: 'ok', success: true }),
			createFakeResponse(202, { message: 'ok', success: true }),
		]);

		const service = new GraphitiMemoryService(
			configService,
			extensionContext,
			authenticationService,
			trustService,
			workspaceService,
			fetcher,
			gitService,
			silentLogService,
		);

		const snapshot = [
			{ turnId: 'turn_old', userMessage: 'first', assistantMessage: 'first_response', timestampMs: 1 },
			{ turnId: 'turn_new', userMessage: 'second', assistantMessage: 'second_response', timestampMs: 2 },
		];

		service.enqueueConversationSnapshot('session_1', snapshot);

		await vi.advanceTimersByTimeAsync(2000);

		const callsAfterFirstSnapshot = fetcher.calls.length;
		assert.ok(callsAfterFirstSnapshot > 0);

		const allContents = fetcher.calls.flatMap(call => call.options.json.messages.map((m: any) => m.content));
		assert.ok(allContents.includes('first'));
		assert.ok(allContents.includes('first_response'));
		assert.ok(allContents.includes('second'));
		assert.ok(allContents.includes('second_response'));

		// Re-hydrated / repeated snapshot should not enqueue again for the same group_id.
		service.enqueueConversationSnapshot('session_1', snapshot);
		await vi.advanceTimersByTimeAsync(2000);

		assert.strictEqual(fetcher.calls.length, callsAfterFirstSnapshot);

		service.dispose();
	});

	test('includes an ownership context episode when system messages are enabled', async () => {
		const endpoint = 'http://graph:8000';
		const configValues = new Map<string, unknown>([
			[ConfigKey.MemoryGraphitiEnabled.fullyQualifiedId, true],
			[ConfigKey.MemoryGraphitiEndpoint.fullyQualifiedId, endpoint],
			[ConfigKey.MemoryGraphitiTimeoutMs.fullyQualifiedId, 1000],
			[ConfigKey.MemoryGraphitiMaxBatchSize.fullyQualifiedId, 10],
			[ConfigKey.MemoryGraphitiMaxQueueSize.fullyQualifiedId, 200],
			[ConfigKey.MemoryGraphitiMaxMessageChars.fullyQualifiedId, 1000],
			[ConfigKey.MemoryGraphitiScopes.fullyQualifiedId, 'session'],
			[ConfigKey.MemoryGraphitiGroupIdStrategy.fullyQualifiedId, 'raw'],
			[ConfigKey.MemoryGraphitiIncludeSystemMessages.fullyQualifiedId, true],
		]);
		const configService = new TestConfigurationService(configValues);

		const workspaceState = new MapMemento();
		await workspaceState.update(GraphitiWorkspaceConsentStorageKey, { version: 1, endpoint, consentedAt: '2025-01-01T00:00:00.000Z' });
		const extensionContext = {
			_serviceBrand: undefined,
			workspaceState,
			globalState: new MapMemento(),
		} as unknown as IVSCodeExtensionContext;

		const trustService = {
			_serviceBrand: undefined,
			isTrusted: true,
			onDidGrantWorkspaceTrust: new Emitter<void>().event,
		} satisfies IWorkspaceTrustService;

		const workspaceService = {
			_serviceBrand: undefined,
			getWorkspaceFolders: () => [{ path: '/a/b/repo' }],
		} as unknown as IWorkspaceService;

		const gitService = {
			_serviceBrand: undefined,
			activeRepository: { get: () => undefined },
			repositories: [],
		} as unknown as IGitService;

		const authenticationService = {
			_serviceBrand: undefined,
			anyGitHubSession: { account: { id: 'gh-id-1', label: 'octocat' } },
		} as unknown as IAuthenticationService;

		const fetcher = new SequencedFetcherService([createFakeResponse(202, { message: 'ok', success: true })]);

		const service = new GraphitiMemoryService(
			configService,
			extensionContext,
			authenticationService,
			trustService,
			workspaceService,
			fetcher,
			gitService,
			silentLogService,
		);

		service.enqueueConversationSnapshot('session_1', [
			{ turnId: 'turn_1', userMessage: 'hello', assistantMessage: 'world', timestampMs: Date.parse('2025-01-02T03:04:05.000Z') },
		]);

		await vi.advanceTimersByTimeAsync(250);
		assert.strictEqual(fetcher.calls.length, 1);

		const messages = fetcher.calls[0].options.json.messages;
		assert.strictEqual(messages[0].role_type, 'system');
		assert.ok(String(messages[0].content).includes('<graphiti_episode kind="ownership_context">'));
		assert.ok(String(messages[0].content).includes('scope: session'));
		assert.ok(String(messages[0].content).includes('octocat'));
		assert.ok(String(messages[0].content).includes('Workspace folders (basenames): repo.'));

		service.dispose();
	});
});
