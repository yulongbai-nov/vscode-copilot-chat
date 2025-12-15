/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'vitest';
import { inferGraphitiPromotionScope, looksLikeSecretForAutoPromotion, parseGraphitiMemoryDirectives } from '../../node/graphitiMemoryDirectives';

suite('GraphitiMemoryDirectives', () => {
	test('parses a single-line directive with explicit scope override', () => {
		const directives = parseGraphitiMemoryDirectives('preference (user): Keep diffs small.');
		assert.deepStrictEqual(directives, [{ kind: 'preference', scope: 'user', content: 'Keep diffs small.' }]);
	});

	test('parses a multi-line directive and defaults to workspace when ambiguous', () => {
		const directives = parseGraphitiMemoryDirectives([
			'terminology:',
			'foo means bar',
			'baz means qux',
			'',
			'unrelated',
		].join('\n'));

		assert.deepStrictEqual(directives, [
			{ kind: 'terminology', scope: 'workspace', content: 'foo means bar\nbaz means qux' },
		]);
	});

	test('infers user scope from explicit user cues', () => {
		assert.strictEqual(inferGraphitiPromotionScope('preference', 'I prefer minimal diffs.'), 'user');
		assert.strictEqual(inferGraphitiPromotionScope('terminology', 'In general, call this “playbook”.'), 'user');
	});

	test('detects likely secrets for auto-promotion', () => {
		assert.strictEqual(looksLikeSecretForAutoPromotion('My password is 123.'), true);
		assert.strictEqual(looksLikeSecretForAutoPromotion('Use pnpm in this repo.'), false);
	});
});

