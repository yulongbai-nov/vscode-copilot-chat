/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, expect, suite, test } from 'vitest';
import { IPromptSectionTokenUsage, IPromptTokenUsageInfo, PromptTokenUsageMetadata, createTokenUsageMetadata } from '../tokenUsageMetadata';

suite('TokenUsageMetadata', () => {

	suite('IPromptSectionTokenUsage', () => {
		test('should contain required properties', () => {
			const sectionUsage: IPromptSectionTokenUsage = {
				section: 'User Query',
				content: 'How do I implement a function in TypeScript?',
				tokenCount: 150,
				priority: 1
			};

			expect(sectionUsage.section).toBe('User Query');
			expect(sectionUsage.content).toBe('How do I implement a function in TypeScript?');
			expect(sectionUsage.tokenCount).toBe(150);
			expect(sectionUsage.priority).toBe(1);
		});

		test('should handle optional properties', () => {
			const sectionUsage: IPromptSectionTokenUsage = {
				section: 'System Instructions',
				content: 'You are a helpful AI assistant.',
				tokenCount: 50,
				wasTruncated: true
			};

			expect(sectionUsage.wasTruncated).toBe(true);
			expect(sectionUsage.priority).toBeUndefined();
		});
	});

	suite('IPromptTokenUsageInfo', () => {
		test('should contain all required usage information', () => {
			const timestamp = Date.now();
			const sections: IPromptSectionTokenUsage[] = [
				{ section: 'System Instructions', content: 'System prompt', tokenCount: 500, priority: 1 },
				{ section: 'User Query', content: 'User question', tokenCount: 300, priority: 2 },
				{ section: 'Context', content: 'Additional context', tokenCount: 200, priority: 3 }
			];

			const usageInfo: IPromptTokenUsageInfo = {
				totalTokens: 1000,
				maxTokens: 4000,
				usagePercentage: 25.0,
				model: 'gpt-4',
				sections,
				isNearLimit: false,
				timestamp
			};

			expect(usageInfo.totalTokens).toBe(1000);
			expect(usageInfo.maxTokens).toBe(4000);
			expect(usageInfo.usagePercentage).toBe(25.0);
			expect(usageInfo.model).toBe('gpt-4');
			expect(usageInfo.sections).toHaveLength(3);
			expect(usageInfo.isNearLimit).toBe(false);
			expect(usageInfo.timestamp).toBe(timestamp);
		});

		test('should handle edge case with zero tokens', () => {
			const usageInfo: IPromptTokenUsageInfo = {
				totalTokens: 0,
				maxTokens: 4000,
				usagePercentage: 0.0,
				model: 'gpt-4',
				sections: [],
				isNearLimit: false,
				timestamp: Date.now()
			};

			expect(usageInfo.totalTokens).toBe(0);
			expect(usageInfo.usagePercentage).toBe(0.0);
			expect(usageInfo.sections).toHaveLength(0);
			expect(usageInfo.isNearLimit).toBe(false);
		});

		test('should handle edge case with near-limit usage', () => {
			const usageInfo: IPromptTokenUsageInfo = {
				totalTokens: 3800,
				maxTokens: 4000,
				usagePercentage: 95.0,
				model: 'gpt-4',
				sections: [
					{ section: 'System Instructions', content: 'Large system prompt', tokenCount: 3800, priority: 1 }
				],
				isNearLimit: true,
				timestamp: Date.now()
			};

			expect(usageInfo.totalTokens).toBe(3800);
			expect(usageInfo.maxTokens).toBe(4000);
			expect(usageInfo.usagePercentage).toBe(95.0);
			expect(usageInfo.isNearLimit).toBe(true);
		});
	});

	suite('PromptTokenUsageMetadata', () => {
		let mockUsageInfo: IPromptTokenUsageInfo;

		beforeEach(() => {
			mockUsageInfo = {
				totalTokens: 1000,
				maxTokens: 4000,
				usagePercentage: 25.0,
				model: 'gpt-4',
				sections: [
					{ section: 'system', content: 'System instructions content', tokenCount: 500, priority: 1 },
					{ section: 'user-query', content: 'User question content', tokenCount: 300, priority: 2 },
					{ section: 'context', content: 'Context information', tokenCount: 200, priority: 3 }
				],
				isNearLimit: false,
				timestamp: Date.now()
			};
		});

		test('should create metadata with usage info', () => {
			const metadata = new PromptTokenUsageMetadata(mockUsageInfo);

			expect(metadata.tokenUsageInfo).toBe(mockUsageInfo);
			expect(metadata.tokenUsageInfo.totalTokens).toBe(1000);
			expect(metadata.tokenUsageInfo.model).toBe('gpt-4');
		});

		test('should generate formatted summary string', () => {
			const metadata = new PromptTokenUsageMetadata(mockUsageInfo);
			const summary = metadata.formatSummary();

			expect(summary).toContain('Token Usage');
			expect(summary).toContain('1,000/4,000');
			expect(summary).toContain('25.0%');
			expect(summary).toContain('system');
			expect(summary).toContain('user');
			expect(summary).toContain('context');
		});

		test('should handle high usage warning in summary', () => {
			const highUsageInfo = {
				...mockUsageInfo,
				totalTokens: 3600,
				usagePercentage: 90.0,
				isNearLimit: true
			};
			const metadata = new PromptTokenUsageMetadata(highUsageInfo);
			const summary = metadata.formatSummary();

			expect(summary).toContain('3,600/4,000');
			expect(summary).toContain('90.0%');
			expect(summary).toContain('Warning');
			expect(summary).toContain('token limit');
		});

		test('should generate detailed breakdown string', () => {
			const metadata = new PromptTokenUsageMetadata(mockUsageInfo);
			const breakdown = metadata.formatDetailedBreakdown();

			// Should contain header and model info
			expect(breakdown).toContain('Detailed Token Usage Report');
			expect(breakdown).toContain('Model');
			expect(breakdown).toContain('gpt-4');

			// Should contain usage statistics
			expect(breakdown).toContain('1000/4000');
			expect(breakdown).toContain('25.00%');

			// Should contain progress bar
			expect(breakdown).toContain('█');
			expect(breakdown).toContain('░');

			// Should contain section breakdown
			expect(breakdown).toContain('Section Breakdown');
			expect(breakdown).toContain('system');
			expect(breakdown).toContain('500');
		});

		test('should show truncation warnings in breakdown', () => {
			const truncatedUsageInfo = {
				...mockUsageInfo,
				sections: [
					{
						section: 'context',
						content: 'Very long context that was truncated...',
						tokenCount: 800,
						priority: 1,
						wasTruncated: true
					},
					{ section: 'user-query', content: 'Short query', tokenCount: 200, priority: 2 }
				]
			};
			const metadata = new PromptTokenUsageMetadata(truncatedUsageInfo);
			const breakdown = metadata.formatDetailedBreakdown();

			expect(breakdown).toContain('Truncated due to token limits');
			expect(breakdown).toContain('⚠️');
		});

		test('should handle empty sections array', () => {
			const emptyUsageInfo = { ...mockUsageInfo, sections: [] };
			const metadata = new PromptTokenUsageMetadata(emptyUsageInfo);

			const summary = metadata.formatSummary();
			const breakdown = metadata.formatDetailedBreakdown();

			expect(summary.length).toBeGreaterThan(0);
			expect(breakdown.length).toBeGreaterThan(0);
			expect(breakdown).toContain('Section Breakdown');
		});
	});

	suite('createTokenUsageMetadata', () => {
		test('should create metadata from sections', () => {
			const sections: IPromptSectionTokenUsage[] = [
				{ section: 'system', content: 'System prompt', tokenCount: 100, priority: 1 },
				{ section: 'user', content: 'User query', tokenCount: 50, priority: 2 }
			];

			const metadata = createTokenUsageMetadata(sections, 1000, 'gpt-3.5-turbo');

			expect(metadata.tokenUsageInfo.totalTokens).toBe(150);
			expect(metadata.tokenUsageInfo.maxTokens).toBe(1000);
			expect(metadata.tokenUsageInfo.usagePercentage).toBe(15.0);
			expect(metadata.tokenUsageInfo.model).toBe('gpt-3.5-turbo');
			expect(metadata.tokenUsageInfo.isNearLimit).toBe(false);
			expect(metadata.tokenUsageInfo.sections).toHaveLength(2);
		});

		test('should detect near limit usage', () => {
			const sections: IPromptSectionTokenUsage[] = [
				{ section: 'large-context', content: 'Very large context...', tokenCount: 900, priority: 1 }
			];

			const metadata = createTokenUsageMetadata(sections, 1000, 'gpt-4');

			expect(metadata.tokenUsageInfo.totalTokens).toBe(900);
			expect(metadata.tokenUsageInfo.usagePercentage).toBe(90.0);
			expect(metadata.tokenUsageInfo.isNearLimit).toBe(true);
		});

		test('should handle empty sections', () => {
			const metadata = createTokenUsageMetadata([], 1000, 'gpt-4');

			expect(metadata.tokenUsageInfo.totalTokens).toBe(0);
			expect(metadata.tokenUsageInfo.usagePercentage).toBe(0);
			expect(metadata.tokenUsageInfo.isNearLimit).toBe(false);
			expect(metadata.tokenUsageInfo.sections).toHaveLength(0);
		});

		test('should set current timestamp', () => {
			const beforeTimestamp = Date.now();
			const metadata = createTokenUsageMetadata([], 1000, 'gpt-4');
			const afterTimestamp = Date.now();

			expect(metadata.tokenUsageInfo.timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
			expect(metadata.tokenUsageInfo.timestamp).toBeLessThanOrEqual(afterTimestamp);
		});
	});
});
