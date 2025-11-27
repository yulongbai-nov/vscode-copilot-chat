/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITelemetryService, TelemetryEventProperties } from '../../../platform/telemetry/common/telemetry';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { ParseError } from '../common/types';

/**
 * Telemetry event names for the Prompt Section Visualizer
 */
export const enum TelemetryEvents {
	// Feature usage events
	VisualizerEnabled = 'promptSectionVisualizer.enabled',
	VisualizerDisabled = 'promptSectionVisualizer.disabled',
	SectionParsed = 'promptSectionVisualizer.sectionParsed',
	SectionEdited = 'promptSectionVisualizer.sectionEdited',
	SectionReordered = 'promptSectionVisualizer.sectionReordered',
	SectionAdded = 'promptSectionVisualizer.sectionAdded',
	SectionDeleted = 'promptSectionVisualizer.sectionDeleted',
	SectionCollapsed = 'promptSectionVisualizer.sectionCollapsed',
	SectionExpanded = 'promptSectionVisualizer.sectionExpanded',

	// View / mode events
	VisualizerShow = 'promptSectionVisualizer.view.show',
	VisualizerToggle = 'promptSectionVisualizer.view.toggle',
	VisualizerModeSwitch = 'promptSectionVisualizer.mode.switch',

	// Token calculation events
	TokenCalculationSuccess = 'promptSectionVisualizer.tokenCalculation.success',
	TokenCalculationFailure = 'promptSectionVisualizer.tokenCalculation.failure',
	TokenCalculationPerformance = 'promptSectionVisualizer.tokenCalculation.performance',

	// Error events
	ParserError = 'promptSectionVisualizer.error.parser',
	RenderingError = 'promptSectionVisualizer.error.rendering',
	StateSyncError = 'promptSectionVisualizer.error.stateSync',
	WebViewError = 'promptSectionVisualizer.error.webview',

	// Performance events
	ParsePerformance = 'promptSectionVisualizer.performance.parse',
	RenderPerformance = 'promptSectionVisualizer.performance.render',
	StateUpdatePerformance = 'promptSectionVisualizer.performance.stateUpdate'
}

/**
 * Telemetry service for the Prompt Section Visualizer
 * Tracks feature usage, errors, and performance metrics
 */
