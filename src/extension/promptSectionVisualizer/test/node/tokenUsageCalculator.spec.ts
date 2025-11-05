/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ITokenizerProvider } from '../../../../platform/tokenizer/node/tokenizer';
import { PromptSection, TokenizationEndpoint } from '../../common/types';
import { TokenUsageCalculator } from '../../node/tokenUsageCalculator';

describe('TokenUsageCalculator', () => {
	let calculator: TokenUsageCalculator;
	let mockTokenizerProvider: ITokenizerProvider;
	let mockTokenizer: any;

	const createMockSection = (id: string, content: string, tagName: string = 'context'): PromptSection => ({
		id,
		tagName,
		content,
		startIndex: 0,
		endIndex: content.length,
		tokenCount: 0,
		isEditing: false,
		isCollapsed: false,
		hasRenderableElements: false
	});

	const mockEndpoint: TokenizationEndpoint = {
		tokenizer: 'cl100k_base'
	};

	beforeEach(() => {
		// Create mock tokenizer
		mockTokenizer = {
			tokenLength: vi.fn().mockResolvedValue(10)
		};

		// Create mock tokenizer provider
		mockTokenizerProvider = {
			acquireTokenizer: vi.fn().mockReturnValue(mockTokenizer)
		} as any;

		// Create calculator instance
		calculator = new TokenUsageCalculator(mockTokenizerProvider);
	});

	describe('calculateSectionTokens', () => {
		it('should calculate tokens for a section', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockResolvedValueOnce(5).mockResolvedValueOnce(3);

			const result = await calculator.calculateSectionTokens(section, mockEndpoint);

			expect(result).toBe(8); // 5 (content) + 3 (tags)
			expect(mockTokenizer.tokenLength).toHaveBeenCalledTimes(2);
		});

		it('should cache token calculations', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockResolvedValueOnce(5).mockResolvedValueOnce(3);

			// First call
			const result1 = await calculator.calculateSectionTokens(section, mockEndpoint);
			expect(result1).toBe(8);

			// Second call should use cache
			const result2 = await calculator.calculateSectionTokens(section, mockEndpoint);
			expect(result2).toBe(8);

			// Should only call tokenizer once (cached second time)
			expect(mockTokenizer.tokenLength).toHaveBeenCalledTimes(2);
		});

		it('should use different cache keys for different content', async () => {
			const section1 = createMockSection('1', 'Hello world', 'context');
			const section2 = createMockSection('2', 'Goodbye world', 'context');

			mockTokenizer.tokenLength.mockResolvedValue(5);

			await calculator.calculateSectionTokens(section1, mockEndpoint);
			await calculator.calculateSectionTokens(section2, mockEndpoint);

			// Should call tokenizer for both sections (4 calls: 2 content + 2 tags)
			expect(mockTokenizer.tokenLength).toHaveBeenCalledTimes(4);
		});

		it('should use different cache keys for different tag names', async () => {
			const section1 = createMockSection('1', 'Hello world', 'context');
			const section2 = createMockSection('2', 'Hello world', 'instructions');

			mockTokenizer.tokenLength.mockResolvedValue(5);

			await calculator.calculateSectionTokens(section1, mockEndpoint);
			await calculator.calculateSectionTokens(section2, mockEndpoint);

			// Should call tokenizer for both sections
			expect(mockTokenizer.tokenLength).toHaveBeenCalledTimes(4);
		});

		it('should fallback to character estimation on error', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockRejectedValue(new Error('Tokenizer error'));

			const result = await calculator.calculateSectionTokens(section, mockEndpoint);

			// Should use character-based estimation: Math.ceil(11 / 4) + Math.ceil(7 / 2) = 3 + 4 = 7
			expect(result).toBe(7);
		});

		it('should not cache fallback values', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockRejectedValueOnce(new Error('Tokenizer error'));

			// First call fails and uses fallback
			const result1 = await calculator.calculateSectionTokens(section, mockEndpoint);
			expect(result1).toBe(7); // Math.ceil(11 / 4) + Math.ceil(7 / 2) = 3 + 4 = 7

			// Second call should try tokenizer again
			mockTokenizer.tokenLength.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
			const result2 = await calculator.calculateSectionTokens(section, mockEndpoint);
			expect(result2).toBe(8);
		});
	});

	describe('calculateSectionTokensDebounced', () => {
		it('should debounce token calculations', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockResolvedValue(5);

			// Start multiple debounced calls
			const promise1 = calculator.calculateSectionTokensDebounced(section, mockEndpoint);
			const promise2 = calculator.calculateSectionTokensDebounced(section, mockEndpoint);
			const promise3 = calculator.calculateSectionTokensDebounced(section, mockEndpoint);

			// First two should return fallback (character estimation) when cancelled
			const result1 = await promise1;
			expect(result1).toBe(3); // Math.ceil(11 / 4) - character estimation fallback

			const result2 = await promise2;
			expect(result2).toBe(3); // Same fallback

			// Last should complete with actual calculation
			const result3 = await promise3;
			expect(result3).toBe(10); // 5 + 5
		});

		it('should return cached value when debounce is cancelled', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockResolvedValueOnce(5).mockResolvedValueOnce(3);

			// First, populate cache with non-debounced call
			await calculator.calculateSectionTokens(section, mockEndpoint);

			// Now start debounced calls
			const promise1 = calculator.calculateSectionTokensDebounced(section, mockEndpoint);
			const promise2 = calculator.calculateSectionTokensDebounced(section, mockEndpoint);

			// First should return cached value when cancelled
			const result1 = await promise1;
			expect(result1).toBe(8); // Cached value

			// Cancel second
			await promise2;
		});

		it('should use character estimation when no cache and debounce cancelled', async () => {
			const section = createMockSection('1', 'Hello world', 'context');

			// Start debounced calls without populating cache first
			const promise1 = calculator.calculateSectionTokensDebounced(section, mockEndpoint);
			const promise2 = calculator.calculateSectionTokensDebounced(section, mockEndpoint);

			// First should use character estimation when cancelled
			const result1 = await promise1;
			expect(result1).toBe(3); // Math.ceil(11 / 4)

			await promise2;
		});
	});

	describe('calculateTotalTokens', () => {
		it('should calculate total tokens for multiple sections', async () => {
			const sections = [
				createMockSection('1', 'Hello', 'context'),
				createMockSection('2', 'World', 'instructions'),
				createMockSection('3', 'Test', 'examples')
			];

			mockTokenizer.tokenLength.mockResolvedValue(5);

			const result = await calculator.calculateTotalTokens(sections, mockEndpoint);

			// Each section: 5 (content) + 5 (tags) = 10, total = 30
			expect(result).toBe(30);
		});

		it('should use cached values for sections', async () => {
			const sections = [
				createMockSection('1', 'Hello', 'context'),
				createMockSection('2', 'World', 'instructions')
			];

			mockTokenizer.tokenLength.mockResolvedValue(5);

			// First call
			await calculator.calculateTotalTokens(sections, mockEndpoint);

			// Reset mock to verify cache usage
			mockTokenizer.tokenLength.mockClear();

			// Second call should use cache
			const result = await calculator.calculateTotalTokens(sections, mockEndpoint);

			expect(result).toBe(20); // 2 sections * 10 tokens each
			expect(mockTokenizer.tokenLength).not.toHaveBeenCalled();
		});
	});

	describe('calculateTotalTokensDebounced', () => {
		it('should debounce total token calculations', async () => {
			const sections = [
				createMockSection('1', 'Hello', 'context'),
				createMockSection('2', 'World', 'instructions')
			];

			mockTokenizer.tokenLength.mockResolvedValue(5);

			// Start multiple debounced calls
			const promise1 = calculator.calculateTotalTokensDebounced(sections, mockEndpoint);
			const promise2 = calculator.calculateTotalTokensDebounced(sections, mockEndpoint);

			// First should return fallback (character estimation) when cancelled
			const result1 = await promise1;
			expect(result1).toBe(4); // Math.ceil(5/4) + Math.ceil(5/4) = 2 + 2

			// Second should complete with actual calculation
			const result2 = await promise2;
			expect(result2).toBe(20);
		});

		it('should return sum of cached values when debounce cancelled', async () => {
			const sections = [
				createMockSection('1', 'Hello', 'context'),
				createMockSection('2', 'World', 'instructions')
			];

			mockTokenizer.tokenLength.mockResolvedValue(5);

			// Populate cache
			await calculator.calculateTotalTokens(sections, mockEndpoint);

			// Start debounced calls
			const promise1 = calculator.calculateTotalTokensDebounced(sections, mockEndpoint);
			const promise2 = calculator.calculateTotalTokensDebounced(sections, mockEndpoint);

			// First should return cached sum
			const result1 = await promise1;
			expect(result1).toBe(20);

			await promise2;
		});
	});

	describe('cache management', () => {
		it('should clear cache manually', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockResolvedValue(5);

			// Populate cache
			await calculator.calculateSectionTokens(section, mockEndpoint);

			// Clear cache
			calculator.clearCache();

			// Reset mock
			mockTokenizer.tokenLength.mockClear();
			mockTokenizer.tokenLength.mockResolvedValue(5);

			// Should recalculate
			await calculator.calculateSectionTokens(section, mockEndpoint);
			expect(mockTokenizer.tokenLength).toHaveBeenCalled();
		});

		it('should clear cache on language model change', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockResolvedValue(5);

			// Populate cache
			await calculator.calculateSectionTokens(section, mockEndpoint);

			// Trigger language model change
			calculator.notifyLanguageModelChange(mockEndpoint);

			// Reset mock
			mockTokenizer.tokenLength.mockClear();
			mockTokenizer.tokenLength.mockResolvedValue(5);

			// Should recalculate
			await calculator.calculateSectionTokens(section, mockEndpoint);
			expect(mockTokenizer.tokenLength).toHaveBeenCalled();
		});

		it('should return cache statistics', () => {
			const stats = calculator.getCacheStats();

			expect(stats).toHaveProperty('size');
			expect(stats).toHaveProperty('limit');
			expect(stats.limit).toBe(100);
			expect(stats.size).toBe(0);
		});

		it('should update cache size after adding entries', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockResolvedValue(5);

			await calculator.calculateSectionTokens(section, mockEndpoint);

			const stats = calculator.getCacheStats();
			expect(stats.size).toBe(1);
		});
	});

	describe('LRU cache behavior', () => {
		it('should respect cache limit', async () => {
			mockTokenizer.tokenLength.mockResolvedValue(5);

			// Add more than cache limit (100) entries
			for (let i = 0; i < 105; i++) {
				const section = createMockSection(`${i}`, `Content ${i}`, 'context');
				await calculator.calculateSectionTokens(section, mockEndpoint);
			}

			const stats = calculator.getCacheStats();
			expect(stats.size).toBeLessThanOrEqual(100);
		});
	});

	describe('disposal', () => {
		it('should clear cache on disposal', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockResolvedValue(5);

			await calculator.calculateSectionTokens(section, mockEndpoint);

			let stats = calculator.getCacheStats();
			expect(stats.size).toBe(1);

			calculator.dispose();

			stats = calculator.getCacheStats();
			expect(stats.size).toBe(0);
		});
	});

	describe('calculateSectionTokensWithBreakdown', () => {
		it('should calculate tokens with breakdown for content and tags', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockResolvedValueOnce(10).mockResolvedValueOnce(4);

			const result = await calculator.calculateSectionTokensWithBreakdown(section, mockEndpoint);

			expect(result.total).toBe(14);
			expect(result.content).toBe(10);
			expect(result.tags).toBe(4);
		});

		it('should use cached values for breakdown calculation', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockResolvedValueOnce(10).mockResolvedValueOnce(4);

			// First call
			const result1 = await calculator.calculateSectionTokensWithBreakdown(section, mockEndpoint);
			expect(result1.total).toBe(14);

			// Second call should use cache
			mockTokenizer.tokenLength.mockClear();
			const result2 = await calculator.calculateSectionTokensWithBreakdown(section, mockEndpoint);

			expect(result2.total).toBe(14);
			expect(mockTokenizer.tokenLength).not.toHaveBeenCalled();
		});

		it('should fallback to character estimation on error', async () => {
			const section = createMockSection('1', 'Hello world', 'context');
			mockTokenizer.tokenLength.mockRejectedValue(new Error('Tokenizer error'));

			const result = await calculator.calculateSectionTokensWithBreakdown(section, mockEndpoint);

			// Should use character-based estimation: Math.ceil(11 / 4) + Math.ceil(7 / 2) = 3 + 4 = 7
			expect(result.total).toBe(7);
			expect(result.content).toBe(3); // Math.ceil(11 / 4)
			expect(result.tags).toBe(4); // Math.ceil(7 / 2)
		});
	});

	describe('calculateTotalTokensWithBreakdown', () => {
		it('should calculate total tokens with breakdown for all sections', async () => {
			const sections = [
				createMockSection('1', 'Hello', 'context'),
				createMockSection('2', 'World', 'instructions')
			];

			mockTokenizer.tokenLength.mockResolvedValue(5);

			const result = await calculator.calculateTotalTokensWithBreakdown(sections, mockEndpoint);

			expect(result.total).toBe(20); // 2 sections * (5 content + 5 tags)
			expect(result.content).toBe(10); // 2 sections * 5 content
			expect(result.tags).toBe(10); // 2 sections * 5 tags
			expect(result.overhead).toBe(10); // Same as tags
		});

		it('should aggregate breakdown correctly for multiple sections', async () => {
			const sections = [
				createMockSection('1', 'Short', 'ctx'),
				createMockSection('2', 'Medium content', 'instructions'),
				createMockSection('3', 'Very long content here', 'examples')
			];

			mockTokenizer.tokenLength
				.mockResolvedValueOnce(3).mockResolvedValueOnce(2) // Section 1
				.mockResolvedValueOnce(7).mockResolvedValueOnce(6) // Section 2
				.mockResolvedValueOnce(12).mockResolvedValueOnce(4); // Section 3

			const result = await calculator.calculateTotalTokensWithBreakdown(sections, mockEndpoint);

			expect(result.total).toBe(34); // 3+2 + 7+6 + 12+4
			expect(result.content).toBe(22); // 3 + 7 + 12
			expect(result.tags).toBe(12); // 2 + 6 + 4
			expect(result.overhead).toBe(12);
		});
	});

	describe('getWarningLevel', () => {
		it('should return normal for low token counts', () => {
			expect(calculator.getWarningLevel(0)).toBe('normal');
			expect(calculator.getWarningLevel(100)).toBe('normal');
			expect(calculator.getWarningLevel(499)).toBe('normal');
		});

		it('should return warning for medium token counts', () => {
			expect(calculator.getWarningLevel(500)).toBe('warning');
			expect(calculator.getWarningLevel(750)).toBe('warning');
			expect(calculator.getWarningLevel(999)).toBe('warning');
		});

		it('should return critical for high token counts', () => {
			expect(calculator.getWarningLevel(1000)).toBe('critical');
			expect(calculator.getWarningLevel(1500)).toBe('critical');
			expect(calculator.getWarningLevel(10000)).toBe('critical');
		});
	});

	describe('getWarningThresholds', () => {
		it('should return warning thresholds', () => {
			const thresholds = calculator.getWarningThresholds();

			expect(thresholds.warning).toBe(500);
			expect(thresholds.critical).toBe(1000);
		});
	});
});
