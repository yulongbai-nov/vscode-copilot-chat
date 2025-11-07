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
const CACHE_DIR = 'test/simulation/cache'; // Use forward slashes for git commands
const CACHE_INCLUDE = `${CACHE_DIR}/*`;

function createManualInstructions(remote: string, branch: string, includePattern: string, checkoutPath: string, remoteUrl: string): string {
	return [
		'Unable to populate the simulation cache automatically. Run the following commands manually and re-run the script:',
		`  git remote add ${remote} ${remoteUrl}  # if the remote is missing`,
		`  git fetch ${remote} ${branch}  # creates ${remote}/${branch}`,
		`  MERGE_BASE=$(git merge-base HEAD ${remote}/${branch})`,
		`  git checkout ${remote}/${branch} -- ${checkoutPath}`,
		`  git reset HEAD -- ${checkoutPath}  # keep pointers in the working tree only`,
		`  git lfs fetch ${remote} "$MERGE_BASE" --include="${includePattern}" --exclude=""`,
		`  git lfs checkout ${checkoutPath}`
	].join('\n');
}

function resolveStringOption(optionValue: string | undefined, envValue: string | undefined, defaultValue: string): string {
	if (optionValue !== undefined) {
		const trimmedOption = optionValue.trim();
		if (trimmedOption !== '') {
			return trimmedOption;
		}
	}

	if (envValue !== undefined) {
		const trimmedEnv = envValue.trim();
		if (trimmedEnv !== '') {
			return trimmedEnv;
		}
	}

	return defaultValue;
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
				const errorMsg = [
					`${command} ${args.join(' ')} exited with code ${exitCode}`,
					stderr ? `stderr: ${stderr.trim()}` : '',
					stdout ? `stdout: ${stdout.trim()}` : ''
				].filter(Boolean).join('\n');
				reject(new Error(errorMsg));
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
	try {
		await runCommand('git', ['remote', 'add', remote, remoteUrl], { cwd });
		console.log(`[hydrateSimulationCache] Successfully added remote "${remote}"`);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[hydrateSimulationCache] Failed to add remote: ${msg}`);
		throw error;
	}
}

async function resolveMergeBase(remote: string, branch: string, cwd: string): Promise<string> {
	const fetchEnv = { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' };
	console.log(`[hydrateSimulationCache] Fetching ${remote}/${branch} to determine merge base.`);
	try {
		await runCommand('git', ['fetch', remote, branch], { cwd, env: fetchEnv, stdio: 'inherit' });
		console.log(`[hydrateSimulationCache] Fetch completed successfully`);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[hydrateSimulationCache] Fetch failed: ${msg}`);
		throw error;
	}

	const fetchRef = `${remote}/${branch}`;
	console.log(`[hydrateSimulationCache] Computing merge-base between HEAD and ${fetchRef}`);
	try {
		const mergeBaseResult = await runCommand('git', ['merge-base', 'HEAD', fetchRef], { cwd, stdio: 'pipe' });
		const mergeBase = mergeBaseResult.stdout.trim();
		if (!mergeBase) {
			throw new Error(`git merge-base did not return a commit for HEAD and ${fetchRef}.`);
		}
		console.log(`[hydrateSimulationCache] Merge base found: ${mergeBase}`);
		return mergeBase;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[hydrateSimulationCache] merge-base failed: ${msg}`);
		// Show HEAD commit for debugging
		try {
			const headResult = await runCommand('git', ['rev-parse', 'HEAD'], { cwd, stdio: 'pipe' });
			console.log(`[hydrateSimulationCache] Current HEAD: ${headResult.stdout.trim()}`);
		} catch { /* ignore */ }
		throw error;
	}
}

async function fetchSimulationCache(remote: string, mergeBase: string, includePattern: string, checkoutPath: string, cwd: string): Promise<void> {
	console.log(`[hydrateSimulationCache] Downloading LFS objects for ${includePattern} from ${remote}@${mergeBase}.`);
	try {
		await runCommand('git', ['lfs', 'fetch', remote, mergeBase, `--include=${includePattern}`, '--exclude='], { cwd, stdio: 'inherit' });
		console.log(`[hydrateSimulationCache] LFS fetch completed`);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[hydrateSimulationCache] LFS fetch failed: ${msg}`);
		throw error;
	}
}

