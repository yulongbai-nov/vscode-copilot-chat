/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import path from 'path';
import { execSync } from 'child_process';
import { createLibTestingContext } from '../../test/context';
import { makeFsUri } from '../../util/uri';
import { extractRepoInfo } from '../repository';
import { IInstantiationService } from '../../../../../../../util/vs/platform/instantiation/common/instantiation';

suite('Extract repo info tests', function () {
	const repositoryRoot = path.resolve(__dirname, '../../../../../../../../');
	const baseFolder = { uri: makeFsUri(repositoryRoot) };
	const expectedRepo = getExpectedGithubRepo(repositoryRoot);
	const expectedRepoPathLower = `${expectedRepo.org}/${expectedRepo.repo}`.toLowerCase();
	const expectedRepoUrlPattern = buildGithubUrlPattern(expectedRepo);

	test('Extract repo info', async function () {
		const accessor = createLibTestingContext().createTestingAccessor();
		const info = await extractRepoInfo(accessor, baseFolder.uri);

		assert.ok(info);

		// url and pathname get their own special treatment because they depend on how the repo was cloned.
		const { url, pathname, repoId, ...repoInfo } = info;

		assert.deepStrictEqual(repoInfo, {
			baseFolder,
			hostname: 'github.com'
		});
		assert.ok(repoId);
		assert.deepStrictEqual(
			{ org: repoId.org, repo: repoId.repo, type: repoId.type },
			{ org: expectedRepo.org, repo: expectedRepo.repo, type: 'github' }
		);
		assert.ok(
			expectedRepoUrlPattern.test(url),
			`url is ${url}`
		);
		assert.ok(
			normalizePathname(pathname).startsWith(expectedRepoPathLower),
			`pathname is ${pathname}`
		);

		assert.deepStrictEqual(await extractRepoInfo(accessor, 'file:///tmp/does/not/exist/.git/config'), undefined);
	});

	test('Extract repo info - Jupyter Notebook vscode-notebook-cell ', async function () {
		const cellUri = baseFolder.uri.replace(/^file:/, 'vscode-notebook-cell:');
		assert.ok(cellUri.startsWith('vscode-notebook-cell:'));
		const accessor = createLibTestingContext().createTestingAccessor();
		const instantiationService = accessor.get(IInstantiationService);
		const info = await extractRepoInfo(accessor, cellUri);

		assert.ok(info);

		// url and pathname get their own special treatment because they depend on how the repo was cloned.
		const { url, pathname, repoId, ...repoInfo } = info;

		assert.deepStrictEqual(repoInfo, {
			baseFolder,
			hostname: 'github.com'
		});
		assert.ok(repoId);
		assert.deepStrictEqual(
			{ org: repoId.org, repo: repoId.repo, type: repoId.type },
			{ org: expectedRepo.org, repo: expectedRepo.repo, type: 'github' }
		);
		assert.ok(
			expectedRepoUrlPattern.test(url),
			`url is ${url}`
		);
		assert.ok(
			normalizePathname(pathname).startsWith(expectedRepoPathLower),
			`pathname is ${pathname}`
		);

		assert.deepStrictEqual(await instantiationService.invokeFunction(extractRepoInfo, 'file:///tmp/does/not/exist/.git/config'), undefined);
	});
});

function getExpectedGithubRepo(repoRoot: string): { org: string; repo: string } {
	const remoteUrl = execSync('git config --get remote.origin.url', { cwd: repoRoot, encoding: 'utf8' }).trim();
	const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i);
	assert.ok(match, `Unexpected git remote.origin.url: ${remoteUrl}`);
	const [, org, repo] = match;
	return { org, repo };
}

function buildGithubUrlPattern(repo: { org: string; repo: string }): RegExp {
	const escapedOrg = escapeForRegex(repo.org);
	const escapedRepo = escapeForRegex(repo.repo);
	return new RegExp(`github\\.com[:/]${escapedOrg}/${escapedRepo}(?:\\.git)?$`, 'i');
}

function escapeForRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePathname(pathname: string): string {
	return pathname.replace(/^\/+/, '').toLowerCase();
}
