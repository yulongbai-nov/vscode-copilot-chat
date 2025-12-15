/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'vitest';
import { isGraphitiConsentRecord } from '../../common/graphitiConsent';
import { normalizeGraphitiEndpoint } from '../../common/graphitiEndpoint';

suite('Graphiti config helpers', () => {
	suite('normalizeGraphitiEndpoint', () => {
		test('returns undefined for empty strings', () => {
			assert.strictEqual(normalizeGraphitiEndpoint(''), undefined);
			assert.strictEqual(normalizeGraphitiEndpoint('   '), undefined);
		});

		test('returns undefined for non-URL inputs', () => {
			assert.strictEqual(normalizeGraphitiEndpoint('graph:8000'), undefined);
			assert.strictEqual(normalizeGraphitiEndpoint('not a url'), undefined);
		});

		test('returns undefined for unsupported schemes', () => {
			assert.strictEqual(normalizeGraphitiEndpoint('ftp://example.com'), undefined);
		});

		test('normalizes by trimming and removing trailing slashes', () => {
			assert.strictEqual(normalizeGraphitiEndpoint(' http://graph:8000/ '), 'http://graph:8000');
			assert.strictEqual(normalizeGraphitiEndpoint('https://example.com/api///'), 'https://example.com/api');
		});
	});

	suite('isGraphitiConsentRecord', () => {
		test('accepts valid records', () => {
			assert.strictEqual(isGraphitiConsentRecord({ version: 1, endpoint: 'http://graph:8000', consentedAt: '2025-01-01T00:00:00.000Z' }), true);
		});

		test('rejects invalid records', () => {
			assert.strictEqual(isGraphitiConsentRecord(undefined), false);
			assert.strictEqual(isGraphitiConsentRecord(null), false);
			assert.strictEqual(isGraphitiConsentRecord({}), false);
			assert.strictEqual(isGraphitiConsentRecord({ version: 1, endpoint: 'http://graph:8000' }), false);
			assert.strictEqual(isGraphitiConsentRecord({ version: 2, endpoint: 'http://graph:8000', consentedAt: '2025-01-01T00:00:00.000Z' }), false);
		});
	});
});

