/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AuthenticationSession } from 'vscode';

export interface GraphitiActorIdentity {
	readonly provider: 'github';
	readonly accountId: string;
	readonly accountLabel: string;
}

export function getGraphitiActorIdentityFromGitHubSession(session: AuthenticationSession | undefined): GraphitiActorIdentity | undefined {
	if (!session?.account?.id) {
		return undefined;
	}

	return {
		provider: 'github',
		accountId: session.account.id,
		accountLabel: session.account.label ?? '',
	};
}

export function getGraphitiUserScopeKeyFromGitHubSession(session: AuthenticationSession | undefined): string | undefined {
	const identity = getGraphitiActorIdentityFromGitHubSession(session);
	if (!identity) {
		return undefined;
	}

	// Prefix to avoid collisions with legacy random keys.
	return `github:${identity.accountId}`;
}

export function getGraphitiUserScopeKeys(args: {
	readonly gitHubSession: AuthenticationSession | undefined;
	readonly legacyUserScopeKey: string | undefined;
}): readonly string[] {
	const keys: string[] = [];

	const primary = getGraphitiUserScopeKeyFromGitHubSession(args.gitHubSession);
	if (primary) {
		keys.push(primary);
	}

	// Back-compat: include the legacy random user scope key if present.
	if (args.legacyUserScopeKey && !keys.includes(args.legacyUserScopeKey)) {
		keys.push(args.legacyUserScopeKey);
	}

	return keys;
}

