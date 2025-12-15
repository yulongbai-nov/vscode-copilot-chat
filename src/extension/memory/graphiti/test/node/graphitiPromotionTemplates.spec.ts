/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'vitest';
import { computeGraphitiGroupId, computeLegacyCopilotChatGraphitiGroupId, computeWorkspaceKey } from '../../node/graphitiGroupIds';
import { formatGraphitiPromotionEpisode } from '../../node/graphitiPromotionTemplates';

suite('Graphiti promotion helpers', () => {
	test('formatGraphitiPromotionEpisode uses stable header + trimmed content', () => {
		const now = new Date('2025-01-02T03:04:05.000Z');
		const content = formatGraphitiPromotionEpisode('decision', 'workspace', '  hello world \n', now);
		assert.ok(content.startsWith('<graphiti_episode kind="decision">'));
		assert.ok(content.includes('source: copilot-chat'));
		assert.ok(content.includes('scope: workspace'));
		assert.ok(content.includes(`timestamp: ${now.toISOString()}`));
		assert.ok(content.includes('\ncontent:\nhello world\n'));
		assert.ok(content.endsWith('</graphiti_episode>'));
	});

	test('computeWorkspaceKey sorts and joins folder URIs', () => {
		const key = computeWorkspaceKey(['file:///b', 'file:///a']);
		assert.strictEqual(key, 'file:///a|file:///b');
	});

	test('computeGraphitiGroupId returns canonical ids (hashed)', () => {
		const raw = computeGraphitiGroupId('workspace', 'raw', 'file:///a|file:///b');
		const hashed = computeGraphitiGroupId('workspace', 'hashed', 'file:///a|file:///b');

		assert.ok(raw.startsWith('graphiti_workspace_'));
		assert.ok(/^[a-zA-Z0-9_-]+$/.test(raw));
		assert.ok(hashed.startsWith('graphiti_workspace_'));
		assert.strictEqual(raw, hashed);
	});

	test('computeLegacyCopilotChatGraphitiGroupId respects raw/hashed', () => {
		const raw = computeLegacyCopilotChatGraphitiGroupId('workspace', 'raw', 'file:///a|file:///b');
		const hashed = computeLegacyCopilotChatGraphitiGroupId('workspace', 'hashed', 'file:///a|file:///b');

		assert.ok(raw.startsWith('copilotchat_workspace_'));
		assert.ok(/^[a-zA-Z0-9_-]+$/.test(raw));
		assert.ok(!raw.includes(':') && !raw.includes('/') && !raw.includes('|'));
		assert.ok(hashed.startsWith('copilotchat_workspace_'));
		assert.notStrictEqual(raw, hashed);
	});
});
