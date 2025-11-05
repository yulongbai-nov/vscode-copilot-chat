/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITokenizerProvider, TokenizationEndpoint as PlatformTokenizationEndpoint } from '../../../platform/tokenizer/node/tokenizer';
import { Debouncer } from '../../../util/common/debounce';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { LRUCache } from '../../../util/vs/base/common/map';
import { ITokenUsageCalculator } from '../common/services';
import { PromptSection, TokenizationEndpoint } from '../common/types';

/**
 * Service implementation for calculating token usage using existing tokenizer
 * with debouncing and caching for performance optimization
 */
export class TokenUsageCalculator implements ITokenUsageCalculator {
	declare readonly _serviceBrand: undefined;

	private readonly _onLanguageModelChange = new Emitter<TokenizationEndpoint>();
	public readonly onLanguageModelChange: Event<TokenizationEndpoint> = this._onLanguageModelChange.event;

	// LRU cache for token calculations (limit: 100 entries)
	private readonly _tokenCache: LRUCache<string, number>;

	// Debouncer for batch token calculations
	private readonly _debouncer: Debouncer;

	// Debounce delay in milliseconds
	private static readonly DEBOUNCE_DELAY = 300;

	// Cache size limit
	private static readonly CACHE_LIMIT = 100;

	// Token usage warning thresholds
	private static readonly WARNING_THRESHOLD = 500; // Yellow warning
	private static readonly CRITICAL_THRESHOLD = 1000; // Red critical

	constructor(
		@ITokenizerProvider private readonly _tokenizerProvider: ITokenizerProvider
	) {
		this._tokenCache = new LRUCache<string, number>(TokenUsageCalculator.CACHE_LIMIT);
		this._debouncer = new Debouncer();

		// Clear cache when language model changes
		this._onLanguageModelChange.event(() => {
			this._tokenCache.clear();
		});
	}

	/**
	 * Generate cache key from section and endpoint
	 */
	private _getCacheKey(content: string, tagName: string, tokenizer: string): string {
		return `${tokenizer}:${tagName}:${content}`;
	}

	/**
	 * Calculate tokens for a single section with caching
	 */
	async calculateSectionTokens(section: PromptSection, endpoint: TokenizationEndpoint): Promise<number> {
		const breakdown = await this.calculateSectionTokensWithBreakdown(section, endpoint);
		return breakdown.total;
	}

	/**
	 * Calculate tokens for a single section with breakdown (content vs tags)
	 */
	async calculateSectionTokensWithBreakdown(
		section: PromptSection,
		endpoint: TokenizationEndpoint
	): Promise<{ total: number; content: number; tags: number }> {
		const cacheKey = this._getCacheKey(section.content, section.tagName, endpoint.tokenizer);

		// Check cache first (we cache the total, but recalculate breakdown)
		const cachedValue = this._tokenCache.get(cacheKey);
		if (cachedValue !== undefined) {
			// Estimate breakdown from cached total
			const tagEstimate = Math.ceil(section.tagName.length / 2);
			return {
				total: cachedValue,
				content: cachedValue - tagEstimate,
				tags: tagEstimate
			};
		}

		// Calculate if not cached
		try {
			const platformEndpoint: PlatformTokenizationEndpoint = { tokenizer: endpoint.tokenizer };
			const tokenizer = this._tokenizerProvider.acquireTokenizer(platformEndpoint);

			// Calculate tokens for the content
			const contentTokens = await tokenizer.tokenLength(section.content);

			// Add tokens for the XML tags (approximate)
			const tagTokens = await tokenizer.tokenLength(`<${section.tagName}></${section.tagName}>`);

			const totalTokens = contentTokens + tagTokens;

			// Cache the result
			this._tokenCache.set(cacheKey, totalTokens);

			return {
				total: totalTokens,
				content: contentTokens,
				tags: tagTokens
			};
		} catch (error) {
			// Fallback to character-based estimation if tokenizer fails
			const contentEstimate = Math.ceil(section.content.length / 4); // Rough approximation
			const tagEstimate = Math.ceil(section.tagName.length / 2);
			const totalTokens = contentEstimate + tagEstimate;
			// Don't cache fallback values
			return {
				total: totalTokens,
				content: contentEstimate,
				tags: tagEstimate
			};
		}
	}

