/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test, vi } from 'vitest';
import { ILogService } from '../../../../../platform/log/common/logService';
import { FetchOptions, IAbortController, IFetcherService, PaginationOptions, Response } from '../../../../../platform/networking/common/fetcherService';
import { createFakeResponse } from '../../../../../platform/test/node/fetcher';
import { GraphitiClient } from '../../node/graphitiClient';
import { GraphitiMessage } from '../../node/graphitiTypes';

suite('GraphitiClient', () => {
	class CapturingFetcherService implements IFetcherService {
		declare readonly _serviceBrand: undefined;
		public lastUrl: string | undefined;
		public lastOptions: FetchOptions | undefined;
		public nextResponse: Response = createFakeResponse(200, { status: 'healthy' });

		getUserAgentLibrary(): string {
			return 'test-stub';
		}
		fetch(url: string, options: FetchOptions): Promise<Response> {
			this.lastUrl = url;
			this.lastOptions = options;
			return Promise.resolve(this.nextResponse);
		}
		disconnectAll(): Promise<unknown> {
			throw new Error('Method not implemented.');
		}
		makeAbortController(): IAbortController {
			return new AbortController();
		}
		isAbortError(_e: any): boolean {
			return false;
		}
		isInternetDisconnectedError(_e: any): boolean {
			throw new Error('Method not implemented.');
		}
		isFetcherError(_e: any): boolean {
			throw new Error('Method not implemented.');
		}
		getUserMessageForFetcherError(_err: any): string {
			throw new Error('Method not implemented.');
		}
		fetchWithPagination<T>(_baseUrl: string, _options: PaginationOptions<T>): Promise<T[]> {
			throw new Error('Method not implemented.');
		}
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

	test('healthcheck uses GET /healthcheck', async () => {
		const fetcher = new CapturingFetcherService();
		fetcher.nextResponse = createFakeResponse(200, { status: 'healthy' });
		const client = new GraphitiClient(fetcher, silentLogService, { endpoint: 'http://graph:8000/', timeoutMs: 1234 });

		const res = await client.healthcheck();
		assert.strictEqual(res.status, 'healthy');
		assert.strictEqual(fetcher.lastUrl, 'http://graph:8000/healthcheck');
		assert.strictEqual(fetcher.lastOptions?.method, 'GET');
		assert.strictEqual(fetcher.lastOptions?.timeout, 1234);
		assert.ok(fetcher.lastOptions?.signal);
	});

	test('addMessages uses POST /messages with JSON body', async () => {
		const fetcher = new CapturingFetcherService();
		fetcher.nextResponse = createFakeResponse(202, { message: 'ok', success: true });
		const client = new GraphitiClient(fetcher, silentLogService, { endpoint: 'http://graph:8000', timeoutMs: 5000 });

		const messages: GraphitiMessage[] = [{ role_type: 'user', role: '', content: 'hello' }];
		const res = await client.addMessages('group_1', messages);

		assert.strictEqual(res.success, true);
		assert.strictEqual(fetcher.lastUrl, 'http://graph:8000/messages');
		assert.strictEqual(fetcher.lastOptions?.method, 'POST');
		assert.deepStrictEqual(fetcher.lastOptions?.json, { group_id: 'group_1', messages });
	});

	test('deleteGroup uses DELETE /group/{group_id}', async () => {
		const fetcher = new CapturingFetcherService();
		fetcher.nextResponse = createFakeResponse(200, { message: 'Group deleted', success: true });
		const client = new GraphitiClient(fetcher, silentLogService, { endpoint: 'http://graph:8000', timeoutMs: 5000 });

		const res = await client.deleteGroup('group_1');
		assert.strictEqual(res.success, true);
		assert.strictEqual(fetcher.lastUrl, 'http://graph:8000/group/group_1');
		assert.strictEqual(fetcher.lastOptions?.method, 'DELETE');
	});

	test('getEpisodes uses GET /episodes/{group_id}?last_n=...', async () => {
		const fetcher = new CapturingFetcherService();
		fetcher.nextResponse = createFakeResponse(200, []);
		const client = new GraphitiClient(fetcher, silentLogService, { endpoint: 'http://graph:8000', timeoutMs: 5000 });

		const res = await client.getEpisodes('group_1', 5);
		assert.deepStrictEqual(res, []);
		assert.strictEqual(fetcher.lastUrl, 'http://graph:8000/episodes/group_1?last_n=5');
		assert.strictEqual(fetcher.lastOptions?.method, 'GET');
	});

	test('non-2xx response throws', async () => {
		const fetcher = new CapturingFetcherService();
		fetcher.nextResponse = createFakeResponse(500, 'Internal Server Error');
		const client = new GraphitiClient(fetcher, silentLogService, { endpoint: 'http://graph:8000', timeoutMs: 5000 });

		await assert.rejects(() => client.healthcheck());
	});

	test('timeout aborts requests', async () => {
		vi.useFakeTimers();
		try {
			class HangingFetcherService implements IFetcherService {
				declare readonly _serviceBrand: undefined;
				getUserAgentLibrary(): string {
					return 'test-stub';
				}
				fetch(_url: string, options: FetchOptions): Promise<Response> {
					return new Promise((_resolve, reject) => {
						options.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
					});
				}
				disconnectAll(): Promise<unknown> {
					throw new Error('Method not implemented.');
				}
				makeAbortController(): IAbortController {
					return new AbortController();
				}
				isAbortError(_e: any): boolean {
					return false;
				}
				isInternetDisconnectedError(_e: any): boolean {
					return false;
				}
				isFetcherError(_e: any): boolean {
					return false;
				}
				getUserMessageForFetcherError(_err: any): string {
					return '';
				}
				fetchWithPagination<T>(_baseUrl: string, _options: PaginationOptions<T>): Promise<T[]> {
					throw new Error('Method not implemented.');
				}
			}

			const fetcher = new HangingFetcherService();
			const client = new GraphitiClient(fetcher, silentLogService, { endpoint: 'http://graph:8000', timeoutMs: 10 });

			const promise = client.healthcheck();
			promise.catch(() => { }); // prevent unhandled rejection warning
			await vi.advanceTimersByTimeAsync(10);
			await assert.rejects(promise);
		} finally {
			vi.useRealTimers();
		}
	});
});
