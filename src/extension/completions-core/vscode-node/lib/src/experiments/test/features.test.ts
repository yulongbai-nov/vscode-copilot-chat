/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ICompletionsContextService } from '../../context';
import { extractRepoInfoInBackground } from '../../prompt/repository';
import { TelemetryData } from '../../telemetry';
import { createLibTestingContext } from '../../test/context';
import { makeFsUri } from '../../util/uri';
import { Features } from './../features';
import { ServicesAccessor } from '../../../../../../../util/vs/platform/instantiation/common/instantiation';

suite('updateExPValuesAndAssignments', function () {
	let accessor: ServicesAccessor;

	const filenameUri = makeFsUri(__filename);

	setup(async function () {
		accessor = createLibTestingContext();
		// Trigger extractRepoInfoInBackground early + add a sleep to force repo info to be available
		extractRepoInfoInBackground(accessor, filenameUri);
		await new Promise(resolve => setTimeout(resolve, 100));
	});

	test('If no options are provided, repo filters should be empty and there should be no telemetry properties or measurements', async function () {
		const features = accessor.get(ICompletionsContextService).get(Features);
		const telemetry = await features.updateExPValuesAndAssignments();

		assert.deepStrictEqual(telemetry.properties, {});
		assert.deepStrictEqual(telemetry.measurements, {});

		const filters = telemetry.filtersAndExp.filters.toHeaders();
		assert.deepStrictEqual(filters['X-Copilot-Repository'], undefined);
		assert.deepStrictEqual(filters['X-Copilot-FileType'], undefined);
	});

	test('If telemetry data is passed as a parameter, it should be used in the resulting telemetry object', async function () {
		const telemetryData = TelemetryData.createAndMarkAsIssued({ foo: 'bar' }, { baz: 42 });

		const features = accessor.get(ICompletionsContextService).get(Features);
		const telemetry = await features.updateExPValuesAndAssignments(undefined, telemetryData);

		assert.deepStrictEqual(telemetry.properties, { foo: 'bar' });
		assert.deepStrictEqual(telemetry.measurements, { baz: 42 });

		const filters = telemetry.filtersAndExp.filters.toHeaders();
		assert.deepStrictEqual(filters['X-Copilot-Repository'], undefined);
		assert.deepStrictEqual(filters['X-Copilot-FileType'], undefined);
	});
});
