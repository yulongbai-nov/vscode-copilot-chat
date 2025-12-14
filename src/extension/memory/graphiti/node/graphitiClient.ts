/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/logService';
import { FetchOptions, IFetcherService } from '../../../../platform/networking/common/fetcherService';
import { GraphitiAddMessagesRequest, GraphitiGetMemoryRequest, GraphitiGetMemoryResponse, GraphitiHealthcheckResponse, GraphitiMessage, GraphitiResult, GraphitiSearchQuery, GraphitiSearchResults } from './graphitiTypes';

export interface GraphitiClientOptions {
	readonly endpoint: string;
	readonly timeoutMs: number;
	readonly authHeader?: { name: string; value: string };
}

type GraphitiHttpMethod = 'GET' | 'POST' | 'DELETE';

export class GraphitiClient {
	constructor(
		private readonly fetcherService: IFetcherService,
		private readonly logService: ILogService,
		private readonly options: GraphitiClientOptions,
	) { }

	async healthcheck(): Promise<GraphitiHealthcheckResponse> {
		return this.requestJson('GET', '/healthcheck');
	}

	async openApi(): Promise<unknown> {
		return this.requestJson('GET', '/openapi.json');
	}

	async addMessages(groupId: string, messages: readonly GraphitiMessage[]): Promise<GraphitiResult> {
		const request: GraphitiAddMessagesRequest = { group_id: groupId, messages };
		return this.requestJson('POST', '/messages', request);
	}

	async deleteGroup(groupId: string): Promise<GraphitiResult> {
		return this.requestJson('DELETE', `/group/${encodeURIComponent(groupId)}`);
	}

	async getEpisodes(groupId: string, lastN: number): Promise<unknown> {
		const safeLastN = Math.max(1, Math.floor(lastN));
		return this.requestJson('GET', `/episodes/${encodeURIComponent(groupId)}?last_n=${encodeURIComponent(String(safeLastN))}`);
	}

	async search(query: GraphitiSearchQuery): Promise<GraphitiSearchResults> {
		return this.requestJson('POST', '/search', query);
	}

	async getMemory(request: GraphitiGetMemoryRequest): Promise<GraphitiGetMemoryResponse> {
		return this.requestJson('POST', '/get-memory', request);
	}

	private buildUrl(path: string): string {
		const endpoint = this.options.endpoint.trim().replace(/\/+$/, '');
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;
		return `${endpoint}${normalizedPath}`;
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			Accept: 'application/json',
		};
		const authHeader = this.options.authHeader;
		if (authHeader) {
			headers[authHeader.name] = authHeader.value;
		}
		return headers;
	}

	private async requestJson<T>(method: GraphitiHttpMethod, path: string, json?: unknown): Promise<T> {
		const url = this.buildUrl(path);
		const headers = this.buildHeaders();
		const abort = this.fetcherService.makeAbortController();
		const timeoutMs = Math.max(0, this.options.timeoutMs);
		const timer = timeoutMs > 0 ? setTimeout(() => abort.abort(), timeoutMs) : undefined;

		try {
			const response = await this.fetcherService.fetch(
				url,
				{
					method: method as unknown as FetchOptions['method'],
					headers,
					timeout: this.options.timeoutMs,
					signal: abort.signal,
					...(json === undefined ? {} : { json }),
					expectJSON: true,
				},
			);

			if (!response.ok) {
				const safeBodySnippet = await this.tryReadResponseBodySnippet(response);
				throw new Error(`Graphiti request failed: ${response.status} ${response.statusText}${safeBodySnippet ? ` (${safeBodySnippet})` : ''}`);
			}

			return await response.json() as T;
		} catch (err) {
			if (this.fetcherService.isAbortError(err)) {
				this.logService.debug(`Graphiti request aborted (${method} ${path}).`);
			} else {
				this.logService.error(err as Error, `Graphiti request failed (${method} ${path})`);
			}
			throw err;
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
		}
	}

	private async tryReadResponseBodySnippet(response: Awaited<ReturnType<IFetcherService['fetch']>>): Promise<string | undefined> {
		try {
			const text = await response.text();
			if (!text) {
				return undefined;
			}
			const trimmed = text.replaceAll(/\s+/g, ' ').trim();
			return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
		} catch {
			return undefined;
		}
	}
}
