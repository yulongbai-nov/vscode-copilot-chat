/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertNever } from '../../../../util/vs/base/common/assert';
import { vBoolean, vEnum, vObj, vRequired, vString, vUndefined, vUnion } from '../../../configuration/common/validator';

export type RecentlyViewedDocumentsOptions = {
	readonly nDocuments: number;
	readonly maxTokens: number;
	readonly includeViewedFiles: boolean;
}

export type LanguageContextLanguages = { [languageId: string]: boolean };

export type LanguageContextOptions = {
	readonly enabled: boolean;
	readonly maxTokens: number;
}

export type DiffHistoryOptions = {
	readonly nEntries: number;
	readonly maxTokens: number;
	readonly onlyForDocsInPrompt: boolean;
	readonly useRelativePaths: boolean;
}

export type PagedClipping = { pageSize: number };

export type CurrentFileOptions = {
	readonly maxTokens: number;
	readonly includeTags: boolean;
	readonly prioritizeAboveCursor: boolean;
}

export type PromptOptions = {
	readonly promptingStrategy: PromptingStrategy | undefined /* default */;
	readonly currentFile: CurrentFileOptions;
	readonly pagedClipping: PagedClipping;
	readonly recentlyViewedDocuments: RecentlyViewedDocumentsOptions;
	readonly languageContext: LanguageContextOptions;
	readonly diffHistory: DiffHistoryOptions;
	readonly includePostScript: boolean;
}

/**
 * Prompt strategies that tweak prompt in a way that's different from current prod prompting strategy.
 */
export enum PromptingStrategy {
	/**
	 * Original Xtab unified model prompting strategy.
	 */
	UnifiedModel = 'xtabUnifiedModel',
	Codexv21NesUnified = 'codexv21nesUnified',
	Nes41Miniv3 = 'nes41miniv3',
	SimplifiedSystemPrompt = 'simplifiedSystemPrompt',
	Xtab275 = 'xtab275',
}

export enum ResponseFormat {
	CodeBlock = 'codeBlock',
	UnifiedWithXml = 'unifiedWithXml',
	EditWindowOnly = 'editWindowOnly',
}

export namespace ResponseFormat {
	export function fromPromptingStrategy(strategy: PromptingStrategy | undefined): ResponseFormat {
		switch (strategy) {
			case PromptingStrategy.UnifiedModel:
			case PromptingStrategy.Codexv21NesUnified:
			case PromptingStrategy.Nes41Miniv3:
				return ResponseFormat.UnifiedWithXml;
			case PromptingStrategy.Xtab275:
				return ResponseFormat.EditWindowOnly;
			case PromptingStrategy.SimplifiedSystemPrompt:
			case undefined:
				return ResponseFormat.CodeBlock;
			default:
				assertNever(strategy);
		}
	}
}

export const DEFAULT_OPTIONS: PromptOptions = {
	promptingStrategy: undefined,
	currentFile: {
		maxTokens: 2000,
		includeTags: true,
		prioritizeAboveCursor: false,
	},
	pagedClipping: {
		pageSize: 10,
	},
	recentlyViewedDocuments: {
		nDocuments: 5,
		maxTokens: 2000,
		includeViewedFiles: false,
	},
	languageContext: {
		enabled: false,
		maxTokens: 2000,
	},
	diffHistory: {
		nEntries: 25,
		maxTokens: 1000,
		onlyForDocsInPrompt: false,
		useRelativePaths: false,
	},
	includePostScript: true,
};

// TODO: consider a better per language setting/experiment approach
export const LANGUAGE_CONTEXT_ENABLED_LANGUAGES: LanguageContextLanguages = {
	'prompt': true,
	'instructions': true,
	'chatmode': true,
};

export interface ModelConfiguration {
	modelName: string;
	promptingStrategy: PromptingStrategy | undefined /* default */;
	includeTagsInCurrentFile: boolean;
}

export const MODEL_CONFIGURATION_VALIDATOR = vObj({
	'modelName': vRequired(vString()),
	'promptingStrategy': vUnion(vEnum(...Object.values(PromptingStrategy)), vUndefined()),
	'includeTagsInCurrentFile': vRequired(vBoolean()),
});
