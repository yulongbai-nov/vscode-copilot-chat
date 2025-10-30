/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IRange } from './textDocument';

export interface IPCitationDetail {
	license: string;
	url: string;
}

export interface IPDocumentCitation {
	inDocumentUri: string;
	offsetStart: number;
	offsetEnd: number;
	version?: number;
	location?: IRange;
	matchingText?: string;
	details: IPCitationDetail[];
}

export abstract class CitationManager {
	abstract handleIPCodeCitation(citation: IPDocumentCitation): Promise<void>;
}

export class NoOpCitationManager extends CitationManager {
	async handleIPCodeCitation(citation: IPDocumentCitation): Promise<void> {
		// Do nothing
	}
}