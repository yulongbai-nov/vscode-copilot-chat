/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { NotebookDocumentSnapshot } from '../../../platform/editing/common/notebookDocumentSnapshot';
import { TextDocumentSnapshot } from '../../../platform/editing/common/textDocumentSnapshot';
import { ThinkingData } from '../../../platform/thinking/common/thinking';
import { ResourceMap } from '../../../util/vs/base/common/map';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { ChatRequest } from '../../../vscodeTypes';
import { getToolName } from '../../tools/common/toolNames';
import { IToolGrouping } from '../../tools/common/virtualTools/virtualToolTypes';
import { ChatVariablesCollection } from './chatVariablesCollection';
import { Conversation, Turn } from './conversation';

// TODO Move these to Conversation
export interface IToolCall {
	name: string;
	arguments: string;
	id: string;
}

export interface IToolCallRound {
	id: string;
	summary?: string;
	response: string;
	toolInputRetry: number;
	toolCalls: IToolCall[];
	thinking?: ThinkingData;
	statefulMarker?: string;
}

export interface InternalToolReference extends vscode.ChatLanguageModelToolReference {
	readonly id: string;
	readonly input?: Object; // Allows to pass input to tool invocations internally
}

export namespace InternalToolReference {
	export function from(base: vscode.ChatLanguageModelToolReference): InternalToolReference {
		return {
			...base,
			id: generateUuid(),
			name: getToolName(base.name),
		};
	}
}

export interface IBuildPromptContext {
	readonly requestId?: string;
	readonly query: string;
	readonly history: readonly Turn[];
	readonly chatVariables: ChatVariablesCollection;
	readonly workingSet?: IWorkingSet;
	readonly tools?: {
		readonly toolReferences: readonly InternalToolReference[];
		readonly toolInvocationToken: vscode.ChatParticipantToolToken;
		readonly availableTools: readonly vscode.LanguageModelToolInformation[];
		readonly inSubAgent?: boolean;
	};
	readonly modeInstructions?: vscode.ChatRequestModeInstructions;

	/**
	 * The accumulated tool call rounds for the current ongoing response.
	 */
	readonly toolCallRounds?: readonly IToolCallRound[];
	readonly toolCallResults?: Record<string, vscode.LanguageModelToolResult>;
	readonly toolGrouping?: IToolGrouping;

	/**
	 * Models are encouraged to make parallel tool calls. Sometimes, they even
	 * do. If this happens for edit calls, because the application of text edits
	 * is async, we need to keep track of the edited versions of documented we
	 * see otherwise there is a race condition that can lead to garbled edits.
	 *
	 * This property is used by edit tools to stash their edited documents within
	 * an edit turn, and will try to reuse a previous tool's version of the
	 * document when available. The map is created anew each turn.
	 */
	turnEditedDocuments?: ResourceMap<NotebookDocumentSnapshot | TextDocumentSnapshot>;

	readonly editedFileEvents?: readonly vscode.ChatRequestEditedFileEvent[];
	readonly conversation?: Conversation;
	readonly request?: ChatRequest;
	readonly stream?: vscode.ChatResponseStream;
	readonly isContinuation?: boolean;
}

export enum WorkingSetEntryState {
	Initial = 0,
	Undecided = 1,
	Accepted = 2,
	Rejected = 3,
}

export interface ITextDocumentWorkingSetEntry {
	readonly document: TextDocumentSnapshot;
	readonly range?: vscode.Range;
	readonly state: WorkingSetEntryState;
	readonly isMarkedReadonly: boolean | undefined;
}

export interface INotebookWorkingSetEntry {
	readonly document: NotebookDocumentSnapshot;
	readonly range?: vscode.Range;
	readonly state: WorkingSetEntryState;
	readonly isMarkedReadonly: boolean | undefined;
}


export type IWorkingSetEntry = ITextDocumentWorkingSetEntry | INotebookWorkingSetEntry;

export type IWorkingSet = readonly IWorkingSetEntry[];

export function isTextDocumentWorkingSetEntry(entry: IWorkingSetEntry): entry is ITextDocumentWorkingSetEntry {
	return (entry.document instanceof TextDocumentSnapshot);
}

export function isNotebookWorkingSetEntry(entry: IWorkingSetEntry): entry is INotebookWorkingSetEntry {
	return (entry.document instanceof NotebookDocumentSnapshot);
}
