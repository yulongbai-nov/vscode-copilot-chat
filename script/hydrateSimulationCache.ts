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

interface LfsPointerMetadata {
	readonly oid: string;
	readonly size: number;
}

function parseLfsPointer(pointer: string, entry: string): LfsPointerMetadata {
	const lines = pointer.split('\n').map(line => line.trim()).filter(Boolean);
	let oid: string | undefined;
	let size: number | undefined;

	for (const line of lines) {
		if (line.startsWith('oid sha256:')) {
			oid = line.replace('oid sha256:', '').trim();
		} else if (line.startsWith('size ')) {
			const maybe = Number(line.replace('size', '').trim());
			if (!Number.isNaN(maybe)) {
				size = maybe;
			}
		}
	}

	if (!oid || size === undefined) {
		throw new Error(`[hydrateSimulationCache] Could not parse LFS pointer metadata for ${entry}`);
	}

	return { oid, size };
}

function resolveGitDir(cwd: string): string {
	const gitPath = path.join(cwd, '.git');
	let stats: fs.Stats;
	try {
		stats = fs.statSync(gitPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`[hydrateSimulationCache] Unable to stat ${gitPath}: ${message}`);
	}
	if (stats.isDirectory()) {
		return gitPath;
	}

	if (!stats.isFile()) {
		throw new Error(`[hydrateSimulationCache] Unable to resolve git dir at ${gitPath}`);
	}

	let contents: string;
	try {
		contents = fs.readFileSync(gitPath, 'utf8');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`[hydrateSimulationCache] Unable to read ${gitPath}: ${message}`);
	}
	const match = contents.match(/gitdir:\s*(.+)/i);
	if (!match?.[1]) {
		throw new Error(`[hydrateSimulationCache] Malformed gitdir file at ${gitPath}`);
	}

	const resolved = match[1].trim();
	return path.isAbsolute(resolved) ? resolved : path.resolve(cwd, resolved);
}

function resolveGitCommonDir(cwd: string): string {
	const gitDir = resolveGitDir(cwd);
	const commonDirPath = path.join(gitDir, 'commondir');
	try {
		const contents = fs.readFileSync(commonDirPath, 'utf8').trim();
		if (contents) {
			const resolved = path.isAbsolute(contents) ? contents : path.resolve(gitDir, contents);
			return resolved;
		}
	} catch {
		// commondir not present, fall back to gitDir
	}
	return gitDir;
}

function resolveLfsObjectPath(oid: string, cwd: string): string {
	const gitDir = resolveGitCommonDir(cwd);
	const objectsDir = path.join(gitDir, 'lfs', 'objects');
	const first = oid.slice(0, 2);
	const second = oid.slice(2, 4);
	return path.join(objectsDir, first, second, oid);
}

function createManualInstructions(remote: string, branch: string, includePattern: string, checkoutPath: string, remoteUrl: string, useRemoteHead: boolean): string {
	const commitVar = useRemoteHead ? 'REMOTE_HEAD' : 'MERGE_BASE';
	const commitCommand = useRemoteHead
		? `${commitVar}=$(git rev-parse ${remote}/${branch})`
		: `${commitVar}=$(git merge-base HEAD ${remote}/${branch})`;
	const checkoutRef = useRemoteHead ? `${remote}/${branch}` : `$${commitVar}`;
	return [
		'Unable to populate the simulation cache automatically. Run the following commands manually and re-run the script:',
		`  git remote add ${remote} ${remoteUrl}  # if the remote is missing`,
		`  git fetch ${remote} ${branch}  # creates ${remote}/${branch}`,
		`  ${commitCommand}`,
		`  git checkout ${checkoutRef} -- ${checkoutPath}`,
		`  git reset HEAD -- ${checkoutPath}  # keep pointers in the working tree only`,
		`  git lfs fetch ${remote} "$${commitVar}" --include="${includePattern}" --exclude=""`,
		`  git lfs checkout ${checkoutPath}`
	].join('\n');
}

