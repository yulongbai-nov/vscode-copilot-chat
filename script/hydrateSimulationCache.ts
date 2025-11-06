/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface RunCommandOptions {
	readonly cwd?: string;
	readonly stdio?: 'inherit' | 'pipe';
	readonly env?: NodeJS.ProcessEnv;
	readonly allowNonZero?: boolean;
}

interface RunCommandResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_REMOTE = 'upstream';
const DEFAULT_BRANCH = 'main';
const DEFAULT_REMOTE_URL = 'https://github.com/microsoft/vscode-copilot-chat.git';
const CACHE_DIR = path.posix.join('test', 'simulation', 'cache');
const CACHE_INCLUDE = `${CACHE_DIR}/*`;
const BASE_CACHE_FILE = path.join(CACHE_DIR, 'base.sqlite');

function createManualInstructions(remote: string, branch: string, includePattern: string, checkoutPath: string, remoteUrl: string): string {
	return [
		'Unable to populate the simulation cache automatically. Run the following commands manually and re-run the script:',
		`  git remote add ${remote} ${remoteUrl}  # if the remote is missing`,
		`  git fetch ${remote} ${branch}`,
		`  MERGE_BASE=$(git merge-base HEAD ${remote}/${branch})`,
		`  git lfs fetch ${remote} "$MERGE_BASE" --include="${includePattern}" --exclude=""`,
		`  git lfs checkout ${checkoutPath}`
	].join('\n');
}

function runCommand(command: string, args: readonly string[], options: RunCommandOptions = {}): Promise<RunCommandResult> {
	return new Promise((resolve, reject) => {
		const stdio = options.stdio ?? 'inherit';
		const child = spawn(command, args, {
			cwd: options.cwd ?? REPO_ROOT,
			env: {
				...process.env,
				...options.env
			},
			stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe']
		});

		let stdout = '';
		let stderr = '';

		if (stdio === 'pipe') {
			child.stdout?.on('data', data => {
				stdout += data.toString();
			});
			child.stderr?.on('data', data => {
				stderr += data.toString();
			});
		}

		child.on('error', error => {
			reject(new Error(`${command} ${args.join(' ')} failed to start: ${error.message}`));
		});

		child.on('close', code => {
			const exitCode = code ?? 0;
			if (exitCode !== 0 && !options.allowNonZero) {
				reject(new Error(`${command} ${args.join(' ')} exited with code ${exitCode}${stderr ? `\n${stderr.trim()}` : ''}`));
				return;
			}

			resolve({ exitCode, stdout, stderr });
		});
	});
}

async function ensureRemoteExists(remote: string, remoteUrl: string, cwd: string): Promise<void> {
	const result = await runCommand('git', ['remote', 'get-url', remote], { cwd, stdio: 'pipe', allowNonZero: true });
	if (result.exitCode === 0) {
		const existing = result.stdout.trim();
		if (existing && existing !== remoteUrl) {
			console.warn(`[hydrateSimulationCache] Remote "${remote}" already points to ${existing}.`);
		}
		return;
	}

	console.log(`[hydrateSimulationCache] Adding remote "${remote}" -> ${remoteUrl}`);
	await runCommand('git', ['remote', 'add', remote, remoteUrl], { cwd });
}

async function resolveMergeBase(remote: string, branch: string, cwd: string): Promise<string> {
	const fetchEnv = { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' };
	console.log(`[hydrateSimulationCache] Fetching ${remote}/${branch} to determine merge base.`);
	await runCommand('git', ['fetch', remote, branch], { cwd, env: fetchEnv, stdio: 'inherit' });
	const fetchRef = `${remote}/${branch}`;
	const mergeBaseResult = await runCommand('git', ['merge-base', 'HEAD', fetchRef], { cwd, stdio: 'pipe' });
	const mergeBase = mergeBaseResult.stdout.trim();
	if (!mergeBase) {
		throw new Error(`git merge-base did not return a commit for HEAD and ${fetchRef}.`);
	}
	return mergeBase;
}

async function fetchSimulationCache(remote: string, mergeBase: string, includePattern: string, checkoutPath: string, cwd: string): Promise<void> {
	console.log(`[hydrateSimulationCache] Downloading LFS objects for ${includePattern} from ${remote}@${mergeBase}.`);
	await runCommand('git', ['lfs', 'fetch', remote, mergeBase, `--include=${includePattern}`, '--exclude='], { cwd, stdio: 'inherit' });
	await runCommand('git', ['lfs', 'checkout', checkoutPath], { cwd, stdio: 'inherit' });
}

export interface EnsureSimulationCacheOptions {
	readonly cwd?: string;
	readonly remote?: string;
	readonly branch?: string;
	readonly remoteUrl?: string;
	readonly includePattern?: string;
	readonly checkoutPath?: string;
	readonly verbose?: boolean;
}

export async function ensureSimulationCache(options: EnsureSimulationCacheOptions = {}): Promise<void> {
	const cwd = options.cwd ?? REPO_ROOT;
	const remote = options.remote ?? process.env.SIM_CACHE_REMOTE ?? DEFAULT_REMOTE;
	const branch = options.branch ?? process.env.SIM_CACHE_BRANCH ?? DEFAULT_BRANCH;
	const remoteUrl = options.remoteUrl ?? process.env.SIM_CACHE_REMOTE_URL ?? DEFAULT_REMOTE_URL;
	const includePattern = options.includePattern ?? process.env.SIM_CACHE_INCLUDE ?? CACHE_INCLUDE;
	const checkoutPath = options.checkoutPath ?? process.env.SIM_CACHE_CHECKOUT_PATH ?? CACHE_DIR;
	const baseCacheFile = path.join(cwd, checkoutPath, 'base.sqlite');

	if (fs.existsSync(baseCacheFile)) {
		if (options.verbose) {
			console.log(`[hydrateSimulationCache] Cache already present at ${baseCacheFile}`);
		}
		return;
	}

	console.warn(`[hydrateSimulationCache] Cache missing at ${baseCacheFile}. Hydrating from ${remote}/${branch}.`);

	try {
		await ensureRemoteExists(remote, remoteUrl, cwd);
		const mergeBase = await resolveMergeBase(remote, branch, cwd);
		console.log(`[hydrateSimulationCache] Using merge base commit ${mergeBase}.`);
		await fetchSimulationCache(remote, mergeBase, includePattern, checkoutPath, cwd);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const manual = createManualInstructions(remote, branch, includePattern, checkoutPath, remoteUrl);
		throw new Error(`${message}\n\n${manual}`);
	}

	if (!fs.existsSync(baseCacheFile)) {
		throw new Error(`Simulation cache hydration completed but ${baseCacheFile} is still missing.`);
	}
}

async function main(): Promise<void> {
	try {
		await ensureSimulationCache();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[hydrateSimulationCache] ${message}`);
		process.exitCode = 1;
	}
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
	void main();
}
