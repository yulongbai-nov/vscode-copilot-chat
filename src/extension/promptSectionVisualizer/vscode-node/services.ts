/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationServiceBuilder } from '../../../util/common/services';
import { SyncDescriptor } from '../../../util/vs/platform/instantiation/common/descriptors';
import {
	IContentRenderer,
	IPromptStateManager,
	ISectionParserService,
	ITokenUsageCalculator
} from '../common/services';
import { ContentRenderer } from '../node/contentRenderer';
import { PromptStateManager } from '../node/promptStateManager';
import { SectionParserService } from '../node/sectionParserService';
import { TokenUsageCalculator } from '../node/tokenUsageCalculator';

/**
 * Register all prompt section visualizer services
 */
export function registerPromptSectionVisualizerServices(builder: IInstantiationServiceBuilder): void {
	// Register service implementations
	builder.define(ISectionParserService, new SyncDescriptor(SectionParserService));
	builder.define(ITokenUsageCalculator, new SyncDescriptor(TokenUsageCalculator));
	builder.define(IContentRenderer, new SyncDescriptor(ContentRenderer));
	builder.define(IPromptStateManager, new SyncDescriptor(PromptStateManager));
}