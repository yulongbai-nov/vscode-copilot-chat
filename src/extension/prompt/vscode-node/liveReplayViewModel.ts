/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LiveRequestReplaySection, LiveRequestReplaySnapshot } from '../common/liveRequestEditorModel';

export interface ReplayChatViewModel {
	readonly summaryLines: string[];
	readonly sectionMarkdown: string[];
	readonly overflowMessage?: string;
	readonly trimmedMessage?: string;
}

export function buildReplayChatViewModel(
	snapshot: LiveRequestReplaySnapshot,
	formatSection: (section: LiveRequestReplaySection) => string
): ReplayChatViewModel {
	const projection = snapshot.projection;
	if (!projection) {
		return { summaryLines: ['Nothing to replay.'], sectionMarkdown: [] };
	}

	const summaryLines: string[] = [];
	const editedSummary: string[] = [];
	const stateLabel = snapshot.state === 'forkActive' ? 'input enabled' : snapshot.state;
	const sourceLabel = snapshot.debugName ?? snapshot.key.sessionId;
	summaryLines.push(`**Replay edited prompt** · ${sourceLabel}`);
	summaryLines.push(`State: ${stateLabel}${snapshot.staleReason ? ` (${snapshot.staleReason})` : ''}`);
	summaryLines.push(`Sections: ${projection.totalSections}${projection.overflowCount > 0 ? ` (+${projection.overflowCount} more)` : ''}`);
	editedSummary.push(`Edited: ${projection.editedCount}`);
	editedSummary.push(`Deleted: ${projection.deletedCount}`);
	if (projection.trimmed) {
		editedSummary.push('Trimmed: yes');
	}
	summaryLines.push(editedSummary.join(' · '));
	if (snapshot.updatedAt) {
		summaryLines.push(`Updated: ${new Date(snapshot.updatedAt).toLocaleTimeString()}`);
	}

	const sectionMarkdown: string[] = projection.sections.map(section => formatSection(section));

	return {
		summaryLines,
		sectionMarkdown,
		overflowMessage: projection.overflowCount > 0 ? `…and ${projection.overflowCount} more sections not shown.` : undefined,
		trimmedMessage: projection.trimmed ? '⚠️ Prompt was trimmed; replay may omit truncated content.' : undefined
	};
}
