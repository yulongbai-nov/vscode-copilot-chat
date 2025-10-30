/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../../../util/vs/platform/instantiation/common/instantiation';
import { ICompletionsContextService } from '../context';
import { Logger, LogTarget } from '../logger';
import { NotificationSender } from '../notificationSender';
import { UrlOpener } from '../util/opener';

const CERTIFICATE_ERRORS = ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_SIGNATURE_FAILURE'];
const errorMsg =
	'Your proxy connection requires a trusted certificate. Please make sure the proxy certificate and any issuers are configured correctly and trusted by your operating system.';
const learnMoreLink = 'https://gh.io/copilot-network-errors';

export class UserErrorNotifier {
	private readonly notifiedErrorCodes: string[] = [];

	notifyUser(accessor: ServicesAccessor, e: unknown) {
		if (!(e instanceof Error)) { return; }
		const error: NodeJS.ErrnoException = e;
		if (error.code && CERTIFICATE_ERRORS.includes(error.code) && !this.didNotifyBefore(error.code)) {
			this.notifiedErrorCodes.push(error.code);
			void this.displayCertificateErrorNotification(accessor, error);
		}
	}

	private async displayCertificateErrorNotification(accessor: ServicesAccessor, err: NodeJS.ErrnoException) {
		const logTarget = accessor.get(ICompletionsContextService).get(LogTarget);
		new Logger('certificates').error(
			logTarget,
			`${errorMsg} Please visit ${learnMoreLink} to learn more. Original cause:`,
			err
		);
		const learnMoreAction = { title: 'Learn more' };
		const ctx = accessor.get(ICompletionsContextService);
		return ctx
			.get(NotificationSender)
			.showWarningMessage(errorMsg, learnMoreAction)
			.then(userResponse => {
				if (userResponse?.title === learnMoreAction.title) {
					return ctx.get(UrlOpener).open(learnMoreLink);
				}
			});
	}

	private didNotifyBefore(code: string) {
		return this.notifiedErrorCodes.indexOf(code) !== -1;
	}
}
