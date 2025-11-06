/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import path from 'path';
import { ICompletionsContextService } from '../../context';
import { FileSystem } from '../../fileSystem';
import { createLibTestingContext } from '../../test/context';
import { FakeFileSystem } from '../../test/filesystem';
import { makeFsUri } from '../../util/uri';
import { ComputationStatus, extractRepoInfo, extractRepoInfoInBackground } from '../repository';

suite('Extract repo info tests', function () {
	const baseFolder = { uri: makeFsUri(path.resolve(__dirname, '../../../../../../../../')) };
	const defaultOrg = 'microsoft';
	const defaultRepo = 'vscode-copilot-chat';
	const envRepo = process.env.GITHUB_REPOSITORY?.split('/') ?? [];
	const expectedOrg = (envRepo[0] ?? defaultOrg).toLowerCase();
	const expectedRepo = (envRepo[1] ?? defaultRepo).toLowerCase();
	const expectedRemoteUrls = [
		`git@github.com:${expectedOrg}/${expectedRepo}`,
		`https://github.com/${expectedOrg}/${expectedRepo}`,
		`https://github.com/${expectedOrg}/${expectedRepo}.git`,
	];
	const expectedRemoteUrlsNormalized = expectedRemoteUrls.map(url => url.toLowerCase());
	const expectedPathPrefix = `/${expectedOrg}/${expectedRepo}`;

	class Nested {
		nested: Nested | undefined;
	}

	test('avoid using context as cache key', function () {
		const accessor = createLibTestingContext();
		const ctx = accessor.get(ICompletionsContextService);
		ctx.forceSet(FileSystem, new FakeFileSystem({}));
		const n = new Nested();
		ctx.set(Nested, n);
		n.nested = n;

		const maybe = extractRepoInfoInBackground(accessor, makeFsUri(__filename));

		assert.deepStrictEqual(maybe, ComputationStatus.PENDING);
	});

	test('Extract repo info', async function () {
		const accessor = createLibTestingContext();
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
			{ org: repoId.org.toLowerCase(), repo: repoId.repo.toLowerCase(), type: repoId.type },
			{ org: expectedOrg, repo: expectedRepo, type: 'github' }
		);
		assert.ok(expectedRemoteUrlsNormalized.includes(url.toLowerCase()), `url is ${url}`);
		assert.ok(
			pathname.toLowerCase().startsWith(expectedPathPrefix) || pathname.toLowerCase().startsWith(`/github/${expectedRepo}`),
			`pathname is ${pathname}`
		);

		assert.deepStrictEqual(await extractRepoInfo(accessor, 'file:///tmp/does/not/exist/.git/config'), undefined);
	});

	test('Extract repo info - Jupyter Notebook vscode-notebook-cell ', async function () {
		const cellUri = baseFolder.uri.replace(/^file:/, 'vscode-notebook-cell:');
		assert.ok(cellUri.startsWith('vscode-notebook-cell:'));
		const ctx = createLibTestingContext();
		const info = await extractRepoInfo(ctx, cellUri);

		assert.ok(info);

		// url and pathname get their own special treatment because they depend on how the repo was cloned.
		const { url, pathname, repoId, ...repoInfo } = info;

		assert.deepStrictEqual(repoInfo, {
			baseFolder,
			hostname: 'github.com'
		});
		assert.ok(repoId);
		assert.deepStrictEqual(
			{ org: repoId.org.toLowerCase(), repo: repoId.repo.toLowerCase(), type: repoId.type },
			{ org: expectedOrg, repo: expectedRepo, type: 'github' }
		);
		assert.ok(expectedRemoteUrlsNormalized.includes(url.toLowerCase()), `url is ${url}`);
		assert.ok(
			pathname.toLowerCase().startsWith(expectedPathPrefix) || pathname.toLowerCase().startsWith(`/github/${expectedRepo}`),
			`pathname is ${pathname}`
		);

		assert.deepStrictEqual(await extractRepoInfo(ctx, 'file:///tmp/does/not/exist/.git/config'), undefined);
	});
});
