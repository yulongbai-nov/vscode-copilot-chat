/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import process from 'node:process';

function exec(command, args, options = {}) {
	return execFileSync(command, args, { stdio: 'inherit', ...options });
}

function execText(command, args) {
	return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function splitLines(value) {
	return value
		.split(/\r?\n/g)
		.map(line => line.trim())
		.filter(Boolean);
}

function isEligibleSourceFile(file) {
	if (!file || typeof file !== 'string') {
		return false;
	}

	if (!(file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js'))) {
		return false;
	}

	// Keep in sync with lint-staged.config.js excludes.
	if (file === '.esbuild.ts') {
		return false;
	}
	if (file.startsWith('test/simulation/fixtures/')) {
		return false;
	}
	if (file.startsWith('test/scenarios/')) {
		return false;
	}
	if (file.startsWith('.vscode/extensions/')) {
		return false;
	}
	if (file.includes('vscode.proposed.')) {
		return false;
	}

	return true;
}

function getChangedFiles({ includeStaged, includeUnstaged, includeUntracked }) {
	const files = new Set();

	if (includeUnstaged) {
		for (const file of splitLines(execText('git', ['diff', '--name-only', '--diff-filter=ACMR']))) {
			files.add(file);
		}
	}

	if (includeStaged) {
		for (const file of splitLines(execText('git', ['diff', '--name-only', '--cached', '--diff-filter=ACMR']))) {
			files.add(file);
		}
	}

	if (includeUntracked) {
		for (const file of splitLines(execText('git', ['ls-files', '--others', '--exclude-standard']))) {
			files.add(file);
		}
	}

	return Array.from(files).filter(isEligibleSourceFile);
}

function parseArgs(argv) {
	const args = new Set(argv);
	const includeStaged = args.has('--staged') || !args.has('--unstaged-only');
	const includeUnstaged = args.has('--unstaged') || !args.has('--staged-only');
	const includeUntracked = !args.has('--no-untracked');
	const restage = args.has('--restage');
	return { includeStaged, includeUnstaged, includeUntracked, restage };
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const files = getChangedFiles(options);

	if (!files.length) {
		console.log('fixChangedFiles: no changed source files detected.');
		return;
	}

	console.log(`fixChangedFiles: formatting ${files.length} file(s).`);
	exec('npx', ['tsfmt', '-r', '--', ...files]);

	console.log('fixChangedFiles: applying eslint --fix.');
	exec('node', ['--experimental-strip-types', './node_modules/eslint/bin/eslint.js', '--fix', '--max-warnings=0', '--no-warn-ignored', ...files]);

	if (options.restage) {
		console.log('fixChangedFiles: re-staging modified files.');
		exec('git', ['add', '--', ...files]);
	}
}

main();
