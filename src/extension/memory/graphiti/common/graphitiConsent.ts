/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const GraphitiWorkspaceConsentStorageKey = 'github.copilot.chat.memory.graphiti.consent.v1';

export interface GraphitiConsentRecordV1 {
	readonly version: 1;
	readonly endpoint: string;
	readonly consentedAt: string;
}

export type GraphitiConsentRecord = GraphitiConsentRecordV1;

export function isGraphitiConsentRecord(value: unknown): value is GraphitiConsentRecord {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const record = value as Partial<GraphitiConsentRecordV1>;
	return record.version === 1
		&& typeof record.endpoint === 'string'
		&& typeof record.consentedAt === 'string';
}

