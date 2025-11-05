/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../platform/log/common/logService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { ParseError } from '../common/types';
import { VisualizerTelemetryService } from './telemetryService';

/**
 * Error severity levels for UI display
 */
export enum ErrorSeverity {
	Info = 'info',
	Warning = 'warning',
	Error = 'error',
	Critical = 'critical'
}

/**
 * Error information for UI display
 */
export interface ErrorInfo {
	severity: ErrorSeverity;
	message: string;
	details?: string;
	position?: number;
	recoverable: boolean;
	timestamp: Date;
}

/**
 * Error recovery strategy result
 */
export interface RecoveryResult {
	success: boolean;
	message: string;
	fallbackData?: Record<string, unknown>;
}

/**
 * Centralized error handler for the Prompt Section Visualizer
 */
export class ErrorHandler extends Disposable {
	private readonly errorHistory: ErrorInfo[] = [];
	private readonly maxHistorySize = 100;
	private readonly telemetryService?: VisualizerTelemetryService;

	constructor(
		private readonly logService: ILogService,
		telemetryService?: ITelemetryService
	) {
		super();

		if (telemetryService) {
			this.telemetryService = new VisualizerTelemetryService(telemetryService);
			this._register(this.telemetryService);
		}
	}

	/**
	 * Handle parser errors with recovery strategies
	 */
	handleParserError(error: ParseError, prompt: string): RecoveryResult {
		const errorInfo: ErrorInfo = {
			severity: this.getParserErrorSeverity(error.type),
			message: error.message,
			position: error.position,
			recoverable: true,
			timestamp: new Date()
		};

		this.recordError(errorInfo);

		// Track parser error in telemetry
		this.telemetryService?.trackParserError(error, prompt.length);

		switch (error.type) {
			case 'MALFORMED_TAG':
				return this.recoverFromMalformedTag(error, prompt);
			case 'UNCLOSED_TAG':
				return this.recoverFromUnclosedTag(error, prompt);
			case 'INVALID_NESTING':
				return this.recoverFromInvalidNesting(error, prompt);
			default:
				return this.fallbackToPlainText(prompt);
		}
	}

	/**
	 * Handle tokenization errors with retry logic
	 */
	handleTokenizationError(error: Error, sectionId: string, retryCount: number = 0): RecoveryResult {
		const errorInfo: ErrorInfo = {
			severity: retryCount > 2 ? ErrorSeverity.Error : ErrorSeverity.Warning,
			message: `Token calculation failed for section ${sectionId}`,
			details: error.message,
			recoverable: retryCount < 3,
			timestamp: new Date()
		};

		this.recordError(errorInfo);

		// Track tokenization error in telemetry
		this.telemetryService?.trackTokenCalculationFailure(error.message, retryCount);

		if (retryCount < 3) {
			this.logService.warn(`Token calculation failed (attempt ${retryCount + 1}/3): ${error.message}`);
			return {
				success: false,
				message: 'Retrying token calculation',
				fallbackData: { shouldRetry: true, retryCount: retryCount + 1 }
			};
		} else {
			this.logService.error(`Token calculation failed after 3 attempts: ${error.message}`);
			return {
				success: false,
				message: 'Using character-based estimation',
				fallbackData: { useCharacterEstimate: true }
			};
		}
	}

	/**
	 * Handle content rendering errors with fallback
	 */
	handleRenderingError(error: Error, sectionId: string, content: string): RecoveryResult {
		const errorInfo: ErrorInfo = {
			severity: ErrorSeverity.Warning,
			message: `Content rendering failed for section ${sectionId}`,
			details: error.message,
			recoverable: true,
			timestamp: new Date()
		};

		this.recordError(errorInfo);
		this.logService.warn(`Content rendering failed for section ${sectionId}: ${error.message}`);

		// Track rendering error in telemetry
		this.telemetryService?.trackRenderingError(sectionId, error.message, content.length);

		return {
			success: true,
			message: 'Using plain text fallback',
			fallbackData: { plainText: content, renderingDisabled: true }
		};
	}

	/**
	 * Handle state synchronization errors
	 */
	handleStateSyncError(error: Error, operation: string): RecoveryResult {
		const errorInfo: ErrorInfo = {
			severity: ErrorSeverity.Error,
			message: `State synchronization failed during ${operation}`,
			details: error.message,
			recoverable: false,
			timestamp: new Date()
		};

		this.recordError(errorInfo);
		this.logService.error(`State sync error during ${operation}: ${error.message}`);

		// Track state sync error in telemetry
		this.telemetryService?.trackStateSyncError(operation, error.message);

		return {
			success: false,
			message: 'State synchronization failed. Please refresh the visualizer.',
			fallbackData: { requiresRefresh: true }
		};
	}

