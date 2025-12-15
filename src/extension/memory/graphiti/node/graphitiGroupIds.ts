/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getCachedSha256Hash } from '../../../../util/common/crypto';

export type GraphitiIngestionScope = 'session' | 'workspace' | 'user';
export type GraphitiGroupIdStrategy = 'raw' | 'hashed';

const MAX_RAW_GROUP_KEY_CHARS = 80;
const RAW_GROUP_KEY_HASH_CHARS = 16;
const CANONICAL_HASH_CHARS = 32;

export function computeWorkspaceKey(workspaceFolderUris: readonly string[]): string {
	const normalizedFolders = [...workspaceFolderUris].map(s => s.trim()).filter(Boolean).sort();
	return normalizedFolders.length ? normalizedFolders.join('|') : 'no-workspace-folders';
}

function sanitizeRawGroupKey(key: string): string {
	const normalized = key.trim();
	const safe = normalized.replaceAll(/[^a-zA-Z0-9_-]+/g, '_').replaceAll(/_+/g, '_').replaceAll(/^_+|_+$/g, '');
	if (safe.length <= MAX_RAW_GROUP_KEY_CHARS) {
		return safe || 'empty';
	}

	const hashSuffix = getCachedSha256Hash(normalized).slice(0, RAW_GROUP_KEY_HASH_CHARS);
	return `${safe.slice(0, MAX_RAW_GROUP_KEY_CHARS - RAW_GROUP_KEY_HASH_CHARS - 1)}_${hashSuffix}`;
}

export function computeCanonicalGraphitiGroupId(scope: GraphitiIngestionScope, strategy: GraphitiGroupIdStrategy, key: string): string {
	const normalizedKey = key.trim() || `no-${scope}-key`;
	// Canonical group ids are always hashed to ensure:
	// - privacy-safe ids by default
	// - stable cross-client shared memory
	// - compatibility with Graphiti server-side group id resolution (when available)
	void strategy;
	const groupKey = getCachedSha256Hash(normalizedKey).slice(0, CANONICAL_HASH_CHARS);
	return `graphiti_${scope}_${groupKey}`;
}

export function computeLegacyCopilotChatGraphitiGroupId(scope: GraphitiIngestionScope, strategy: GraphitiGroupIdStrategy, key: string): string {
	const normalizedKey = key.trim() || `no-${scope}-key`;
	const groupKey = strategy === 'hashed' ? getCachedSha256Hash(normalizedKey) : sanitizeRawGroupKey(normalizedKey);
	return `copilotchat_${scope}_${groupKey}`;
}

export function computeGraphitiGroupId(scope: GraphitiIngestionScope, strategy: GraphitiGroupIdStrategy, key: string): string {
	return computeCanonicalGraphitiGroupId(scope, strategy, key);
}
