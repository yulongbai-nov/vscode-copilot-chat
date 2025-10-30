/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands } from 'vscode';
import { CodeReference } from '.';
import { IInstantiationService } from '../../../../../../util/vs/platform/instantiation/common/instantiation';
import { onCopilotToken } from '../../../lib/src/auth/copilotTokenNotifier';
import { CitationManager, IPDocumentCitation } from '../../../lib/src/citationManager';
import { OutputPaneShowCommand } from '../../../lib/src/snippy/constants';
import { copilotOutputLogTelemetry } from '../../../lib/src/snippy/telemetryHandlers';
import { notify } from './matchNotifier';
import { GitHubCopilotLogger } from './outputChannel';

/**
 * Citation manager that logs citations to the VS Code log. On the first citation encountered,
 * the user gets a notification.
 */
export class LoggingCitationManager extends CitationManager {
	private logger?: GitHubCopilotLogger;

	constructor(
		private codeReference: CodeReference,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		const disposable = instantiationService.invokeFunction(onCopilotToken, _ => {
			if (this.logger) {
				return;
			}
			this.logger = instantiationService.createInstance(GitHubCopilotLogger);
			const initialNotificationCommand = commands.registerCommand(OutputPaneShowCommand, () =>
				this.logger?.forceShow()
			);
			this.codeReference.addDisposable(initialNotificationCommand);
		});
		this.codeReference.addDisposable(disposable);
	}

	async handleIPCodeCitation(citation: IPDocumentCitation): Promise<void> {
		if (!this.codeReference.enabled || !this.logger || citation.details.length === 0) {
			return;
		}

		const start = citation.location?.start;
		const matchLocation = start ? `[Ln ${start.line + 1}, Col ${start.character + 1}]` : 'Location not available';
		const shortenedMatchText = `${citation.matchingText
			?.slice(0, 100)
			.replace(/[\r\n\t]+|^[ \t]+/gm, ' ')
			.trim()}...`;

		this.logger.info(citation.inDocumentUri, `Similar code at `, matchLocation, shortenedMatchText);
		for (const detail of citation.details) {
			const { license, url } = detail;
			this.logger.info(`License: ${license.replace('NOASSERTION', 'unknown')}, URL: ${url}`);
		}
		copilotOutputLogTelemetry.handleWrite({ instantiationService: this.instantiationService });
		await this.instantiationService.invokeFunction(notify);
	}
}