	/**
	 * Handle WebView communication errors
	 */
	handleWebViewError(error: Error, messageType: string): RecoveryResult {
		const errorInfo: ErrorInfo = {
			severity: ErrorSeverity.Warning,
			message: `WebView communication error for message type: ${messageType}`,
			details: error.message,
			recoverable: true,
			timestamp: new Date()
		};

		this.recordError(errorInfo);
		this.logService.warn(`WebView communication error (${messageType}): ${error.message}`);

		// Track WebView error in telemetry
		this.telemetryService?.trackWebViewError(messageType, error.message);

		return {
			success: false,
			message: 'Communication error. Retrying...',
			fallbackData: { shouldRetry: true }
		};
	}

	/**
	 * Get non-intrusive error indicators for UI
	 */
	getUIErrorIndicators(): ErrorInfo[] {
		// Return only recent, user-facing errors
		const recentErrors = this.errorHistory
			.filter(e => e.severity !== ErrorSeverity.Info)
			.slice(-5); // Last 5 errors

		return recentErrors;
	}

	/**
	 * Show output channel for detailed error logging
	 */
	showOutputChannel(): void {
		// Log service doesn't have a show method, but errors are logged to the output channel
		this.logService.info('Prompt Section Visualizer error log');
	}

	/**
	 * Clear error history
	 */
	clearErrorHistory(): void {
		this.errorHistory.length = 0;
		this.logService.info('Error history cleared');
	}

	/**
	 * Log general error
	 */
	logError(message: string, error?: Error): void {
		const errorInfo: ErrorInfo = {
			severity: ErrorSeverity.Error,
			message,
			details: error?.message,
			recoverable: false,
			timestamp: new Date()
		};

		this.recordError(errorInfo);
		this.logService.error(`${message}${error ? `: ${error.message}` : ''}`);
		if (error?.stack) {
			this.logService.error(error.stack);
		}
	}

	/**
	 * Log warning
	 */
	logWarning(message: string, details?: string): void {
		const errorInfo: ErrorInfo = {
			severity: ErrorSeverity.Warning,
			message,
			details,
			recoverable: true,
			timestamp: new Date()
		};

		this.recordError(errorInfo);
		this.logService.warn(`${message}${details ? `: ${details}` : ''}`);
	}

	/**
	 * Log info
	 */
	logInfo(message: string): void {
		this.logService.info(message);
	}

	/**
	 * Record error in history
	 */
	private recordError(errorInfo: ErrorInfo): void {
		this.errorHistory.push(errorInfo);

		// Maintain max history size
		if (this.errorHistory.length > this.maxHistorySize) {
			this.errorHistory.shift();
		}
	}

	/**
	 * Get parser error severity
	 */
	private getParserErrorSeverity(errorType: ParseError['type']): ErrorSeverity {
		switch (errorType) {
			case 'MALFORMED_TAG':
				return ErrorSeverity.Warning;
			case 'UNCLOSED_TAG':
				return ErrorSeverity.Warning;
			case 'INVALID_NESTING':
				return ErrorSeverity.Error;
			default:
				return ErrorSeverity.Error;
		}
	}

	/**
	 * Recover from malformed tag error
	 */
	private recoverFromMalformedTag(error: ParseError, _prompt: string): RecoveryResult {
		this.logService.warn(`Malformed tag at position ${error.position}: ${error.message}`);
		this.logService.info('Attempting to parse remaining valid sections');

		return {
			success: true,
			message: 'Parsed valid sections, malformed tags shown as plain text',
			fallbackData: { partialParse: true }
		};
	}

	/**
	 * Recover from unclosed tag error
	 */
	private recoverFromUnclosedTag(error: ParseError, _prompt: string): RecoveryResult {
		this.logService.warn(`Unclosed tag at position ${error.position}: ${error.message}`);
		this.logService.info('Attempting to auto-close tags');

		return {
			success: true,
			message: 'Auto-closed unclosed tags',
			fallbackData: { autoClosedTags: true }
		};
	}

	/**
	 * Recover from invalid nesting error
	 */
	private recoverFromInvalidNesting(error: ParseError, _prompt: string): RecoveryResult {
		this.logService.error(`Invalid nesting at position ${error.position}: ${error.message}`);
		this.logService.info('Flattening nested structure');

		return {
			success: true,
			message: 'Flattened deeply nested sections',
			fallbackData: { flattenedStructure: true }
		};
	}

	/**
	 * Fallback to plain text when parsing fails completely
	 */
	private fallbackToPlainText(prompt: string): RecoveryResult {
		this.logService.warn('Falling back to plain text display');

		return {
			success: true,
			message: 'Displaying as plain text',
			fallbackData: { plainTextMode: true, content: prompt }
		};
	}
}