async function listRemoteCacheEntries(remote: string, branch: string, checkoutPath: string, cwd: string): Promise<string[]> {
	const remoteRef = `${remote}/${branch}`;
	try {
		const result = await runCommand('git', ['ls-tree', '-r', '--name-only', remoteRef, checkoutPath], { cwd, stdio: 'pipe' });
		return result.stdout.split('\n').map(line => line.trim()).filter(line => line !== '');
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		throw new Error(`[hydrateSimulationCache] Failed to enumerate cache entries from ${remoteRef}: ${msg}`);
	}
}

async function materializeCachePointers(remote: string, branch: string, checkoutPath: string, cwd: string): Promise<void> {
	const entries = await listRemoteCacheEntries(remote, branch, checkoutPath, cwd);
	if (entries.length === 0) {
		console.warn(`[hydrateSimulationCache] No cache entries found at ${remote}/${branch}:${checkoutPath}`);
		return;
	}

	const remoteRef = `${remote}/${branch}`;
	for (const entry of entries) {
		try {
			const pointerResult = await runCommand('git', ['show', `${remoteRef}:${entry}`], { cwd, stdio: 'pipe' });
			const targetPath = path.join(cwd, entry);
			await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
			await fs.promises.writeFile(targetPath, pointerResult.stdout, 'utf-8');
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			throw new Error(`[hydrateSimulationCache] Failed to materialize pointer for ${entry} from ${remoteRef}: ${msg}`);
		}
	}
}

async function checkoutMaterializedCache(checkoutPath: string, cwd: string): Promise<void> {
	console.log(`[hydrateSimulationCache] Checking out LFS payloads in ${checkoutPath}`);
	await runCommand('git', ['lfs', 'checkout', checkoutPath], { cwd, stdio: 'inherit' });
}

function logCacheStats(baseSqlitePath: string, mergeBase: string): void {
	console.log(`[hydrateSimulationCache] Merge base commit: ${mergeBase}`);
	if (fs.existsSync(baseSqlitePath)) {
		const stats = fs.statSync(baseSqlitePath);
		console.log(`[hydrateSimulationCache] base.sqlite size: ${stats.size} bytes`);
		console.log(`[hydrateSimulationCache] base.sqlite mtime: ${stats.mtime.toISOString()}`);
		const crypto = require('crypto');
		const hash = crypto.createHash('sha256');
		hash.update(fs.readFileSync(baseSqlitePath));
		console.log(`[hydrateSimulationCache] base.sqlite SHA256: ${hash.digest('hex')}`);
	} else {
		console.warn(`[hydrateSimulationCache] base.sqlite not found after hydration!`);
	}
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
	const remote = resolveStringOption(options.remote, process.env.SIM_CACHE_REMOTE, DEFAULT_REMOTE);
	const branch = resolveStringOption(options.branch, process.env.SIM_CACHE_BRANCH, DEFAULT_BRANCH);
	const remoteUrl = resolveStringOption(options.remoteUrl, process.env.SIM_CACHE_REMOTE_URL, DEFAULT_REMOTE_URL);
	const includePattern = resolveStringOption(options.includePattern, process.env.SIM_CACHE_INCLUDE, CACHE_INCLUDE);
	const checkoutPath = resolveStringOption(options.checkoutPath, process.env.SIM_CACHE_CHECKOUT_PATH, CACHE_DIR);
	const baseCacheFile = path.join(cwd, checkoutPath, 'base.sqlite');

	// Check if file exists and is not just an LFS pointer (should be > 1KB)
	if (fs.existsSync(baseCacheFile)) {
		const stats = fs.statSync(baseCacheFile);
		if (stats.size > 1024) {
			if (options.verbose) {
				console.log(`[hydrateSimulationCache] Cache already present at ${baseCacheFile} (${stats.size} bytes)`);
			}
			return;
		} else {
			console.warn(`[hydrateSimulationCache] Found LFS pointer file (${stats.size} bytes), will hydrate actual content.`);
		}
	}

	console.warn(`[hydrateSimulationCache] Cache missing at ${baseCacheFile}. Hydrating from ${remote}/${branch}.`);

	try {
		await ensureRemoteExists(remote, remoteUrl, cwd);
		const mergeBase = await resolveMergeBase(remote, branch, cwd);
		console.log(`[hydrateSimulationCache] Using merge base commit ${mergeBase}.`);
		await fetchSimulationCache(remote, mergeBase, includePattern, checkoutPath, cwd);
		console.log(`[hydrateSimulationCache] Materializing cache pointers from ${remote}/${branch}.`);
		await materializeCachePointers(remote, branch, checkoutPath, cwd);
		await checkoutMaterializedCache(checkoutPath, cwd);
		logCacheStats(baseCacheFile, mergeBase);
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
