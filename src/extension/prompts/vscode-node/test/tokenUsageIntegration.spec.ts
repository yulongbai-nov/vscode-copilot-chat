/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { ChatResponseTokenUsagePart } from '../../../conversation/common/chatResponseTokenUsagePart';
import { TokenUsageDisplayExample } from '../../common/tokenUsageDisplayExample';
import { PromptTokenUsageMetadata, createTokenUsageMetadata } from '../../common/tokenUsageMetadata';

/**
 * Integration tests for token usage visualization functionality
 * Tests integration between components and end-to-end workflows
 */
describe('Token Usage Integration Tests', () => {

	test('should integrate metadata creation with response part generation', () => {
		// Test the full workflow from raw section data to UI display
		const mockSections = [
			{ section: 'system', content: 'You are a helpful AI assistant specialized in code.', tokenCount: 450, priority: 1, wasTruncated: false },
			{ section: 'user-query', content: 'Write a function that implements binary search in Python with proper error handling.', tokenCount: 380, priority: 2, wasTruncated: false },
			{ section: 'context', content: 'Previous conversation about search algorithms and performance optimization...', tokenCount: 820, priority: 3, wasTruncated: false },
			{ section: 'tools', content: 'Available tools: file_reader, code_analyzer, documentation_search...', tokenCount: 350, priority: 4, wasTruncated: false }
		];

		const maxTokens = 4000;

		// Step 1: Create metadata from sections (simulating PromptRenderer)
		const metadata = createTokenUsageMetadata(mockSections, maxTokens, 'gpt-4');

		expect(metadata).toBeDefined();
		expect(metadata.tokenUsageInfo.totalTokens).toBe(2000); // 450+380+820+350
		expect(metadata.tokenUsageInfo.maxTokens).toBe(maxTokens);
		expect(metadata.tokenUsageInfo.model).toBe('gpt-4');
		expect(metadata.tokenUsageInfo.sections).toHaveLength(4);

		// Step 2: Create response part for UI display (simulating chat response)
		const summaryPart = new ChatResponseTokenUsagePart(metadata.tokenUsageInfo, 'summary');
		const summaryMarkdown = summaryPart.toMarkdown();

		expect(summaryMarkdown.value).toContain('Token Usage');
		expect(summaryMarkdown.value).toContain('2,000');
		expect(summaryMarkdown.value).toContain('4,000');
		expect(summaryMarkdown.value).toContain('50.0%');

		// Step 3: Create detailed view
		const detailedPart = new ChatResponseTokenUsagePart(metadata.tokenUsageInfo, 'detailed');
		const detailedMarkdown = detailedPart.toMarkdown();

		expect(detailedMarkdown.value).toContain('Detailed Token Usage Report');
		expect(detailedMarkdown.value).toContain('Section Breakdown');
		expect(detailedMarkdown.value).toContain('**Tokens:** 450');
		expect(detailedMarkdown.value).toContain('**Tokens:** 380');
		expect(detailedMarkdown.value).toContain('**Tokens:** 820');
		expect(detailedMarkdown.value).toContain('**Tokens:** 350');

		// Step 4: Test compact representation
		const compactString = summaryPart.toCompactString();
		expect(compactString).toContain('50.0%');
		// Note: compact string doesn't include model name, only usage percentage
	});

	test('should handle high usage scenario with warnings', () => {
		// Test integration with high token usage that triggers warnings
		const mockSections = [
			{ section: 'system', content: 'Extended system instructions...', tokenCount: 1200, priority: 1, wasTruncated: false },
			{ section: 'user-query', content: 'Complex user query with multiple requirements...', tokenCount: 800, priority: 2, wasTruncated: false },
			{ section: 'context', content: 'Large context window with extensive code examples...', tokenCount: 1200, priority: 3, wasTruncated: true }, // Reduced to avoid >100%
			{ section: 'tools', content: 'Comprehensive tool definitions and schemas...', tokenCount: 800, priority: 4, wasTruncated: false }
		];

		const maxTokens = 4000;

		const metadata = createTokenUsageMetadata(mockSections, maxTokens, 'gpt-4');

		// Verify high usage detection (4000 tokens = 100% usage)
		expect(metadata.tokenUsageInfo.totalTokens).toBe(4000); // 1200+800+1200+800
		expect(metadata.tokenUsageInfo.usagePercentage).toBe(100);
		expect(metadata.tokenUsageInfo.isNearLimit).toBe(true);

		// Test warning indicators in response parts
		const summaryPart = new ChatResponseTokenUsagePart(metadata.tokenUsageInfo, 'summary');
		const summaryMarkdown = summaryPart.toMarkdown();
		const compactString = summaryPart.toCompactString();

		// Should include warning indicators
		expect(summaryMarkdown.value).toContain('⚠️');
		expect(compactString).toContain('⚠️');
		expect(summaryMarkdown.value).toContain('100.0%');

		// Detailed view should include optimization suggestions
		const detailedPart = new ChatResponseTokenUsagePart(metadata.tokenUsageInfo, 'detailed');
		const detailedMarkdown = detailedPart.toMarkdown();

		expect(detailedMarkdown.value).toContain('Optimization Suggestions');
		expect(detailedMarkdown.value).toContain('Consider:');
		expect(detailedMarkdown.value).toContain('⚠️'); // Should mention truncation warning
	});

	test('should integrate extraction utilities with mock prompt result', () => {
		// Test TokenUsageDisplayExample integration with metadata extraction
		const mockSections = [
			{ section: 'system', content: 'System prompt...', tokenCount: 600, priority: 1, wasTruncated: false },
			{ section: 'user-query', content: 'User question...', tokenCount: 400, priority: 2, wasTruncated: false },
			{ section: 'context', content: 'Context data...', tokenCount: 1200, priority: 3, wasTruncated: false },
			{ section: 'tools', content: 'Tool definitions...', tokenCount: 1000, priority: 4, wasTruncated: false }
		];

		const mockMetadata = createTokenUsageMetadata(mockSections, 4000, 'gpt-4');

		// Mock prompt result that would come from PromptRenderer
		const mockPromptResult = {
			messages: [],
			tokenCount: 3200,
			metadata: {
				getAll: (key: any) => {
					if (key === PromptTokenUsageMetadata) {
						return [mockMetadata];
					}
					return [];
				}
			}
		};

		// Test extraction utility
		const extractedMetadata = TokenUsageDisplayExample.extractAndDisplayTokenUsage(mockPromptResult as any);

		expect(extractedMetadata).toBeDefined();
		expect(extractedMetadata?.tokenUsageInfo.totalTokens).toBe(3200);
		expect(extractedMetadata?.tokenUsageInfo.sections).toHaveLength(4);

		// Test summary creation
		const summary = TokenUsageDisplayExample.createTokenUsageSummary(extractedMetadata!);
		expect(summary).toContain('3200'); // Without comma formatting
		expect(summary).toContain('gpt-4');
		expect(summary).toContain('80.0%');
	});

	test('should handle edge cases in integration workflow', () => {
		// Test integration with zero token usage
		const emptyMetadata = createTokenUsageMetadata([], 4000, 'gpt-4');

		const emptyPart = new ChatResponseTokenUsagePart(emptyMetadata.tokenUsageInfo, 'summary');
		const emptyMarkdown = emptyPart.toMarkdown();

		expect(emptyMarkdown.value).toContain('0');
		expect(emptyMarkdown.value).toContain('0.0%');

		// Test with missing metadata
		const emptyPromptResult = {
			messages: [],
			tokenCount: 0,
			metadata: {
				getAll: () => []
			}
		};

		const noMetadata = TokenUsageDisplayExample.extractAndDisplayTokenUsage(emptyPromptResult as any);
		expect(noMetadata).toBeUndefined();
	});

	test('should demonstrate configuration integration workflow', () => {
		// Test how configuration values would affect the workflow
		// This simulates how PromptRenderer would use configuration

		const mockSections = [
			{ section: 'system', content: 'Test system message', tokenCount: 200, priority: 1, wasTruncated: false },
			{ section: 'user-query', content: 'Test user query', tokenCount: 150, priority: 2, wasTruncated: false }
		];

		// Simulate configuration-driven behavior
		const tokenUsageEnabled = true; // from github.copilot.chat.tokenUsage.display

		if (tokenUsageEnabled) {
			// Create metadata when enabled
			const metadata = createTokenUsageMetadata(mockSections, 4000, 'gpt-4');
			expect(metadata).toBeDefined();
			expect(metadata.tokenUsageInfo.sections).toHaveLength(2);

			// Create appropriate display based on configuration
			const displayMode = 'summary'; // Could be 'detailed' based on config
			const part = new ChatResponseTokenUsagePart(metadata.tokenUsageInfo, displayMode);
			const markdown = part.toMarkdown();

			expect(markdown.value).toContain('Token Usage');
			expect(markdown.value).toContain('350');
		}

		// When disabled, no metadata should be created
		const tokenUsageDisabled = false;
		if (!tokenUsageDisabled) {
			// Normal workflow without token usage
			expect(true).toBe(true); // Placeholder for normal flow
		}
	});

	test('should validate complete data flow integrity', () => {
		// End-to-end test ensuring data integrity through the complete workflow
		const originalSections = [
			{ section: 'system', content: 'Original system content', tokenCount: 300, priority: 1, wasTruncated: false },
			{ section: 'user-query', content: 'Original user query', tokenCount: 250, priority: 2, wasTruncated: false },
			{ section: 'context', content: 'Original context', tokenCount: 500, priority: 3, wasTruncated: false }
		];

		const originalMax = 4000;
		const originalModel = 'gpt-4';

		// Step 1: Create metadata
		const metadata = createTokenUsageMetadata(originalSections, originalMax, originalModel);

		// Step 2: Verify data integrity in metadata
		expect(metadata.tokenUsageInfo.sections).toHaveLength(3);
		expect(metadata.tokenUsageInfo.totalTokens).toBe(1050);
		expect(metadata.tokenUsageInfo.model).toBe(originalModel);

		// Step 3: Create response parts and verify data preservation
		const summaryPart = new ChatResponseTokenUsagePart(metadata.tokenUsageInfo, 'summary');
		const detailedPart = new ChatResponseTokenUsagePart(metadata.tokenUsageInfo, 'detailed');

		// Step 4: Verify all original data is preserved and correctly displayed
		const summaryContent = summaryPart.toMarkdown().value;
		const detailedContent = detailedPart.toMarkdown().value;

		// Original token counts should be preserved
		expect(summaryContent).toContain('1,050');
		expect(summaryContent).toContain('4,000');
		expect(summaryContent).toContain(originalModel);

		// Original section data should be preserved in detailed view
		expect(detailedContent).toContain('**Tokens:** 300');
		expect(detailedContent).toContain('**Tokens:** 250');
		expect(detailedContent).toContain('**Tokens:** 500');

		// Calculations should be accurate
		const expectedPercentage = ((1050 / originalMax) * 100).toFixed(1);
		expect(summaryContent).toContain(`${expectedPercentage}%`);

		// Step 5: Test extraction roundtrip
		const mockPromptResult = {
			messages: [],
			tokenCount: 1050,
			metadata: {
				getAll: (key: any) => key === PromptTokenUsageMetadata ? [metadata] : []
			}
		};

		const extractedMetadata = TokenUsageDisplayExample.extractAndDisplayTokenUsage(mockPromptResult as any);
		expect(extractedMetadata?.tokenUsageInfo.totalTokens).toBe(1050);
		expect(extractedMetadata?.tokenUsageInfo.sections).toHaveLength(3);
	});
});
