/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

module.exports = {
	'!({.esbuild.ts,test/simulation/fixtures/**,test/scenarios/**,.vscode/extensions/**,**/vscode.proposed.*})*{.ts,.js,.tsx}': async (files) => {
		const filesToLint = files.join(' ');
		return [
			`npm run tsfmt -- ${filesToLint}`,
			`node --experimental-strip-types ./node_modules/eslint/bin/eslint.js --max-warnings=0 --no-warn-ignored ${filesToLint}`
		];
	},
};
