/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type GraphitiRoleType = 'user' | 'assistant' | 'system';

export interface GraphitiMessage {
	readonly content: string;
	readonly uuid?: string | null;
	readonly name?: string;
	readonly role_type: GraphitiRoleType;
	readonly role: string | null;
	readonly timestamp?: string;
	readonly source_description?: string;
}

export interface GraphitiAddMessagesRequest {
	readonly group_id: string;
	readonly messages: readonly GraphitiMessage[];
}

export interface GraphitiResult {
	readonly message: string;
	readonly success: boolean;
}

export interface GraphitiHealthcheckResponse {
	readonly status: string;
}

export interface GraphitiFactResult {
	readonly uuid: string;
	readonly name: string;
	readonly fact: string;
	readonly valid_at?: string | null;
	readonly invalid_at?: string | null;
	readonly created_at: string;
	readonly expired_at?: string | null;
}

export interface GraphitiSearchResults {
	readonly facts: readonly GraphitiFactResult[];
}

export interface GraphitiSearchQuery {
	readonly group_ids?: readonly string[] | null;
	readonly query: string;
	readonly max_facts?: number;
}

export interface GraphitiGetMemoryRequest {
	readonly group_id: string;
	readonly max_facts?: number;
	readonly center_node_uuid: string | null;
	readonly messages: readonly GraphitiMessage[];
}

export interface GraphitiGetMemoryResponse {
	readonly facts: readonly GraphitiFactResult[];
}

