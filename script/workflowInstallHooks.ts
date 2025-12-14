/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import * as path from 'node:path';

function main() {
	const repoRoot = execGit(['rev-parse', '--show-toplevel']);
	if (!repoRoot) {
		process.stderr.write('workflow:install-hooks: not a git repository\n');
		process.exit(2);
	}

	const hooksPath = '.githooks';
	execGit(['config', 'core.hooksPath', hooksPath]);

	ensureExecutable(repoRoot, hooksPath, 'pre-commit');
	ensureExecutable(repoRoot, hooksPath, 'pre-push');

	process.stdout.write(`Installed git hooksPath: ${hooksPath}\n`);
	process.stdout.write('To uninstall: git config --unset core.hooksPath\n');
}

function ensureExecutable(repoRoot: string, hooksPath: string, hookName: string): void {
	try {
		const hookPath = path.join(repoRoot, hooksPath, hookName);
		if (!existsSync(hookPath)) {
			return;
		}
		chmodSync(hookPath, 0o755);
	} catch {
		// Best-effort; never fail install on chmod problems.
	}
}

function execGit(args: string[]): string {
	try {
		return execFileSync('git', args, { encoding: 'utf8' }).trim();
	} catch {
		return '';
	}
}

main();
