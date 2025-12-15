/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'vitest';
import { GraphitiIngestionQueue } from '../../node/graphitiIngestionQueue';
import { GraphitiMessage } from '../../node/graphitiTypes';

suite('GraphitiIngestionQueue', () => {
	test('enqueue drops oldest when maxQueueSize exceeded', () => {
		const queue = new GraphitiIngestionQueue();
		const msg = (content: string): GraphitiMessage => ({ role_type: 'user', role: 'user', content });

		const first = queue.enqueue('g1', [msg('a'), msg('b')], 2);
		assert.strictEqual(first.droppedCount, 0);
		assert.strictEqual(queue.size, 2);

		const second = queue.enqueue('g1', [msg('c')], 2);
		assert.strictEqual(second.droppedCount, 1);
		assert.strictEqual(queue.size, 2);
	});

	test('takeBatch groups by groupId and respects maxBatchSize', () => {
		const queue = new GraphitiIngestionQueue();
		const msg = (content: string): GraphitiMessage => ({ role_type: 'user', role: 'user', content });

		queue.enqueue('g1', [msg('a'), msg('b')], 10);
		queue.enqueue('g2', [msg('c')], 10);

		const batch1 = queue.takeBatch(1);
		assert.ok(batch1);
		assert.strictEqual(batch1.groupId, 'g1');
		assert.deepStrictEqual(batch1.messages.map(m => m.content), ['a']);

		const batch2 = queue.takeBatch(10);
		assert.ok(batch2);
		assert.strictEqual(batch2.groupId, 'g1');
		assert.deepStrictEqual(batch2.messages.map(m => m.content), ['b']);

		const batch3 = queue.takeBatch(10);
		assert.ok(batch3);
		assert.strictEqual(batch3.groupId, 'g2');
		assert.deepStrictEqual(batch3.messages.map(m => m.content), ['c']);
	});

	test('requeueBatch puts messages back at the front in order', () => {
		const queue = new GraphitiIngestionQueue();
		const msg = (content: string): GraphitiMessage => ({ role_type: 'user', role: 'user', content });

		queue.enqueue('g1', [msg('a'), msg('b')], 10);
		const batch = queue.takeBatch(2);
		assert.ok(batch);
		assert.strictEqual(queue.size, 0);

		queue.requeueBatch(batch);
		assert.strictEqual(queue.size, 2);

		const again = queue.takeBatch(2);
		assert.ok(again);
		assert.deepStrictEqual(again.messages.map(m => m.content), ['a', 'b']);
	});
});

