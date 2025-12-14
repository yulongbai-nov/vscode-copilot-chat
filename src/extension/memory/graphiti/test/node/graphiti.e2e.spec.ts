/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { ILogService } from '../../../../../platform/log/common/logService';
import { FetchOptions, IAbortController, IFetcherService, PaginationOptions, Response } from '../../../../../platform/networking/common/fetcherService';
import { GraphitiClient } from '../../node/graphitiClient';

const RUN_GRAPHITI_E2E = process.env['GRAPHITI_E2E'] === '1' && !process.env['CI'];
const GRAPHITI_ENDPOINT = process.env['GRAPHITI_ENDPOINT'] ?? 'http://graph:8000';

class RealFetcherService implements IFetcherService {
	declare readonly _serviceBrand: undefined;

	getUserAgentLibrary(): string {
		return 'node-fetch';
	}

	async fetch(url: string, options: FetchOptions): Promise<Response> {
		if (!globalThis.fetch) {
			throw new Error('globalThis.fetch is not available in this environment.');
		}

		const headers = new Headers(options.headers ?? {});
		let body: string | undefined = options.body;
		if (options.json !== undefined) {
			if (body !== undefined) {
				throw new Error(`Illegal arguments! Cannot pass in both 'body' and 'json'!`);
			}
			headers.set('Content-Type', 'application/json');
			body = JSON.stringify(options.json);
		}

		const method = (options.method ?? 'GET') as string;
		const resp = await fetch(url, { method, headers, body, signal: options.signal as unknown as AbortSignal });

		return new Response(
			resp.status,
			resp.statusText,
			resp.headers,
			() => resp.text(),
			() => resp.json(),
			async () => resp.body,
			'node-fetch',
		);
	}

	disconnectAll(): Promise<unknown> {
		return Promise.resolve();
	}

	makeAbortController(): IAbortController {
		return new AbortController();
	}

	isAbortError(e: any): boolean {
		return e?.name === 'AbortError';
	}

	isInternetDisconnectedError(_e: any): boolean {
		return false;
	}

	isFetcherError(_e: any): boolean {
		return false;
	}

	getUserMessageForFetcherError(err: any): string {
		return String(err);
	}

	fetchWithPagination<T>(_baseUrl: string, _options: PaginationOptions<T>): Promise<T[]> {
		throw new Error('Not implemented');
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

describe.runIf(RUN_GRAPHITI_E2E)('Graphiti E2E smoke (real service)', { timeout: 60_000 }, () => {
	it('ingests, searches, and cleans up a group', async () => {
		const fetcher = new RealFetcherService();
		const client = new GraphitiClient(fetcher, silentLogService, { endpoint: GRAPHITI_ENDPOINT, timeoutMs: 10_000 });

		const health = await client.healthcheck();
		expect(health.status).toBe('healthy');

		const marker = `graphiti-e2e-${Date.now()}`;
		const groupId = `copilotchat_e2e_${Date.now()}_${Math.random().toString(16).slice(2)}`;
		const now = new Date().toISOString();

		try {
			const addRes = await client.addMessages(groupId, [
				{
					role_type: 'user',
					role: null,
					content: `E2E test marker: ${marker}. Lesson learned: always run npm run lint before committing.`,
					timestamp: now,
					source_description: 'copilotchat-e2e',
				},
			]);
			expect(addRes.success).toBe(true);

			const start = Date.now();
			while (Date.now() - start < 30_000) {
				const episodes = await client.getEpisodes(groupId, 1) as any;
				if (Array.isArray(episodes) && episodes.length > 0) {
					expect(episodes[0]?.group_id).toBe(groupId);
					break;
				}
				await new Promise(resolve => setTimeout(resolve, 500));
			}

			const search = await client.search({ query: marker, group_ids: [groupId], max_facts: 5 });
			expect(Array.isArray(search.facts)).toBe(true);
		} finally {
			const del = await client.deleteGroup(groupId);
			expect(del.success).toBe(true);
		}
	});
});

