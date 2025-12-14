/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'vitest';
import { computeGraphitiGroupId, computeWorkspaceKey } from '../../node/graphitiGroupIds';
import { formatGraphitiPromotionEpisode } from '../../node/graphitiPromotionTemplates';

suite('Graphiti promotion helpers', () => {
	test('formatGraphitiPromotionEpisode uses stable header + trimmed content', () => {
		const now = new Date('2025-01-02T03:04:05.000Z');
		const content = formatGraphitiPromotionEpisode('decision', 'workspace', '  hello world \n', now);
		assert.ok(content.includes('Copilot Chat Memory'));
		assert.ok(content.includes('kind: decision'));
		assert.ok(content.includes('scope: workspace'));
		assert.ok(content.includes(`timestamp: ${now.toISOString()}`));
		assert.ok(content.endsWith('hello world'));
	});

	test('computeWorkspaceKey sorts and joins folder URIs', () => {
		const key = computeWorkspaceKey(['file:///b', 'file:///a']);
		assert.strictEqual(key, 'file:///a|file:///b');
	});

	test('computeGraphitiGroupId hashes when requested', () => {
		const raw = computeGraphitiGroupId('workspace', 'raw', 'file:///a|file:///b');
		const hashed = computeGraphitiGroupId('workspace', 'hashed', 'file:///a|file:///b');

		assert.ok(raw.startsWith('copilotchat_workspace_'));
		assert.ok(/^[a-zA-Z0-9_-]+$/.test(raw));
		assert.ok(!raw.includes(':') && !raw.includes('/') && !raw.includes('|'));
		assert.ok(hashed.startsWith('copilotchat_workspace_'));
		assert.notStrictEqual(raw, hashed);
	});
});
