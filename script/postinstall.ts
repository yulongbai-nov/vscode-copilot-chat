/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { downloadZMQ } from '@vscode/zeromq';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { compressTikToken } from './build/compressTikToken';
import { copyStaticAssets } from './build/copyStaticAssets';

export interface ITreeSitterGrammar {
	name: string;
	/**
	 * A custom .wasm filename if the grammar node module doesn't follow the standard naming convention
	 */
	filename?: string;
	/**
	 * The path where we should spawn `tree-sitter build-wasm`
	 */
	projectPath?: string;
}

const treeSitterGrammars: ITreeSitterGrammar[] = [
	{
		name: 'tree-sitter-c-sharp',
		filename: 'tree-sitter-c_sharp.wasm' // non-standard filename
	},
	{
		name: 'tree-sitter-cpp',
	},
	{
		name: 'tree-sitter-go',
	},
	{
		name: 'tree-sitter-javascript', // Also includes jsx support
	},
	{
		name: 'tree-sitter-python',
	},
	{
		name: 'tree-sitter-ruby',
	},
	{
		name: 'tree-sitter-typescript',
		projectPath: 'tree-sitter-typescript/typescript', // non-standard path
	},
	{
		name: 'tree-sitter-tsx',
		projectPath: 'tree-sitter-typescript/tsx', // non-standard path
	},
	{
		name: 'tree-sitter-java',
	},
	{
		name: 'tree-sitter-rust',
	},
	{
		name: 'tree-sitter-php'
	}
];

const REPO_ROOT = path.join(__dirname, '..');
const SIMULATION_CACHE_DIR = 'test/simulation/cache';
const SIMULATION_CACHE_INCLUDE = `${SIMULATION_CACHE_DIR}/*`;
const BASE_CACHE_FILE = path.join(REPO_ROOT, SIMULATION_CACHE_DIR, 'base.sqlite');
const UPSTREAM_REMOTE = 'upstream';
const UPSTREAM_URL = 'https://github.com/microsoft/vscode-copilot-chat.git';

async function runCommand(command: string, args: readonly string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: 'inherit' });
		child.on('error', error => {
			reject(new Error(`${command} ${args.join(' ')} failed to start: ${error.message}`));
		});
		child.on('close', code => {
			if (code !== 0) {
				reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
				return;
			}
			resolve();
		});
	});
}

async function ensureRemoteExists(remote: string, url: string): Promise<void> {
	const exists = await new Promise<boolean>((resolve) => {
		const child = spawn('git', ['remote', 'get-url', remote], { cwd: REPO_ROOT, stdio: 'ignore' });
		child.on('error', () => resolve(false));
		child.on('close', code => resolve(code === 0));
	});

	if (!exists) {
		await runCommand('git', ['remote', 'add', remote, url], REPO_ROOT);
	}
}

async function ensureSimulationCache(): Promise<void> {
	if (fs.existsSync(BASE_CACHE_FILE)) {
		return;
	}

	console.warn(`Base simulation cache absent at ${BASE_CACHE_FILE}. Attempting to fetch from ${UPSTREAM_REMOTE}.`);

	try {
		await ensureRemoteExists(UPSTREAM_REMOTE, UPSTREAM_URL);
		await runCommand('git', ['lfs', 'fetch', UPSTREAM_REMOTE, 'main', `--include=${SIMULATION_CACHE_INCLUDE}`, '--exclude='], REPO_ROOT);
		await runCommand('git', ['lfs', 'checkout', SIMULATION_CACHE_DIR], REPO_ROOT);
	} catch (error) {
		throw new Error(`Unable to populate simulation cache automatically. Fetch from upstream manually by running:\n  git remote add ${UPSTREAM_REMOTE} ${UPSTREAM_URL}\n  git lfs fetch ${UPSTREAM_REMOTE} main --include="${SIMULATION_CACHE_INCLUDE}" --exclude=""\n  git lfs checkout ${SIMULATION_CACHE_DIR}\n${error instanceof Error ? `Inner error: ${error.message}` : ''}`);
	}

	if (!fs.existsSync(BASE_CACHE_FILE)) {
		throw new Error(`Base cache file is still missing after fetch. Run the manual commands listed above and rerun npm install.`);
	}
}

/**
 * Clones the zeromq.js repository from a specific commit into node_modules/zeromq
 * @param commit The git commit hash to checkout
 */