export class VisualizerTelemetryService extends Disposable {
	private readonly performanceMarks: Map<string, number> = new Map();

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
		super();
	}

	/**
	 * Track visualizer enabled event
	 */
	trackVisualizerEnabled(): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.VisualizerEnabled, {
			timestamp: new Date().toISOString()
		});
	}

	/**
	 * Track visualizer disabled event
	 */
	trackVisualizerDisabled(): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.VisualizerDisabled, {
			timestamp: new Date().toISOString()
		});
	}

	/**
	 * Track visualizer show event by surface
	 */
	trackVisualizerShown(surface: 'inline' | 'standalone', sectionCount: number): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.VisualizerShow, {
			surface
		}, {
			sectionCount
		});
	}

	/**
	 * Track visualizer toggle event
	 */
	trackVisualizerToggled(enabled: boolean): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.VisualizerToggle, {
			enabled: String(enabled)
		});
	}

	/**
	 * Track render mode switch event
	 */
	trackModeSwitched(from: 'inline' | 'standalone', to: 'inline' | 'standalone', persisted: boolean): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.VisualizerModeSwitch, {
			from,
			to,
			persisted: String(persisted)
		});
	}

	/**
	 * Track section parsing event
	 */
	trackSectionParsed(sectionCount: number, hasErrors: boolean, errorCount: number): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.SectionParsed, {
			hasErrors: String(hasErrors)
		}, {
			sectionCount,
			errorCount
		});
	}

	/**
	 * Track section edit event
	 */
	trackSectionEdited(sectionId: string, contentLength: number): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.SectionEdited, {
			sectionId: this.anonymizeSectionId(sectionId)
		}, {
			contentLength
		});
	}

	/**
	 * Track section reorder event
	 */
	trackSectionReordered(sectionCount: number): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.SectionReordered, {}, {
			sectionCount
		});
	}

	/**
	 * Track section add event
	 */
	trackSectionAdded(tagName: string): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.SectionAdded, {
			tagName
		});
	}

	/**
	 * Track section delete event
	 */
	trackSectionDeleted(tagName: string): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.SectionDeleted, {
			tagName
		});
	}

	/**
	 * Track section collapse event
	 */
	trackSectionCollapsed(tagName: string, tokenCount: number): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.SectionCollapsed, {
			tagName
		}, {
			tokenCount
		});
	}

	/**
	 * Track section expand event
	 */
	trackSectionExpanded(tagName: string, tokenCount: number): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.SectionExpanded, {
			tagName
		}, {
			tokenCount
		});
	}

	/**
	 * Track successful token calculation
	 */
	trackTokenCalculationSuccess(sectionCount: number, totalTokens: number, durationMs: number): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.TokenCalculationSuccess, {}, {
			sectionCount,
			totalTokens,
			durationMs
		});
	}

	/**
	 * Track token calculation failure
	 */
	trackTokenCalculationFailure(errorMessage: string, retryCount: number): void {
		this.telemetryService.sendMSFTTelemetryErrorEvent(TelemetryEvents.TokenCalculationFailure, {
			errorMessage: this.sanitizeErrorMessage(errorMessage)
		}, {
			retryCount
		});
	}

	/**
	 * Track token calculation performance
	 */
	trackTokenCalculationPerformance(sectionCount: number, durationMs: number, cacheHitRate: number): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.TokenCalculationPerformance, {}, {
			sectionCount,
			durationMs,
			cacheHitRate
		});
	}

	/**
	 * Track parser error
	 */
	trackParserError(error: ParseError, promptLength: number): void {
		this.telemetryService.sendMSFTTelemetryErrorEvent(TelemetryEvents.ParserError, {
			errorType: error.type,
			errorMessage: this.sanitizeErrorMessage(error.message)
		}, {
			position: error.position,
			promptLength
		});
	}

	/**
	 * Track rendering error
	 */
	trackRenderingError(sectionId: string, errorMessage: string, contentLength: number): void {
		this.telemetryService.sendMSFTTelemetryErrorEvent(TelemetryEvents.RenderingError, {
			sectionId: this.anonymizeSectionId(sectionId),
			errorMessage: this.sanitizeErrorMessage(errorMessage)
		}, {
			contentLength
		});
	}

	/**
	 * Track state synchronization error
	 */
	trackStateSyncError(operation: string, errorMessage: string): void {
		this.telemetryService.sendMSFTTelemetryErrorEvent(TelemetryEvents.StateSyncError, {
			operation,
			errorMessage: this.sanitizeErrorMessage(errorMessage)
		});
	}

	/**
	 * Track WebView communication error
	 */
	trackWebViewError(messageType: string, errorMessage: string): void {
		this.telemetryService.sendMSFTTelemetryErrorEvent(TelemetryEvents.WebViewError, {
			messageType,
			errorMessage: this.sanitizeErrorMessage(errorMessage)
		});
	}

	/**
	 * Start performance measurement
	 */
	startPerformanceMeasure(operationId: string): void {
		this.performanceMarks.set(operationId, Date.now());
	}

	/**
	 * End performance measurement and track
	 */
	endPerformanceMeasure(operationId: string, eventName: TelemetryEvents, additionalProperties?: TelemetryEventProperties): void {
		const startTime = this.performanceMarks.get(operationId);
		if (startTime) {
			const durationMs = Date.now() - startTime;
			this.performanceMarks.delete(operationId);

			this.telemetryService.sendMSFTTelemetryEvent(eventName, additionalProperties || {}, {
				durationMs
			});
		}
	}

	/**
	 * Track parse performance
	 */
	trackParsePerformance(promptLength: number, sectionCount: number, durationMs: number): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.ParsePerformance, {}, {
			promptLength,
			sectionCount,
			durationMs
		});
	}

	/**
	 * Track render performance
	 */
	trackRenderPerformance(sectionCount: number, hasRichContent: boolean, durationMs: number): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.RenderPerformance, {
			hasRichContent: String(hasRichContent)
		}, {
			sectionCount,
			durationMs
		});
	}

	/**
	 * Track state update performance
	 */
	trackStateUpdatePerformance(operation: string, durationMs: number): void {
		this.telemetryService.sendMSFTTelemetryEvent(TelemetryEvents.StateUpdatePerformance, {
			operation
		}, {
			durationMs
		});
	}

	/**
	 * Anonymize section ID to avoid PII
	 */
	private anonymizeSectionId(sectionId: string): string {
		// Return a hash or generic identifier instead of the actual ID
		return `section-${sectionId.length}`;
	}

	/**
	 * Sanitize error message to remove potential PII
	 */
	private sanitizeErrorMessage(message: string): string {
		// Remove file paths, user names, and other potential PII
		return message
			.replace(/\/[^\s]+/g, '[path]')
			.replace(/\\[^\s]+/g, '[path]')
			.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[email]')
			.substring(0, 200); // Limit length
	}
}
