/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import * as path from 'path';

interface IRunCommandOptions {
	readonly cwd?: string;
	readonly silent?: boolean;
}

const repoRoot = path.join(__dirname, '..', '..');

async function runCommand(command: string, args: readonly string[], options: IRunCommandOptions = {}): Promise<string> {
	const cwd = options.cwd ?? repoRoot;
	const silent = options.silent ?? false;

	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: silent ? 'pipe' : 'inherit'
		});

		let stdout = '';
		let stderr = '';

		if (silent && child.stdout) {
			child.stdout.on('data', chunk => {
				stdout += chunk.toString();
			});
		}

		if (silent && child.stderr) {
			child.stderr.on('data', chunk => {
				stderr += chunk.toString();
			});
		}

		child.on('error', error => {
			reject(new Error(`${command} ${args.join(' ')} failed to start: ${error.message}`));
		});

		child.on('close', code => {
			if (code !== 0) {
				reject(new Error(`${command} ${args.join(' ')} exited with code ${code}${stderr ? `\n${stderr.trim()}` : ''}`));
				return;
			}
			resolve(stdout.trim());
		});
	});
}

async function ensureCleanTree(): Promise<void> {
	const status = await runCommand('git', ['status', '--porcelain'], { silent: true });
	if (status.length > 0) {
		throw new Error('Working tree is not clean. Commit or stash your changes before pruning the simulation cache history.');
	}
}

async function ensureFilterRepoAvailable(): Promise<void> {
	try {
		await runCommand('git', ['filter-repo', '--help'], { silent: true });
	} catch (error) {
		throw new Error('git filter-repo is required but was not found. Install it from https://github.com/newren/git-filter-repo and ensure it is on your PATH.');
	}
}

async function main(): Promise<void> {
	const confirm = process.argv.includes('--yes');
	if (!confirm) {
		console.error('This script rewrites history and permanently removes simulation cache layers from your fork. Re-run with --yes to continue.');
		process.exitCode = 1;
		return;
	}

	await runCommand('git', ['rev-parse', '--show-toplevel'], { silent: true });
	await ensureCleanTree();
	await ensureFilterRepoAvailable();

	console.log('Removing simulation cache layer history...');
	await runCommand('git', ['filter-repo', '--path', 'test/simulation/cache/layers', '--invert-paths', '--force']);

	console.log('Pruning unused Git LFS objects...');
	await runCommand('git', ['lfs', 'prune', '--recent']);

	console.log('Simulation cache layers removed from history. Force-push the rewritten branch with:');
	console.log('  git push --force-with-lease origin $(git rev-parse --abbrev-ref HEAD)');
	console.log('Then hydrate the cache locally via npm install or by running git lfs fetch/checkout as documented.');
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
