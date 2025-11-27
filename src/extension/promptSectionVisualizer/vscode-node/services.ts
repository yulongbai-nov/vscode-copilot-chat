/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationServiceBuilder } from '../../../util/common/services';
import { SyncDescriptor } from '../../../util/vs/platform/instantiation/common/descriptors';
import {
	IContentRenderer,
	IFeatureFlagService,
	INativeChatRenderer,
	IPromptStateManager,
	IPromptVisualizerController,
	IPromptVisualizerChatParticipant,
	ISectionEditorService,
	ISectionParserService,
	ITokenUsageCalculator
} from '../common/services';
import { ContentRenderer } from '../node/contentRenderer';
import { PromptStateManager } from '../node/promptStateManager';
import { SectionParserService } from '../node/sectionParserService';
import { TokenUsageCalculator } from '../node/tokenUsageCalculator';
import { PromptVisualizerChatParticipant } from './chatParticipant';
import { FeatureFlagService } from './featureFlagService';
import { NativeChatRenderer } from './nativeChatRenderer';
import { SectionEditorService } from './sectionEditorService';
import { PromptVisualizerController } from './controller';

/**
 * Register all prompt section visualizer services
 */
export function registerPromptSectionVisualizerServices(builder: IInstantiationServiceBuilder): void {
	// Register service implementations
	builder.define(ISectionParserService, new SyncDescriptor(SectionParserService));
	builder.define(ITokenUsageCalculator, new SyncDescriptor(TokenUsageCalculator));
	builder.define(IContentRenderer, new SyncDescriptor(ContentRenderer));
	builder.define(IPromptStateManager, new SyncDescriptor(PromptStateManager));
	builder.define(IFeatureFlagService, new SyncDescriptor(FeatureFlagService));
	builder.define(INativeChatRenderer, new SyncDescriptor(NativeChatRenderer));
	builder.define(IPromptVisualizerChatParticipant, new SyncDescriptor(PromptVisualizerChatParticipant));
	builder.define(ISectionEditorService, new SyncDescriptor(SectionEditorService));
	builder.define(IPromptVisualizerController, new SyncDescriptor(PromptVisualizerController));
}
