/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, expect, suite, test } from 'vitest';
import { TokenUsageDisplayExample } from '../tokenUsageDisplayExample';
import { IPromptSectionTokenUsage, IPromptTokenUsageInfo, PromptTokenUsageMetadata } from '../tokenUsageMetadata';

// Mock VS Code types
const mockProgress = {
	report: (part: any) => {
		// Store reported parts for testing
		if (!mockProgress.reportedParts) {
			mockProgress.reportedParts = [];
		}
		mockProgress.reportedParts.push(part);
	},
	reportedParts: [] as any[]
};

const mockChatResponseStream = {
	markdownContent: '',
	markdown: function (value: any) {
		// Handle both string and MarkdownString objects
		if (typeof value === 'string') {
			this.markdownContent += value;
		} else if (value && typeof value.value === 'string') {
			this.markdownContent += value.value;
		} else {
			this.markdownContent += String(value);
		}
	}
};

// Mock RenderPromptResult with metadata
interface MockRenderPromptResult {
	messages: any[];
	tokenCount: number;
	metadata: {
		getAll: (key: any) => any[];
	};
	hasIgnoredFiles?: boolean;
	references?: any[];
	omittedReferences?: any[];
}

suite('TokenUsageDisplayExample', () => {
	let mockTokenUsageInfo: IPromptTokenUsageInfo;
	let mockSections: IPromptSectionTokenUsage[];
	let mockPromptResult: MockRenderPromptResult;
	let mockMetadata: PromptTokenUsageMetadata;

	beforeEach(() => {
		// Reset mock progress
		mockProgress.reportedParts = [];
		mockChatResponseStream.markdownContent = '';

		mockSections = [
			{
				section: 'system',
				content: 'You are a helpful AI assistant.',
				tokenCount: 400,
				priority: 1
			},
			{
				section: 'user-query',
				content: 'How do I implement a binary search?',
				tokenCount: 300,
				priority: 2
			},
			{
				section: 'context',
				content: 'Previous discussion about algorithms...',
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

		mockMetadata = new PromptTokenUsageMetadata(mockTokenUsageInfo);

		// Mock RenderPromptResult with metadata
		mockPromptResult = {
			messages: [],
			tokenCount: 900,
			metadata: {
				getAll: (key: any) => {
					if (key === PromptTokenUsageMetadata) {
						return [mockMetadata];
					}
					return [];
				}
			},
			hasIgnoredFiles: false,
			references: [],
			omittedReferences: []
		};
	});

	suite('extractAndDisplayTokenUsage', () => {
		test('should extract token usage metadata from prompt result', () => {
			const result = TokenUsageDisplayExample.extractAndDisplayTokenUsage(mockPromptResult as any);

			expect(result).toBe(mockMetadata);
			expect(result?.tokenUsageInfo.totalTokens).toBe(900);
			expect(result?.tokenUsageInfo.model).toBe('gpt-4');
		});

		test('should return undefined when no metadata exists', () => {
			const emptyPromptResult = {
				...mockPromptResult,
				metadata: {
					getAll: () => []
				}
			};

			const result = TokenUsageDisplayExample.extractAndDisplayTokenUsage(emptyPromptResult as any);

			expect(result).toBeUndefined();
		});

		test('should display token usage in summary mode when stream is provided', () => {
			const result = TokenUsageDisplayExample.extractAndDisplayTokenUsage(
				mockPromptResult as any,
				mockChatResponseStream as any,
				'summary'
			);

			expect(result).toBe(mockMetadata);
			expect(mockChatResponseStream.markdownContent).toContain('Token Usage');
			expect(mockChatResponseStream.markdownContent).toContain('900');
			expect(mockChatResponseStream.markdownContent).toContain('22.5%');
		});

		test('should display token usage in detailed mode when stream is provided', () => {
			const result = TokenUsageDisplayExample.extractAndDisplayTokenUsage(
				mockPromptResult as any,
				mockChatResponseStream as any,
				'detailed'
			);

			expect(result).toBe(mockMetadata);
			expect(mockChatResponseStream.markdownContent).toContain('Detailed Token Usage Report');
			expect(mockChatResponseStream.markdownContent).toContain('Section Breakdown');
		});

		test('should handle multiple metadata entries and use the first one', () => {
			const secondMetadata = new PromptTokenUsageMetadata({
				...mockTokenUsageInfo,
				totalTokens: 1200
			});

			const multiPromptResult = {
				...mockPromptResult,
				metadata: {
					getAll: (key: any) => {
						if (key === PromptTokenUsageMetadata) {
							return [mockMetadata, secondMetadata];
						}
						return [];
					}
				}
			};

			const result = TokenUsageDisplayExample.extractAndDisplayTokenUsage(multiPromptResult as any);

			expect(result).toBe(mockMetadata);
			expect(result?.tokenUsageInfo.totalTokens).toBe(900); // Should use first metadata
		});
	});

	suite('showTokenUsageProgress', () => {
		test('should report progress part with compact summary', () => {
			TokenUsageDisplayExample.showTokenUsageProgress(mockMetadata, mockProgress as any);

			expect(mockProgress.reportedParts).toHaveLength(1);
			const reportedPart = mockProgress.reportedParts[0];
			expect(reportedPart.value).toContain('Token Usage');
			expect(reportedPart.value).toContain('900/4,000');
		});

		test('should handle undefined progress gracefully', () => {
			expect(() => {
				TokenUsageDisplayExample.showTokenUsageProgress(mockMetadata, undefined);
			}).not.toThrow();
		});

		test('should include warning indicator for high usage', () => {
			const highUsageMetadata = new PromptTokenUsageMetadata({
				...mockTokenUsageInfo,
				totalTokens: 3600,
				usagePercentage: 90.0,
				isNearLimit: true
			});

			TokenUsageDisplayExample.showTokenUsageProgress(highUsageMetadata, mockProgress as any);

			expect(mockProgress.reportedParts).toHaveLength(1);
			const reportedPart = mockProgress.reportedParts[0];
			expect(reportedPart.value).toContain('⚠️');
		});
	});

	suite('checkAndWarnTokenLimits', () => {
		test('should return false for normal usage below threshold', () => {
			const isNearLimit = TokenUsageDisplayExample.checkAndWarnTokenLimits(mockPromptResult as any);

			expect(isNearLimit).toBe(false);
			expect(mockChatResponseStream.markdownContent).toBe('');
		});

		test('should return true and show warning for high usage above threshold', () => {
			const highUsageMetadata = new PromptTokenUsageMetadata({
				...mockTokenUsageInfo,
				totalTokens: 3400,
				usagePercentage: 85.0
			});

			const highUsagePromptResult = {
				...mockPromptResult,
				metadata: {
					getAll: (key: any) => {
						if (key === PromptTokenUsageMetadata) {
							return [highUsageMetadata];
						}
						return [];
					}
				}
			};

			const isNearLimit = TokenUsageDisplayExample.checkAndWarnTokenLimits(
				highUsagePromptResult as any,
				mockChatResponseStream as any
			);

			expect(isNearLimit).toBe(true);
			expect(mockChatResponseStream.markdownContent).toContain('Token Usage Warning');
			expect(mockChatResponseStream.markdownContent).toContain('85.0%');
		});

		test('should use custom warning threshold', () => {
			const mediumUsageMetadata = new PromptTokenUsageMetadata({
				...mockTokenUsageInfo,
				totalTokens: 2000,
				usagePercentage: 50.0
			});

			const mediumUsagePromptResult = {
				...mockPromptResult,
				metadata: {
					getAll: (key: any) => {
						if (key === PromptTokenUsageMetadata) {
							return [mediumUsageMetadata];
						}
						return [];
					}
				}
			};

			// Use 40% threshold (0.4) - should trigger warning for 50% usage
			const isNearLimit = TokenUsageDisplayExample.checkAndWarnTokenLimits(
				mediumUsagePromptResult as any,
				mockChatResponseStream as any,
				0.4
			);

			expect(isNearLimit).toBe(true);
			expect(mockChatResponseStream.markdownContent).toContain('50.0%');
		});

		test('should return false when no metadata exists', () => {
			const emptyPromptResult = {
				...mockPromptResult,
				metadata: {
					getAll: () => []
				}
			};

			const isNearLimit = TokenUsageDisplayExample.checkAndWarnTokenLimits(emptyPromptResult as any);

			expect(isNearLimit).toBe(false);
		});
	});

	suite('createTokenUsageSummary', () => {
		test('should create formatted summary string', () => {
			const summary = TokenUsageDisplayExample.createTokenUsageSummary(mockMetadata);

			expect(summary).toContain('Token Usage');
			expect(summary).toContain('900/4000');
			expect(summary).toContain('22.5%');
			expect(summary).toContain('gpt-4');
			expect(summary).toContain('Top sections');
		});

		test('should include top 3 sections by token count', () => {
			const summary = TokenUsageDisplayExample.createTokenUsageSummary(mockMetadata);

			// Should include all three sections since we only have 3
			expect(summary).toContain('system: 400');
			expect(summary).toContain('user-query: 300');
			expect(summary).toContain('context: 200');
		});

		test('should limit to top 3 sections when more than 3 exist', () => {
			const manySections = [
				{ section: 'section1', content: 'content1', tokenCount: 500, priority: 1 },
				{ section: 'section2', content: 'content2', tokenCount: 400, priority: 2 },
				{ section: 'section3', content: 'content3', tokenCount: 300, priority: 3 },
				{ section: 'section4', content: 'content4', tokenCount: 200, priority: 4 },
				{ section: 'section5', content: 'content5', tokenCount: 100, priority: 5 }
			];

			const manyUsageInfo = {
				...mockTokenUsageInfo,
				sections: manySections,
				totalTokens: 1500
			};

			const manyMetadata = new PromptTokenUsageMetadata(manyUsageInfo);
			const summary = TokenUsageDisplayExample.createTokenUsageSummary(manyMetadata);

			// Should contain top 3 sections
			expect(summary).toContain('section1: 500');
			expect(summary).toContain('section2: 400');
			expect(summary).toContain('section3: 300');

			// Should not contain bottom 2 sections
			expect(summary).not.toContain('section4: 200');
			expect(summary).not.toContain('section5: 100');
		});

		test('should handle empty sections array', () => {
			const emptyMetadata = new PromptTokenUsageMetadata({
				...mockTokenUsageInfo,
				sections: [],
				totalTokens: 0
			});

			const summary = TokenUsageDisplayExample.createTokenUsageSummary(emptyMetadata);

			expect(summary).toContain('Token Usage');
			expect(summary).toContain('0/4000');
			expect(summary).toContain('Top sections');
		});

		test('should format numbers correctly in summary', () => {
			const largeNumberMetadata = new PromptTokenUsageMetadata({
				...mockTokenUsageInfo,
				totalTokens: 12345,
				maxTokens: 67890
			});

			const summary = TokenUsageDisplayExample.createTokenUsageSummary(largeNumberMetadata);

			expect(summary).toContain('12345/67890');
		});
	});

	suite('Edge Cases and Error Handling', () => {
		test('should handle metadata with zero total tokens', () => {
			const zeroTokenMetadata = new PromptTokenUsageMetadata({
				...mockTokenUsageInfo,
				totalTokens: 0,
				usagePercentage: 0,
				sections: []
			});

			expect(() => {
				TokenUsageDisplayExample.showTokenUsageProgress(zeroTokenMetadata, mockProgress as any);
				TokenUsageDisplayExample.createTokenUsageSummary(zeroTokenMetadata);
			}).not.toThrow();
		});

		test('should handle sections with zero token counts', () => {
			const zeroTokenSections = [
				{ section: 'empty-section', content: '', tokenCount: 0, priority: 1 },
				{ section: 'normal-section', content: 'content', tokenCount: 100, priority: 2 }
			];

			const mixedMetadata = new PromptTokenUsageMetadata({
				...mockTokenUsageInfo,
				sections: zeroTokenSections,
				totalTokens: 100
			});

			const summary = TokenUsageDisplayExample.createTokenUsageSummary(mixedMetadata);

			expect(summary).toContain('normal-section: 100');
			expect(summary).toContain('empty-section: 0');
		});

		test('should handle very high usage percentages', () => {
			const extremeUsageMetadata = new PromptTokenUsageMetadata({
				...mockTokenUsageInfo,
				totalTokens: 4000,
				usagePercentage: 100.0,
				isNearLimit: true
			});

			TokenUsageDisplayExample.showTokenUsageProgress(extremeUsageMetadata, mockProgress as any);
			const summary = TokenUsageDisplayExample.createTokenUsageSummary(extremeUsageMetadata);

			expect(mockProgress.reportedParts[0].value).toContain('100.0%');
			expect(summary).toContain('100.0%');
		});
	});
});
