/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { CHAT_MODEL } from '../../../configuration/common/configurationService';
import { IEndpointBody } from '../../../networking/common/networking';
import { stripSamplingParameters } from '../../node/chatEndpoint';

describe('stripSamplingParameters', () => {
	it('removes sampling parameters for o1 family models', () => {
		const body: IEndpointBody = { temperature: 0.2, top_p: 0.9, n: 2, model: 'o1-mini' };

		stripSamplingParameters(body, 'o1-mini');

		expect(body.temperature).toBeUndefined();
		expect(body.top_p).toBeUndefined();
		expect(body.n).toBeUndefined();
		expect(body.model).toBe('o1-mini');
	});

	it('keeps sampling parameters for other families', () => {
		const body: IEndpointBody = { temperature: 0.2, top_p: 0.9, n: 2, model: 'gpt-4.1' };

		stripSamplingParameters(body, 'gpt-4.1');

		expect(body.temperature).toBe(0.2);
		expect(body.top_p).toBe(0.9);
		expect(body.n).toBe(2);
	});

	it('removes sampling parameters when model matches known o1 ids', () => {
		const body: IEndpointBody = { temperature: 0.4, top_p: 0.8, n: 1, model: CHAT_MODEL.O1 };

		stripSamplingParameters(body, 'copilot-base', CHAT_MODEL.O1);

		expect(body.temperature).toBeUndefined();
		expect(body.top_p).toBeUndefined();
		expect(body.n).toBeUndefined();
	});

	it('keeps sampling parameters for gpt-5 family', () => {
		const body: IEndpointBody = { temperature: 0.6, top_p: 0.7, n: 1, model: 'gpt-5' };

		stripSamplingParameters(body, 'gpt-5');

		expect(body.temperature).toBe(0.6);
		expect(body.top_p).toBe(0.7);
		expect(body.n).toBe(1);
	});

	it('removes sampling parameters for gpt-5.1-codex family', () => {
		const body: IEndpointBody = { temperature: 0.3, top_p: 0.95, n: 3, model: 'gpt-5.1-codex' };

		stripSamplingParameters(body, 'gpt-5.1-codex');

		expect(body.temperature).toBeUndefined();
		expect(body.top_p).toBeUndefined();
		expect(body.n).toBeUndefined();
	});
});
