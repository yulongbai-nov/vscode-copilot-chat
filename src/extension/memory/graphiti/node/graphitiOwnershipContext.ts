/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GraphitiActorIdentity } from '../common/graphitiIdentity';

export function formatGraphitiOwnershipContextEpisode(args: {
	readonly scope: 'session' | 'workspace' | 'user';
	readonly owner?: GraphitiActorIdentity;
	readonly workspaceFolderBasenames: readonly string[];
	readonly git?: { branch?: string; commit?: string; dirty?: boolean };
	readonly now: Date;
}): string {
	const ownerLabel = args.owner?.accountLabel ? `"${args.owner.accountLabel}"` : undefined;
	const ownerId = args.owner?.accountId ? `id: ${args.owner.accountId}` : undefined;
	const ownerDetails = [ownerLabel, ownerId].filter(Boolean).join(', ');
	const ownerLine = ownerDetails ? `Owner: GitHub account ${ownerDetails}.` : 'Owner: (unknown).';

	const folderNames = args.workspaceFolderBasenames.filter(Boolean);
	const foldersLine = folderNames.length
		? `Workspace folders (basenames): ${folderNames.join(', ')}.`
		: 'Workspace folders (basenames): (none).';

	const gitPieces: string[] = [];
	if (args.git?.branch) {
		gitPieces.push(`branch=${args.git.branch}`);
	}
	if (args.git?.commit) {
		gitPieces.push(`commit=${args.git.commit}`);
	}
	if (args.git?.dirty !== undefined) {
		gitPieces.push(`dirty=${String(args.git.dirty)}`);
	}
	const gitLine = gitPieces.length ? `Git: ${gitPieces.join(' ')}.` : undefined;

	return [
		`<graphiti_episode kind="ownership_context">`,
		'source: copilot-chat',
		`timestamp: ${args.now.toISOString()}`,
		`scope: ${args.scope}`,
		ownerLine,
		foldersLine,
		...(gitLine ? [gitLine] : []),
		`The Owner owns this ${args.scope} scope and its assets.`,
		`</graphiti_episode>`,
	].join('\n');
}

