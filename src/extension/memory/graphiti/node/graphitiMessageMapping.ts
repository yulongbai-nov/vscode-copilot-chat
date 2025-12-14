/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GraphitiMessage } from './graphitiTypes';

const TRUNCATION_MARKER = '\n…[truncated]';

export function truncateForGraphiti(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}

	if (maxChars <= TRUNCATION_MARKER.length) {
		return text.slice(0, maxChars);
	}

	return `${text.slice(0, maxChars - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

export function mapChatTurnToGraphitiMessages(args: {
	readonly turnId?: string;
	readonly userMessage: string;
	readonly assistantMessage: string;
	readonly timestamp: Date;
	readonly maxMessageChars: number;
	readonly sourceDescription?: string;
}): readonly GraphitiMessage[] {
	const timestamp = args.timestamp.toISOString();
	const sourceDescription = args.sourceDescription?.trim();
	const sourceDescriptionFields = sourceDescription ? { source_description: sourceDescription } : {};
	const turnNamePrefix = args.turnId ? `copilotchat.turn.${args.turnId}` : undefined;

	return [
		{
			role_type: 'user',
			role: 'user',
			...(turnNamePrefix ? { name: `${turnNamePrefix}.user` } : {}),
			content: truncateForGraphiti(args.userMessage, args.maxMessageChars),
			timestamp,
			...sourceDescriptionFields,
		},
		{
			role_type: 'assistant',
			role: 'assistant',
			...(turnNamePrefix ? { name: `${turnNamePrefix}.assistant` } : {}),
			content: truncateForGraphiti(args.assistantMessage, args.maxMessageChars),
			timestamp,
			...sourceDescriptionFields,
		},
	];
}
