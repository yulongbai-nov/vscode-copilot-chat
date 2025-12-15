/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'vitest';
import { mapChatTurnToGraphitiMessages, truncateForGraphiti } from '../../node/graphitiMessageMapping';

suite('Graphiti message mapping', () => {
	test('truncateForGraphiti keeps output <= maxChars and marks truncation', () => {
		const truncated = truncateForGraphiti('0123456789abcdefghijklmnopqrstuvwxyz', 20);
		assert.ok(truncated.length <= 20);
		assert.ok(truncated.includes('[truncated]'));
	});

	test('mapChatTurnToGraphitiMessages omits uuid and assigns roles', () => {
		const messages = mapChatTurnToGraphitiMessages({
			userMessage: 'hello',
			assistantMessage: 'world',
			timestamp: new Date('2025-01-02T03:04:05.000Z'),
			maxMessageChars: 1000,
		});

		assert.strictEqual(messages[0].role_type, 'user');
		assert.strictEqual(messages[0].role, 'user');
		assert.strictEqual(messages[1].role_type, 'assistant');
		assert.strictEqual(messages[1].role, 'assistant');
		assert.strictEqual(Object.prototype.hasOwnProperty.call(messages[0], 'uuid'), false);
		assert.strictEqual(Object.prototype.hasOwnProperty.call(messages[1], 'uuid'), false);
	});

	test('mapChatTurnToGraphitiMessages sets name fields when turnId provided', () => {
		const messages = mapChatTurnToGraphitiMessages({
			turnId: 'turn_123',
			userMessage: 'hello',
			assistantMessage: 'world',
			timestamp: new Date('2025-01-02T03:04:05.000Z'),
			maxMessageChars: 1000,
		});

		assert.strictEqual(messages[0].name, 'copilotchat.turn.turn_123.user');
		assert.strictEqual(messages[1].name, 'copilotchat.turn.turn_123.assistant');
	});

	test('mapChatTurnToGraphitiMessages sets source_description when provided', () => {
		const messages = mapChatTurnToGraphitiMessages({
			userMessage: 'hello',
			assistantMessage: 'world',
			timestamp: new Date('2025-01-02T03:04:05.000Z'),
			maxMessageChars: 1000,
			sourceDescription: '{"source":"copilotchat"}',
		});

		assert.strictEqual(messages[0].source_description, '{"source":"copilotchat"}');
		assert.strictEqual(messages[1].source_description, '{"source":"copilotchat"}');
	});
});
