/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { minVersion, satisfies, type SemVer, valid } from 'semver';

interface IPackageJson {
	readonly engines?: {
		readonly vscode?: string;
	};
}

const workspaceRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(workspaceRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as IPackageJson;

const requiredRange = packageJson.engines?.vscode;
if (!requiredRange) {
	console.warn('[compat] No VS Code engine range found in package.json; skipping compatibility check.');
	process.exit(0);
}

const candidates = dedupe([
	process.env.VSCODE_CLI ?? '',
	process.env.CODE_EXEC_PATH ?? '',
	process.env.VSCODE_EXEC_PATH ?? '',
	process.env.VSCODE_DEV_CMD ?? '',
	'code-insiders',
	'code',
	path.join(workspaceRoot, '..', 'vscode', 'scripts', 'code.sh'),
	path.join(workspaceRoot, '..', 'vscode', 'scripts', 'code.bat')
]);

try {
	const { version: vscodeVersion, command } = resolveVsCodeInfo(candidates);

	if (!valid(vscodeVersion)) {
		process.exit(1);
	}

	const compatible = satisfies(vscodeVersion, requiredRange, { includePrerelease: true });

	if (!compatible) {
		console.error(`[compat] VS Code ${vscodeVersion} does not satisfy required range ${requiredRange}.`);
		console.error('[compat] Update VS Code (Insiders) to a compatible build before launching debug sessions.');
		process.exit(1);
	}

	const minimumVersion = minVersion(requiredRange);
	const requiredBuildDate = extractDateFromSemVer(minimumVersion);
	const buildTimestamp = readVsCodeBuildTimestamp(command);

	if (requiredBuildDate) {
		if (!buildTimestamp) {
			console.error(`[compat] Could not determine VS Code build timestamp to validate required date ${formatDate(requiredBuildDate)}.`);
			process.exit(1);
		}

		if (buildTimestamp < requiredBuildDate) {
			console.error(`[compat] VS Code build ${buildTimestamp.toISOString()} predates required date ${formatDate(requiredBuildDate)}.`);
			console.error('[compat] Update VS Code (Insiders) to a newer build before launching debug sessions.');
			process.exit(1);
		}

		console.log(`[compat] VS Code ${vscodeVersion} (${buildTimestamp.toISOString()}) satisfies required range ${requiredRange}.`);
		process.exit(0);
	}

	console.log(`[compat] VS Code ${vscodeVersion} satisfies required range ${requiredRange}.`);
} catch (error) {
	if (error instanceof Error) {
		console.error(`[compat] ${error.message}`);
	} else {
		console.error('[compat] Unexpected error during VS Code compatibility check.');
	}
	process.exit(1);
}

interface IResolvedVsCodeInfo {
	readonly version: string;
	readonly command: string;
}

function resolveVsCodeInfo(commands: readonly string[]): IResolvedVsCodeInfo {
	const attempted: string[] = [];

	for (const command of commands) {
		if (!command) {
			continue;
		}

		attempted.push(command);
		const result = spawnSync(command, ['--version'], { encoding: 'utf8' });

		if (result.error) {
			continue;
		}

		if (typeof result.status === 'number' && result.status !== 0) {
			continue;
		}

		const stdout = typeof result.stdout === 'string' ? result.stdout : '';
		const version = stdout.trim().split(/\r?\n/)[0];

		if (version) {
			return { version, command };
		}
	}

	throw new Error(`Could not determine VS Code version. Tried: ${attempted.join(', ') || 'no commands'}.`);
}

function readVsCodeBuildTimestamp(command: string): Date | undefined {
	const result = spawnSync(command, ['--status'], { encoding: 'utf8' });

	if (result.error || (typeof result.status === 'number' && result.status !== 0)) {
		return undefined;
	}

	const stdout = typeof result.stdout === 'string' ? result.stdout : '';
	const match = /Version:\s+.+\((?:[^,]+),\s*([0-9T:\.\-]+Z)\)/.exec(stdout);

	if (!match) {
		return undefined;
	}

	const timestamp = new Date(match[1]);
	return Number.isNaN(timestamp.getTime()) ? undefined : timestamp;
}

function extractDateFromSemVer(value: SemVer | null): Date | undefined {
	if (!value || value.prerelease.length === 0) {
		return undefined;
	}

	const token = value.prerelease[0];
	const tokenString = typeof token === 'number' ? token.toString() : token;

	if (typeof tokenString !== 'string' || !/^\d{8}$/.test(tokenString)) {
		return undefined;
	}

	const year = Number(tokenString.slice(0, 4));
	const month = Number(tokenString.slice(4, 6));
	const day = Number(tokenString.slice(6, 8));

	if (month < 1 || month > 12 || day < 1 || day > 31) {
		return undefined;
	}

	return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function dedupe(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const value of values) {
		const normalized = value.trim();
		if (!normalized || seen.has(normalized)) {
			continue;
		}

		seen.add(normalized);
		result.push(normalized);
	}

	return result;
}
