/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { Cache } from './cache';

async function main() {
	const args = process.argv.slice(2);

	if (args.length < 1) {
		console.log('Usage:');
		console.log('  npx tsx cache-cli check - Check if there are any duplicate keys in the databases');
		process.exit(1);
	}

	// Debug: Print environment information
	console.log('🔍 Environment Debug Info:');
	console.log('  Node version:', process.version);
	console.log('  Platform:', process.platform);
	console.log('  Arch:', process.arch);
	console.log('  CWD:', process.cwd());
	console.log('  __dirname:', __dirname);

	// Debug: Print keyv versions
	try {
		const fs = require('fs');
		const path = require('path');
		const keyvDir = path.dirname(require.resolve('keyv'));
		const keyvSqliteDir = path.dirname(require.resolve('@keyv/sqlite'));
		const keyvPkg = JSON.parse(fs.readFileSync(path.join(keyvDir, '..', 'package.json'), 'utf-8'));
		const keyvSqlitePkg = JSON.parse(fs.readFileSync(path.join(keyvSqliteDir, '..', 'package.json'), 'utf-8'));
		console.log('  keyv version:', keyvPkg.version);
		console.log('  @keyv/sqlite version:', keyvSqlitePkg.version);
		console.log('  @keyv/sqlite peer deps:', JSON.stringify(keyvSqlitePkg.peerDependencies));

		// Check if base.sqlite exists
		const baseSqlitePath = path.resolve(__dirname, '..', 'simulation', 'cache', 'base.sqlite');
		console.log('  base.sqlite path:', baseSqlitePath);
		const stats = fs.existsSync(baseSqlitePath) ? fs.statSync(baseSqlitePath) : null;
		if (stats) {
			console.log('  base.sqlite exists: YES');
			console.log('  base.sqlite size:', stats.size, 'bytes');
			console.log('  base.sqlite modified:', stats.mtime.toISOString());
		} else {
			console.log('  base.sqlite exists: NO - FILE NOT FOUND!');
		}
	} catch (err) {
		console.log('  Failed to read package versions:', err.message);
	}
	console.log('');

	const cache = new Cache(path.resolve(__dirname, '..', 'simulation', 'cache'));

	try {
		switch (args[0]) {
			case 'check': {
				const result = await cache.checkDatabase();
				if (result.size === 0) {
					console.log('✅ No duplicate keys found.');
				} else {
					console.log('⛔ Duplicate keys found:');
					for (const [key, values] of result) {
						console.log(` - "${key}" found in: `, values.join(', '));
					}
					throw new Error('Duplicate keys found in the database.');
				}
				break;
			}
			default: {
				console.error('Invalid command. Use: check');
				process.exit(1);
			}
		}
	} catch (error) {
		console.error('⛔ Error:', error);
		process.exit(1);
	}
}

// Run main function if this file is executed directly
if (require.main === module) {
	main();
}