	/**
	 * Calculate tokens for a single section with debouncing
	 * This method is useful for real-time updates as the user types
	 */
	async calculateSectionTokensDebounced(section: PromptSection, endpoint: TokenizationEndpoint): Promise<number> {
		try {
			// Wait for debounce period
			await this._debouncer.debounce(TokenUsageCalculator.DEBOUNCE_DELAY);

			// Calculate after debounce
			return await this.calculateSectionTokens(section, endpoint);
		} catch {
			// Debounce was cancelled by a newer call
			// Return cached value if available, otherwise estimate
			const cacheKey = this._getCacheKey(section.content, section.tagName, endpoint.tokenizer);
			const cachedValue = this._tokenCache.get(cacheKey);
			if (cachedValue !== undefined) {
				return cachedValue;
			}
			return Math.ceil(section.content.length / 4);
		}
	}

	/**
	 * Calculate total tokens for all sections
	 */
	async calculateTotalTokens(sections: PromptSection[], endpoint: TokenizationEndpoint): Promise<number> {
		let total = 0;

		for (const section of sections) {
			const sectionTokens = await this.calculateSectionTokens(section, endpoint);
			total += sectionTokens;
		}

		return total;
	}

	/**
	 * Calculate total tokens with breakdown for all sections
	 */
	async calculateTotalTokensWithBreakdown(
		sections: PromptSection[],
		endpoint: TokenizationEndpoint
	): Promise<{ total: number; content: number; tags: number; overhead: number }> {
		let totalContent = 0;
		let totalTags = 0;

		for (const section of sections) {
			const breakdown = await this.calculateSectionTokensWithBreakdown(section, endpoint);
			totalContent += breakdown.content;
			totalTags += breakdown.tags;
		}

		const total = totalContent + totalTags;
		const overhead = totalTags; // Tags are considered overhead

		return {
			total,
			content: totalContent,
			tags: totalTags,
			overhead
		};
	}

	/**
	 * Calculate total tokens for all sections with debouncing
	 * This method is useful for real-time updates as the user types
	 */
	async calculateTotalTokensDebounced(sections: PromptSection[], endpoint: TokenizationEndpoint): Promise<number> {
		try {
			// Wait for debounce period
			await this._debouncer.debounce(TokenUsageCalculator.DEBOUNCE_DELAY);

			// Calculate after debounce
			return await this.calculateTotalTokens(sections, endpoint);
		} catch {
			// Debounce was cancelled by a newer call
			// Return sum of cached values if available
			let total = 0;
			for (const section of sections) {
				const cacheKey = this._getCacheKey(section.content, section.tagName, endpoint.tokenizer);
				const cachedValue = this._tokenCache.get(cacheKey);
				if (cachedValue !== undefined) {
					total += cachedValue;
				} else {
					total += Math.ceil(section.content.length / 4);
				}
			}
			return total;
		}
	}

	/**
	 * Notify about language model change
	 * This will clear the cache since token counts may differ
	 */
	public notifyLanguageModelChange(endpoint: TokenizationEndpoint): void {
		this._onLanguageModelChange.fire(endpoint);
	}

	/**
	 * Clear the token cache manually
	 */
	public clearCache(): void {
		this._tokenCache.clear();
	}

	/**
	 * Get cache statistics for debugging/monitoring
	 */
	public getCacheStats(): { size: number; limit: number } {
		return {
			size: this._tokenCache.size,
			limit: TokenUsageCalculator.CACHE_LIMIT
		};
	}

	/**
	 * Get warning level for a token count
	 * @returns 'normal' | 'warning' | 'critical'
	 */
	public getWarningLevel(tokenCount: number): 'normal' | 'warning' | 'critical' {
		if (tokenCount >= TokenUsageCalculator.CRITICAL_THRESHOLD) {
			return 'critical';
		} else if (tokenCount >= TokenUsageCalculator.WARNING_THRESHOLD) {
			return 'warning';
		}
		return 'normal';
	}

	/**
	 * Get warning thresholds for UI display
	 */
	public getWarningThresholds(): { warning: number; critical: number } {
		return {
			warning: TokenUsageCalculator.WARNING_THRESHOLD,
			critical: TokenUsageCalculator.CRITICAL_THRESHOLD
		};
	}

	dispose(): void {
		this._onLanguageModelChange.dispose();
		this._tokenCache.clear();
	}
}