function normalizeGitPath(value: string): string {
	return value.replace(/\\/g, '/');
}

interface LocalCacheFile {
	readonly absolutePath: string;
	readonly repoRelativePath: string;
}

async function listLocalCacheFiles(cwd: string, checkoutPath: string): Promise<readonly LocalCacheFile[]> {
	const checkoutAbsolute = path.join(cwd, checkoutPath);
	try {
		const stats = await fs.promises.stat(checkoutAbsolute);
		if (!stats.isDirectory()) {
			return [];
		}
	} catch {
		return [];
	}

	const normalizedCheckoutPath = normalizeGitPath(checkoutPath).replace(/\/+$/, '');
	const results: LocalCacheFile[] = [];

	async function walk(currentAbsolute: string, relativeSegments: string[]): Promise<void> {
		const entries = await fs.promises.readdir(currentAbsolute, { withFileTypes: true });
		for (const entry of entries) {
			const nextSegments = [...relativeSegments, entry.name];
			const relPathPosix = nextSegments.join('/');
			if (entry.isDirectory()) {
				await walk(path.join(currentAbsolute, entry.name), nextSegments);
				continue;
			}

			const repoRelativePath = normalizedCheckoutPath
				? `${normalizedCheckoutPath}/${relPathPosix}`
				: relPathPosix;
			results.push({
				absolutePath: path.join(currentAbsolute, entry.name),
				repoRelativePath
			});
		}
	}

	await walk(checkoutAbsolute, []);
	return results;
}

async function removeFileAndEmptyParents(filePath: string, stopDir: string): Promise<void> {
	await fs.promises.unlink(filePath);
	const stopAbsolute = path.resolve(stopDir);
	let currentDir = path.dirname(filePath);

	while (currentDir.startsWith(stopAbsolute)) {
		const contents = await fs.promises.readdir(currentDir);
		if (contents.length > 0) {
			break;
		}

		await fs.promises.rm(currentDir, { recursive: false, force: false });
		if (currentDir === stopAbsolute) {
			break;
		}
		currentDir = path.dirname(currentDir);
	}
}

async function removeStaleCacheFiles(expectedEntries: readonly string[], checkoutPath: string, cwd: string): Promise<void> {
	const checkoutAbsolute = path.join(cwd, checkoutPath);
	const expectedSet = new Set(expectedEntries.map(normalizeGitPath));
	const localFiles = await listLocalCacheFiles(cwd, checkoutPath);
	const removed: string[] = [];

	for (const file of localFiles) {
		if (!file.repoRelativePath.endsWith('.sqlite')) {
			continue;
		}

		const repoRelativePath = normalizeGitPath(file.repoRelativePath);
		if (!expectedSet.has(repoRelativePath)) {
			await removeFileAndEmptyParents(file.absolutePath, checkoutAbsolute);
			removed.push(repoRelativePath);
		}
	}

	if (removed.length > 0) {
		console.log(`[hydrateSimulationCache] Removed ${removed.length} stale cache file(s):`);
		for (const entry of removed) {
			console.log(`  - ${entry}`);
		}
	}
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

function resolveBooleanOption(optionValue: boolean | undefined, envValue: string | undefined, defaultValue: boolean): boolean {
	if (optionValue !== undefined) {
		return optionValue;
	}

	if (envValue !== undefined) {
		const normalized = envValue.trim().toLowerCase();
		if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
			return true;
		}
		if (normalized === '0' || normalized === 'false' || normalized === 'no') {
			return false;
		}
	}

	return defaultValue;
}

