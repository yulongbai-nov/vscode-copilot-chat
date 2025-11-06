/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, suite, test } from 'vitest';
import { Cache } from './cache';

suite('Cache Keyv v5 Initialization', function () {

	test('Cache.Instance should initialize successfully with Keyv v5 connection string', async function () {
		// This test verifies that the cache initializes without throwing
		// TypeError: database.query is not a function
		// which was the issue when using the old Keyv v4 API

		let cache: Cache | undefined;

		expect(() => {
			cache = Cache.Instance;
		}).not.toThrow();

		expect(cache).toBeDefined();
	});

	test('Cache should support basic get/set/has operations', async function () {
		const cache = Cache.Instance;

		const testKey = `test:cache:verification:${Date.now()}`;
		const testValue = 'test value for cache verification';

		// Test set operation
		await expect(cache.set(testKey, testValue)).resolves.not.toThrow();

		// Test has operation
		const exists = await cache.has(testKey);
		expect(exists).toBe(true);

		// Test get operation
		const retrieved = await cache.get(testKey);
		expect(retrieved).toBe(testValue);
	});
});
