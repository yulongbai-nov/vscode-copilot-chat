/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IGitService, getGitHubRepoInfoFromContext, parseRemoteUrl } from '../../../../platform/git/common/gitService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { computeWorkspaceKey } from './graphitiGroupIds';

export type GraphitiWorkspaceScopeKeys = {
	readonly primary: string;
	readonly legacy?: string;
};

export function computeGraphitiWorkspaceScopeKeys(args: {
	readonly gitService: IGitService;
	readonly workspaceService: IWorkspaceService;
}): GraphitiWorkspaceScopeKeys {
	const workspaceFolders = args.workspaceService.getWorkspaceFolders().map(u => u.toString());
	const legacy = computeWorkspaceKey(workspaceFolders);

	const repo = args.gitService.activeRepository.get() ?? args.gitService.repositories[0];
	const githubRepo = repo ? getGitHubRepoInfoFromContext(repo) : undefined;
	if (!githubRepo) {
		return { primary: legacy, legacy };
	}

	const parsed = parseRemoteUrl(githubRepo.remoteUrl);
	const host = parsed?.host;
	if (!host) {
		return { primary: legacy, legacy };
	}

	const primary = `github_repo:${host}/${githubRepo.id.toString()}`;
	return { primary, legacy };
}