async function fetchRemoteBranch(remote: string, branch: string, cwd: string): Promise<string> {
	const fetchEnv = { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' };
	const fetchRef = `${remote}/${branch}`;
	console.log(`[hydrateSimulationCache] Fetching ${fetchRef}.`);
	try {
		await runCommand('git', ['fetch', remote, branch], { cwd, env: fetchEnv, stdio: 'inherit' });
		console.log(`[hydrateSimulationCache] Fetch completed successfully`);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[hydrateSimulationCache] Fetch failed: ${msg}`);
		throw error;
	}
	return fetchRef;
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

async function resolveMergeBase(fetchRef: string, cwd: string): Promise<string> {
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

async function resolveRemoteHead(fetchRef: string, cwd: string): Promise<string> {
	console.log(`[hydrateSimulationCache] Resolving commit for ${fetchRef}`);
	try {
		const revParseResult = await runCommand('git', ['rev-parse', fetchRef], { cwd, stdio: 'pipe' });
		const commit = revParseResult.stdout.trim();
		if (!commit) {
			throw new Error(`git rev-parse did not return a commit for ${fetchRef}.`);
		}
		console.log(`[hydrateSimulationCache] Remote head is ${commit}`);
		return commit;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[hydrateSimulationCache] Failed to resolve remote head: ${msg}`);
		throw error;
	}
}

async function isAncestor(potentialAncestor: string, commit: string, cwd: string): Promise<boolean> {
	const result = await runCommand('git', ['merge-base', '--is-ancestor', potentialAncestor, commit], { cwd, stdio: 'pipe', allowNonZero: true });
	return result.exitCode === 0;
}

async function fetchSimulationCache(remote: string, sourceRef: string, includePattern: string, checkoutPath: string, cwd: string): Promise<void> {
	console.log(`[hydrateSimulationCache] Downloading LFS objects for ${includePattern} from ${remote}@${sourceRef}.`);
	try {
		await runCommand('git', ['lfs', 'fetch', remote, sourceRef, `--include=${includePattern}`, '--exclude='], { cwd, stdio: 'inherit' });
		console.log(`[hydrateSimulationCache] LFS fetch completed`);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`[hydrateSimulationCache] LFS fetch failed: ${msg}`);
		throw error;
	}
}

async function materializeCachePointers(sourceRef: string, checkoutPath: string, cwd: string): Promise<void> {
	const entries = await listRemoteCacheEntries(sourceRef, checkoutPath, cwd);
	const normalizedEntries = entries.map(normalizeGitPath).filter(entry => entry.endsWith('.sqlite'));

	if (normalizedEntries.length === 0) {
		console.warn(`[hydrateSimulationCache] No cache entries found at ${sourceRef}:${checkoutPath}`);
		return;
	}

	await removeStaleCacheFiles(normalizedEntries, checkoutPath, cwd);

	for (const entry of normalizedEntries) {
		console.log(`[hydrateSimulationCache] Restoring ${entry} from ${sourceRef}`);
		const pointerResult = await runCommand('git', ['show', `${sourceRef}:${entry}`], { cwd, stdio: 'pipe' });
		const pointer = parseLfsPointer(pointerResult.stdout, entry);
		const objectPath = resolveLfsObjectPath(pointer.oid, cwd);
		try {
			await fs.promises.access(objectPath, fs.constants.R_OK);
		} catch {
			throw new Error(`[hydrateSimulationCache] LFS object ${pointer.oid} for ${entry} is missing. Ensure git lfs fetch downloaded it.`);
		}

		const targetPath = path.join(cwd, entry);
		await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
		await fs.promises.copyFile(objectPath, targetPath);
	}
}

async function checkoutMaterializedCache(checkoutPath: string, cwd: string): Promise<void> {
	console.log(`[hydrateSimulationCache] Verifying LFS payloads in ${checkoutPath}`);
	await runCommand('git', ['lfs', 'checkout', checkoutPath], { cwd, stdio: 'inherit', allowNonZero: true });
}

function logCacheStats(baseSqlitePath: string, sourceRef: string): void {
	console.log(`[hydrateSimulationCache] Source commit: ${sourceRef}`);
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
	readonly useRemoteHead?: boolean;
}

