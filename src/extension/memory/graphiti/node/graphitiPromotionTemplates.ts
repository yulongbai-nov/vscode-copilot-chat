/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type GraphitiPromotionKind = 'decision' | 'lesson_learned' | 'preference' | 'procedure' | 'task_update';
export type GraphitiPromotionScope = 'workspace' | 'user';

export function formatGraphitiPromotionEpisode(kind: GraphitiPromotionKind, scope: GraphitiPromotionScope, text: string, now: Date = new Date()): string {
	const cleanedText = text.trim();
	return [
		'Copilot Chat Memory',
		`kind: ${kind}`,
		`scope: ${scope}`,
		`timestamp: ${now.toISOString()}`,
		'---',
		cleanedText,
	].join('\n');
}

