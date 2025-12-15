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

function getGraphitiUserScopeKeyFromGitHubLogin(identity: GraphitiActorIdentity): string | undefined {
	const login = identity.accountLabel.trim();
	if (!login) {
		return undefined;
	}
	return `github_login:${login.toLowerCase()}`;
}

function getGraphitiUserScopeKeyFromGitHubAccountId(identity: GraphitiActorIdentity): string {
	return `github_account_id:${identity.accountId}`;
}

export function getGraphitiUserScopeKeyFromGitHubSession(session: AuthenticationSession | undefined): string | undefined {
	const identity = getGraphitiActorIdentityFromGitHubSession(session);
	if (!identity) {
		return undefined;
	}

	return getGraphitiUserScopeKeyFromGitHubLogin(identity) ?? getGraphitiUserScopeKeyFromGitHubAccountId(identity);
}

export function getGraphitiLegacyUserScopeKeyFromGitHubSession(session: AuthenticationSession | undefined): string | undefined {
	const identity = getGraphitiActorIdentityFromGitHubSession(session);
	if (!identity) {
		return undefined;
	}

	// Back-compat: older builds used this format directly.
	return `github:${identity.accountId}`;
}

export function getGraphitiUserScopeKeys(args: {
	readonly gitHubSession: AuthenticationSession | undefined;
	readonly legacyUserScopeKey: string | undefined;
}): readonly string[] {
	const keys: string[] = [];

	const identity = getGraphitiActorIdentityFromGitHubSession(args.gitHubSession);
	if (identity) {
		const loginKey = getGraphitiUserScopeKeyFromGitHubLogin(identity);
		if (loginKey) {
			keys.push(loginKey);
		}

		const accountIdKey = getGraphitiUserScopeKeyFromGitHubAccountId(identity);
		if (!keys.includes(accountIdKey)) {
			keys.push(accountIdKey);
		}

		const legacyFormat = getGraphitiLegacyUserScopeKeyFromGitHubSession(args.gitHubSession);
		if (legacyFormat && !keys.includes(legacyFormat)) {
			keys.push(legacyFormat);
		}
	}

	// Back-compat: include the legacy random user scope key if present.
	if (args.legacyUserScopeKey && !keys.includes(args.legacyUserScopeKey)) {
		keys.push(args.legacyUserScopeKey);
	}

	return keys;
}
