/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, expect, suite, test } from 'vitest';
import { IPromptSectionTokenUsage, IPromptTokenUsageInfo } from '../../../prompts/common/tokenUsageMetadata';
import { ChatResponseTokenUsagePart } from '../chatResponseTokenUsagePart';

suite('ChatResponseTokenUsagePart', () => {
	let mockTokenUsageInfo: IPromptTokenUsageInfo;
	let mockSections: IPromptSectionTokenUsage[];

	beforeEach(() => {
		mockSections = [
			{
				section: 'system',
				content: 'You are a helpful AI assistant specialized in coding.',
				tokenCount: 400,
				priority: 1
			},
			{
				section: 'user-query',
				content: 'How do I implement a binary search in Python?',
				tokenCount: 300,
				priority: 2
			},
			{
				section: 'context',
				content: 'Previous conversation about algorithms and data structures...',
				tokenCount: 200,
				priority: 3
			}
		];

		mockTokenUsageInfo = {
			totalTokens: 900,
			maxTokens: 4000,
			usagePercentage: 22.5,
			model: 'gpt-4',
			sections: mockSections,
			isNearLimit: false,
			timestamp: Date.now()
		};
	});

	suite('Constructor', () => {
		test('should create part with summary mode by default', () => {
			const part = new ChatResponseTokenUsagePart(mockTokenUsageInfo);

			expect(part.tokenUsageInfo).toBe(mockTokenUsageInfo);
			expect(part.mode).toBe('summary');
			expect(part.kind).toBe('tokenUsage');
		});

		test('should create part with specified display mode', () => {
			const part = new ChatResponseTokenUsagePart(mockTokenUsageInfo, 'detailed');

			expect(part.tokenUsageInfo).toBe(mockTokenUsageInfo);
			expect(part.mode).toBe('detailed');
		});
	});

	suite('toMarkdown', () => {
		test('should generate summary markdown format', () => {
			const part = new ChatResponseTokenUsagePart(mockTokenUsageInfo, 'summary');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			// Should contain basic usage info
			expect(markdownString).toContain('Token Usage');
			expect(markdownString).toContain('900');
			expect(markdownString).toContain('4,000');
			expect(markdownString).toContain('22.5%');
			expect(markdownString).toContain('gpt-4');

			// Should contain top token consumers
			expect(markdownString).toContain('Top Token Consumers');
			expect(markdownString).toContain('system');
			expect(markdownString).toContain('user-query');
			expect(markdownString).toContain('context');
			expect(markdownString).toContain('400');
			expect(markdownString).toContain('300');
			expect(markdownString).toContain('200');
		});

		test('should generate detailed markdown format', () => {
			const part = new ChatResponseTokenUsagePart(mockTokenUsageInfo, 'detailed');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			// Should contain detailed report elements
			expect(markdownString).toContain('Detailed Token Usage Report');
			expect(markdownString).toContain('Model');
			expect(markdownString).toContain('Generated');
			expect(markdownString).toContain('Section Breakdown');

			// Should contain progress bar
			expect(markdownString).toContain('█');
			expect(markdownString).toContain('░');

			// Should contain content previews
			expect(markdownString).toContain('Preview');
		});

		test('should show warning for high token usage in summary', () => {
			const highUsageInfo = {
				...mockTokenUsageInfo,
				totalTokens: 3600,
				usagePercentage: 90.0,
				isNearLimit: true
			};
			const part = new ChatResponseTokenUsagePart(highUsageInfo, 'summary');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			expect(markdownString).toContain('⚠️');
			expect(markdownString).toContain('3,600');
			expect(markdownString).toContain('90.0%');
			expect(markdownString).toContain('Tip');
		});

		test('should show optimization suggestions in detailed mode for high usage', () => {
			const highUsageInfo = {
				...mockTokenUsageInfo,
				totalTokens: 3600,
				usagePercentage: 90.0,
				isNearLimit: true
			};
			const part = new ChatResponseTokenUsagePart(highUsageInfo, 'detailed');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			expect(markdownString).toContain('Optimization Suggestions');
			expect(markdownString).toContain('Reduce context size');
			expect(markdownString).toContain('targeted queries');
		});

		test('should handle truncated sections in summary mode', () => {
			const truncatedSections = [
				{
					...mockSections[0],
					wasTruncated: true
				},
				...mockSections.slice(1)
			];
			const truncatedUsageInfo = { ...mockTokenUsageInfo, sections: truncatedSections };
			const part = new ChatResponseTokenUsagePart(truncatedUsageInfo, 'summary');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			expect(markdownString).toContain('⚠️');
		});

		test('should handle truncated sections in detailed mode', () => {
			const truncatedSections = [
				{
					...mockSections[0],
					wasTruncated: true
				},
				...mockSections.slice(1)
			];
			const truncatedUsageInfo = { ...mockTokenUsageInfo, sections: truncatedSections };
			const part = new ChatResponseTokenUsagePart(truncatedUsageInfo, 'detailed');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			expect(markdownString).toContain('Truncated');
		});

		test('should handle empty sections array', () => {
			const emptyUsageInfo = { ...mockTokenUsageInfo, sections: [] };
			const part = new ChatResponseTokenUsagePart(emptyUsageInfo, 'summary');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			expect(markdownString).toContain('Token Usage');
			expect(markdownString).toContain('900'); // Should still show total tokens
		});

		test('should organize sections by type in detailed mode', () => {
			const organizedSections = [
				{ section: 'system-instructions', content: 'System content', tokenCount: 100, priority: 1 },
				{ section: 'context-document', content: 'Document content', tokenCount: 200, priority: 2 },
				{ section: 'user-query', content: 'User content', tokenCount: 150, priority: 3 },
				{ section: 'tool-result', content: 'Tool content', tokenCount: 50, priority: 4 }
			];
			const organizedUsageInfo = { ...mockTokenUsageInfo, sections: organizedSections, totalTokens: 500 };
			const part = new ChatResponseTokenUsagePart(organizedUsageInfo, 'detailed');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			expect(markdownString).toContain('System Instructions');
			expect(markdownString).toContain('Context & Documents');
			expect(markdownString).toContain('User Input');
			expect(markdownString).toContain('Tools & Functions');
			expect(markdownString).toContain('🔧');
			expect(markdownString).toContain('📄');
			expect(markdownString).toContain('💬');
			expect(markdownString).toContain('🛠️');
		});
	});

	suite('toCompactString', () => {
		test('should generate compact display string', () => {
			const part = new ChatResponseTokenUsagePart(mockTokenUsageInfo);
			const compact = part.toCompactString();

			expect(compact).toContain('900/4,000');
			expect(compact).toContain('22.5%');
			expect(compact).toContain('tokens');
			expect(compact.length).toBeLessThan(100); // Should be compact
		});

		test('should include warning indicator for high usage', () => {
			// Test normal usage
			const normalPart = new ChatResponseTokenUsagePart(mockTokenUsageInfo);
			const normalCompact = normalPart.toCompactString();
			expect(normalCompact).not.toContain('⚠️');

			// Test high usage
			const highUsageInfo = { ...mockTokenUsageInfo, usagePercentage: 95.0, isNearLimit: true };
			const highUsagePart = new ChatResponseTokenUsagePart(highUsageInfo);
			const highCompact = highUsagePart.toCompactString();
			expect(highCompact).toContain('⚠️');
		});

		test('should handle zero tokens', () => {
			const zeroUsageInfo = {
				...mockTokenUsageInfo,
				totalTokens: 0,
				usagePercentage: 0,
				sections: []
			};
			const part = new ChatResponseTokenUsagePart(zeroUsageInfo);
			const compact = part.toCompactString();

			expect(compact).toContain('0/4,000');
			expect(compact).toContain('0.0%');
		});

		test('should format large numbers with commas', () => {
			const largeNumberUsage = {
				...mockTokenUsageInfo,
				totalTokens: 1234567,
				maxTokens: 9876543,
				usagePercentage: 12.5
			};
			const part = new ChatResponseTokenUsagePart(largeNumberUsage);
			const compact = part.toCompactString();

			expect(compact).toContain('1,234,567');
			expect(compact).toContain('9,876,543');
		});
	});

	suite('Progress Bar Generation', () => {
		test('should create appropriate progress bar for low usage', () => {
			const lowUsageInfo = { ...mockTokenUsageInfo, usagePercentage: 10.0 };
			const part = new ChatResponseTokenUsagePart(lowUsageInfo, 'summary');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			// Should have more empty bars than filled bars
			const filledBars = (markdownString.match(/█/g) || []).length;
			const emptyBars = (markdownString.match(/░/g) || []).length;
			expect(filledBars).toBeLessThan(emptyBars);
		});

		test('should create appropriate progress bar for high usage', () => {
			const highUsageInfo = { ...mockTokenUsageInfo, usagePercentage: 90.0 };
			const part = new ChatResponseTokenUsagePart(highUsageInfo, 'summary');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			// Should have more filled bars than empty bars
			const filledBars = (markdownString.match(/█/g) || []).length;
			const emptyBars = (markdownString.match(/░/g) || []).length;
			expect(filledBars).toBeGreaterThan(emptyBars);
		});
	});

	suite('Edge Cases', () => {
		test('should handle maximum token usage', () => {
			const maxUsageInfo = {
				...mockTokenUsageInfo,
				totalTokens: 4000,
				usagePercentage: 100.0,
				isNearLimit: true
			};
			const part = new ChatResponseTokenUsagePart(maxUsageInfo);

			const markdown = part.toMarkdown();
			const compact = part.toCompactString();

			expect(markdown.value).toContain('**4,000** / **4,000**');
			expect(compact).toContain('100.0%');
			expect(compact).toContain('⚠️');
		});

		test('should handle very long section content in detailed mode', () => {
			const longContentSections = [
				{
					section: 'context',
					content: 'A'.repeat(1000), // Very long content
					tokenCount: 800,
					priority: 1
				}
			];
			const longContentUsage = {
				...mockTokenUsageInfo,
				sections: longContentSections,
				totalTokens: 800
			};

			const part = new ChatResponseTokenUsagePart(longContentUsage, 'detailed');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			// Content should be truncated in preview
			expect(markdownString).toContain('Preview');
			expect(markdownString).toContain('...');
		});

		test('should handle sections with special characters in content', () => {
			const specialSections = [
				{
					section: 'special-chars',
					content: 'Content with "quotes" and \n newlines \t tabs',
					tokenCount: 100,
					priority: 1
				}
			];
			const specialUsageInfo = { ...mockTokenUsageInfo, sections: specialSections };
			const part = new ChatResponseTokenUsagePart(specialUsageInfo, 'detailed');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			expect(markdownString).toContain('special-chars');
			expect(markdownString).toContain('\\n'); // Should escape newlines
		});

		test('should handle sections without content', () => {
			const noContentSections = [
				{
					section: 'no-content',
					content: '',
					tokenCount: 100,
					priority: 1
				}
			];
			const noContentUsage = { ...mockTokenUsageInfo, sections: noContentSections };
			const part = new ChatResponseTokenUsagePart(noContentUsage, 'detailed');
			const markdown = part.toMarkdown();
			const markdownString = markdown.value;

			expect(markdownString).toContain('no-content');
			// Should not contain preview section for empty content
		});
	});
});
