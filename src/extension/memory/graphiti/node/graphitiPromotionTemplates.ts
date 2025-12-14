/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type GraphitiPromotionKind = 'decision' | 'lesson_learned' | 'preference' | 'procedure' | 'task_update';
export type GraphitiPromotionScope = 'workspace' | 'user';

export function formatGraphitiPromotionEpisode(kind: GraphitiPromotionKind, scope: GraphitiPromotionScope, text: string, now: Date = new Date()): string {
	const cleanedText = text.trim();
	return [
		`<graphiti_episode kind="${kind}">`,
		'source: copilot-chat',
		`scope: ${scope}`,
		`timestamp: ${now.toISOString()}`,
		'content:',
		cleanedText,
		'</graphiti_episode>',
	].join('\n');
}