async function cloneZeroMQ(commit: string): Promise<void> {
	const zeromqPath = path.join(REPO_ROOT, 'node_modules', 'zeromq');

	// Remove existing zeromq directory if it exists
	if (fs.existsSync(zeromqPath)) {
		await fs.promises.rm(zeromqPath, { recursive: true, force: true });
	}

	return new Promise((resolve, reject) => {
		// Clone the repository
		const cloneProcess = spawn('git', ['clone', 'https://github.com/rebornix/zeromq.js.git', zeromqPath], {
			cwd: REPO_ROOT,
			stdio: 'inherit'
		});

		cloneProcess.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`Git clone failed with exit code ${code}`));
				return;
			}

			// Checkout the specific commit
			const checkoutProcess = spawn('git', ['checkout', commit], {
				cwd: zeromqPath,
				stdio: 'inherit'
			});

			checkoutProcess.on('close', (checkoutCode) => {
				if (checkoutCode !== 0) {
					reject(new Error(`Git checkout failed with exit code ${checkoutCode}`));
					return;
				}
				resolve();
			});

			checkoutProcess.on('error', (error) => {
				reject(new Error(`Git checkout error: ${error.message}`));
			});
		});

		cloneProcess.on('error', (error) => {
			reject(new Error(`Git clone error: ${error.message}`));
		});
	});
}

/**
 * @github/copilot depends on sharp which has native dependencies that are hard to distribute.
 * This function creates a shim for the sharp module that @github/copilot expects.
 * The shim provides a minimal implementation of the sharp API to satisfy @github/copilot's requirements.
 * Its non-functional and only intended to make the module load without errors.
 *
 * We create a directory @github/copilot/node_modules/sharp, so that
 * the node module resolution algorithm finds our shim instead of trying to load the real sharp module. This also ensure the shims are specific to this package.
 */
async function createCopilotCliSharpShim() {
	const copilotCli = path.join(REPO_ROOT, 'node_modules', '@github', 'copilot');
	const sharpShim = path.join(copilotCli, 'node_modules', 'sharp');

	const copilotPackageJsonFile = path.join(copilotCli, 'package.json');
	const copilotPackageJson = JSON.parse(fs.readFileSync(copilotPackageJsonFile, 'utf-8'));
	if (copilotPackageJson.dependencies) {
		delete copilotPackageJson.dependencies.sharp;
	}

	await fs.promises.writeFile(copilotPackageJsonFile, JSON.stringify(copilotPackageJson, undefined, 2), 'utf-8');
	await fs.promises.rm(sharpShim, { recursive: true, force: true });
	await fs.promises.mkdir(path.join(sharpShim, 'lib'), { recursive: true });
	await fs.promises.writeFile(path.join(sharpShim, 'package.json'), JSON.stringify({
		"name": "sharp",
		"type": "commonjs",
		"main": "lib/index.js"
	}, undefined, 2));
	await fs.promises.writeFile(path.join(sharpShim, 'lib', 'index.js'), `
const Sharp = function (inputBuffer, options) {
	if (arguments.length === 1 && !is.defined(input)) {
		throw new Error('Invalid input');
	}
	if (!(this instanceof Sharp)) {
		return new Sharp(input, options);
	}
	this.inputBuffer = inputBuffer;
	return this;
};

Sharp.prototype.resize = function () {
	const that = this;
	const img = {
		toBuffer: () => that.inputBuffer,
		png: () => img,
		jpeg: () => img
	};
	return img;
};

module.exports = Sharp;
`);

}

async function main() {
	await fs.promises.mkdir(path.join(REPO_ROOT, '.build'), { recursive: true });

	const vendoredTiktokenFiles = ['src/platform/tokenizer/node/cl100k_base.tiktoken', 'src/platform/tokenizer/node/o200k_base.tiktoken'];

	for (const tokens of vendoredTiktokenFiles) {
		await compressTikToken(tokens, `dist/${path.basename(tokens)}`);
	}

	// copy static assets to dist
	await copyStaticAssets([
		...treeSitterGrammars.map(grammar => `node_modules/@vscode/tree-sitter-wasm/wasm/${grammar.name}.wasm`),
		'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm',
	], 'dist');

	// Clone zeromq.js from specific commit
	await cloneZeroMQ('1cbebce3e17801bea63a4dcc975b982923cb4592');

	await downloadZMQ();

	await createCopilotCliSharpShim();

	await ensureSimulationCache();

	await copyStaticAssets([
		`node_modules/@anthropic-ai/claude-code/cli.js`,
		`node_modules/@anthropic-ai/claude-code/yoga.wasm`,
		// `node_modules/@anthropic-ai/claude-code/vendor/ripgrep/${process.arch}-${process.platform}/ripgrep`,
	], 'dist');
}

main();