export async function ensureSimulationCache(options: EnsureSimulationCacheOptions = {}): Promise<void> {
	const cwd = options.cwd ?? REPO_ROOT;
	const remote = resolveStringOption(options.remote, process.env.SIM_CACHE_REMOTE, DEFAULT_REMOTE);
	const branch = resolveStringOption(options.branch, process.env.SIM_CACHE_BRANCH, DEFAULT_BRANCH);
	const remoteUrl = resolveStringOption(options.remoteUrl, process.env.SIM_CACHE_REMOTE_URL, DEFAULT_REMOTE_URL);
	const includePattern = resolveStringOption(options.includePattern, process.env.SIM_CACHE_INCLUDE, CACHE_INCLUDE);
	const checkoutPath = resolveStringOption(options.checkoutPath, process.env.SIM_CACHE_CHECKOUT_PATH, CACHE_DIR);
	const forceRemoteHead = resolveBooleanOption(options.useRemoteHead, process.env.SIM_CACHE_USE_REMOTE_HEAD, false);
	const baseCacheFile = path.join(cwd, checkoutPath, 'base.sqlite');

	// Check if file exists and is not just an LFS pointer (should be > 1KB)
	if (fs.existsSync(baseCacheFile)) {
		const stats = fs.statSync(baseCacheFile);
		if (stats.size > 1024) {
			if (options.verbose) {
				console.log(`[hydrateSimulationCache] Cache already present at ${baseCacheFile} (${stats.size} bytes); verifying consistency with ${remote}/${branch}.`);
			}
		} else {
			console.warn(`[hydrateSimulationCache] Found LFS pointer file (${stats.size} bytes), will hydrate actual content.`);
		}
	} else {
		console.warn(`[hydrateSimulationCache] Cache missing at ${baseCacheFile}. Hydrating from ${remote}/${branch}.`);
	}

	console.log(`[hydrateSimulationCache] Synchronizing cache contents with ${remote}/${branch}.`);

	let shouldUseRemoteHead = forceRemoteHead;

	try {
		await ensureRemoteExists(remote, remoteUrl, cwd);
		const fetchRef = await fetchRemoteBranch(remote, branch, cwd);
		const mergeBase = await resolveMergeBase(fetchRef, cwd);
		const remoteHead = await resolveRemoteHead(fetchRef, cwd);
		if (!shouldUseRemoteHead) {
			const headContainsRemote = await isAncestor(remoteHead, 'HEAD', cwd);
			if (!headContainsRemote) {
				console.warn(`[hydrateSimulationCache] HEAD does not contain ${fetchRef}. Using remote head commit ${remoteHead} for cache hydration.`);
				shouldUseRemoteHead = true;
			}
		} else {
			console.log(`[hydrateSimulationCache] Remote head hydration explicitly enabled via configuration.`);
		}

		const sourceLabel = shouldUseRemoteHead ? 'remote head' : 'merge base';
		const sourceRef = shouldUseRemoteHead ? remoteHead : mergeBase;
		console.log(`[hydrateSimulationCache] Using ${sourceLabel} commit ${sourceRef}.`);
		await fetchSimulationCache(remote, sourceRef, includePattern, checkoutPath, cwd);
		console.log(`[hydrateSimulationCache] Materializing cache payloads from ${sourceLabel} ${sourceRef}.`);
		await materializeCachePointers(sourceRef, checkoutPath, cwd);
		await checkoutMaterializedCache(checkoutPath, cwd);
		logCacheStats(baseCacheFile, sourceRef);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const manual = createManualInstructions(remote, branch, includePattern, checkoutPath, remoteUrl, shouldUseRemoteHead);
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
async function listRemoteCacheEntries(sourceRef: string, checkoutPath: string, cwd: string): Promise<string[]> {
	try {
		const result = await runCommand('git', ['ls-tree', '-r', '--name-only', sourceRef, checkoutPath], { cwd, stdio: 'pipe' });
		return result.stdout.split('\n').map(line => line.trim()).filter(line => line !== '');
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		throw new Error(`[hydrateSimulationCache] Failed to enumerate cache entries from ${sourceRef}:${checkoutPath}: ${msg}`);
	}
}
