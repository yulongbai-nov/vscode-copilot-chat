/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function normalizeGraphitiEndpoint(endpoint: string): string | undefined {
	const trimmed = endpoint.trim();
	if (!trimmed) {
		return undefined;
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return undefined;
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return undefined;
	}

	return trimmed.replace(/\/+$/, '');
}

