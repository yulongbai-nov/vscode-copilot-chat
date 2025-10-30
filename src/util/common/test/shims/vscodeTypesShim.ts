/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeTypes from '../../../../vscodeTypes';
import { CancellationTokenSource } from '../../../vs/base/common/cancellation';
import { Emitter as EventEmitter } from '../../../vs/base/common/event';
import { URI as Uri } from '../../../vs/base/common/uri';
import { Diagnostic, DiagnosticRelatedInformation } from '../../../vs/workbench/api/common/extHostTypes/diagnostic';
import { Location } from '../../../vs/workbench/api/common/extHostTypes/location';
import { MarkdownString } from '../../../vs/workbench/api/common/extHostTypes/markdownString';
import { NotebookCellData, NotebookCellKind, NotebookData, NotebookEdit, NotebookRange } from '../../../vs/workbench/api/common/extHostTypes/notebooks';
import { Position } from '../../../vs/workbench/api/common/extHostTypes/position';
import { Range } from '../../../vs/workbench/api/common/extHostTypes/range';
import { Selection } from '../../../vs/workbench/api/common/extHostTypes/selection';
import { SnippetString } from '../../../vs/workbench/api/common/extHostTypes/snippetString';
import { SnippetTextEdit } from '../../../vs/workbench/api/common/extHostTypes/snippetTextEdit';
import { SymbolInformation, SymbolKind } from '../../../vs/workbench/api/common/extHostTypes/symbolInformation';
import { EndOfLine, TextEdit } from '../../../vs/workbench/api/common/extHostTypes/textEdit';
import { AISearchKeyword, ChatErrorLevel, ChatImageMimeType, ChatPrepareToolInvocationPart, ChatReferenceBinaryData, ChatReferenceDiagnostic, ChatRequestEditedFileEventKind, ChatRequestEditorData, ChatRequestNotebookData, ChatRequestTurn, ChatResponseAnchorPart, ChatResponseClearToPreviousToolInvocationReason, ChatResponseCodeblockUriPart, ChatResponseCodeCitationPart, ChatResponseCommandButtonPart, ChatResponseConfirmationPart, ChatResponseExtensionsPart, ChatResponseExternalEditPart, ChatResponseFileTreePart, ChatResponseMarkdownPart, ChatResponseMarkdownWithVulnerabilitiesPart, ChatResponseMovePart, ChatResponseNotebookEditPart, ChatResponseProgressPart, ChatResponseProgressPart2, ChatResponsePullRequestPart, ChatResponseReferencePart, ChatResponseReferencePart2, ChatResponseTextEditPart, ChatResponseThinkingProgressPart, ChatResponseTurn, ChatResponseTurn2, ChatResponseWarningPart, ChatSessionStatus, ChatToolInvocationPart, ExcludeSettingOptions, LanguageModelChatMessageRole, LanguageModelDataPart, LanguageModelDataPart2, LanguageModelError, LanguageModelPartAudience, LanguageModelPromptTsxPart, LanguageModelTextPart, LanguageModelTextPart2, LanguageModelThinkingPart, LanguageModelToolCallPart, LanguageModelToolExtensionSource, LanguageModelToolMCPSource, LanguageModelToolResult, LanguageModelToolResult2, LanguageModelToolResultPart, LanguageModelToolResultPart2, TextSearchMatch2 } from './chatTypes';
import { TextDocumentChangeReason, TextEditorSelectionChangeKind, WorkspaceEdit } from './editing';
import { ChatLocation, ChatVariableLevel, DiagnosticSeverity, ExtensionMode, FileType, TextEditorCursorStyle, TextEditorLineNumbersStyle, TextEditorRevealType } from './enums';
import { t } from './l10n';
import { NewSymbolName, NewSymbolNameTag, NewSymbolNameTriggerKind } from './newSymbolName';
import { TerminalShellExecutionCommandLineConfidence } from './terminal';

const shim: typeof vscodeTypes = {
	Position,
	Range,
	Selection,
	EventEmitter,
	CancellationTokenSource,
	Diagnostic,
	Location,
	DiagnosticRelatedInformation,
	TextEdit,
	WorkspaceEdit: <any>WorkspaceEdit,
	Uri,
	MarkdownString,
	DiagnosticSeverity,
	TextEditorCursorStyle,
	TextEditorLineNumbersStyle,
	TextEditorRevealType,
	EndOfLine,
	l10n: {
		t
	},
	ExtensionMode,
	ChatVariableLevel,
	ChatResponseClearToPreviousToolInvocationReason,
	ChatResponseMarkdownPart,
	ChatResponseFileTreePart,
	ChatResponseAnchorPart,
	ChatResponseMovePart,
	ChatResponseExtensionsPart,
	ChatResponseProgressPart,
	ChatResponseProgressPart2,
	ChatResponseWarningPart,
	ChatResponseReferencePart,
	ChatResponseReferencePart2,
	ChatResponseCodeCitationPart,
	ChatResponseCommandButtonPart,
	ChatResponseExternalEditPart,
	ChatResponseMarkdownWithVulnerabilitiesPart,
	ChatResponseCodeblockUriPart,
	ChatResponseTextEditPart,
	ChatResponseNotebookEditPart,
	ChatResponseConfirmationPart,
	ChatPrepareToolInvocationPart,
	ChatRequestTurn,
	ChatResponseTurn,
	ChatRequestEditorData,
	ChatRequestNotebookData,
	NewSymbolName,
	NewSymbolNameTag,
	NewSymbolNameTriggerKind,
	ChatLocation,
	SymbolInformation: SymbolInformation as any,
	LanguageModelToolResult,
	ExtendedLanguageModelToolResult: LanguageModelToolResult,
	LanguageModelToolResult2,
	LanguageModelPromptTsxPart,
	LanguageModelTextPart,
	LanguageModelDataPart,
	LanguageModelToolExtensionSource,
	LanguageModelToolMCPSource,
	ChatImageMimeType,
	ChatReferenceBinaryData,
	ChatReferenceDiagnostic,
	TextSearchMatch2,
	AISearchKeyword,
	ExcludeSettingOptions,
	NotebookCellKind,
	NotebookRange,
	NotebookEdit,
	NotebookCellData,
	NotebookData,
	ChatErrorLevel,
	TerminalShellExecutionCommandLineConfidence,
	ChatRequestEditedFileEventKind,
	ChatResponsePullRequestPart,
	LanguageModelTextPart2,
	LanguageModelDataPart2,
	LanguageModelThinkingPart,
	LanguageModelPartAudience,
	ChatResponseThinkingProgressPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	LanguageModelToolResultPart2,
	LanguageModelChatMessageRole,
	TextEditorSelectionChangeKind,
	TextDocumentChangeReason,
	ChatToolInvocationPart,
	ChatResponseTurn2,
	ChatRequestTurn2: ChatRequestTurn,
	LanguageModelError: LanguageModelError as any, // Some difference in the definition of Error is breaking this
	SymbolKind,
	SnippetString,
	SnippetTextEdit,
	FileType,
	ChatSessionStatus
};

export = shim;
