/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../common/contributions';
import { IPromptTokenUsageInfo } from '../../prompts/common/tokenUsageMetadata';

/**
 * Status bar item that displays current token usage
 * Provides at-a-glance visibility of token consumption with actionable insights
 */
export class TokenUsageStatusBarItem extends Disposable {
	private readonly _statusBarItem: vscode.StatusBarItem;
	private _currentTokenUsage?: IPromptTokenUsageInfo;

	constructor() {
		super();

		// Create status bar item on the right side with high priority
		this._statusBarItem = this._register(
			vscode.window.createStatusBarItem(
				'copilot.tokenUsage',
				vscode.StatusBarAlignment.Right,
				100 // High priority to appear near other important items
			)
		);

		this._statusBarItem.command = 'github.copilot.chat.showDetailedTokenUsage';
		this._statusBarItem.name = 'Copilot Token Usage';
	}

	/**
	 * Update the status bar with current token usage information
	 */
	updateTokenUsage(tokenUsage: IPromptTokenUsageInfo): void {
		this._currentTokenUsage = tokenUsage;
		this._render();
	}

	/**
	 * Show the status bar item
	 */
	show(): void {
		this._statusBarItem.show();
	}

	/**
	 * Hide the status bar item
	 */
	hide(): void {
		this._statusBarItem.hide();
	}

	/**
	 * Clear current token usage and hide
	 */
	clear(): void {
		this._currentTokenUsage = undefined;
		this.hide();
	}

	/**
	 * Get the current token usage info
	 */
	get currentTokenUsage(): IPromptTokenUsageInfo | undefined {
		return this._currentTokenUsage;
	}

	private _render(): void {
		if (!this._currentTokenUsage) {
			this.hide();
			return;
		}

		const { totalTokens, maxTokens, usagePercentage } = this._currentTokenUsage;

		// Choose icon based on usage level
		let icon: string;
		let backgroundColor: vscode.ThemeColor | undefined;

		if (usagePercentage >= 95) {
			icon = '⛔';
			backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		} else if (usagePercentage >= 80) {
			icon = '⚠️';
			backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		} else if (usagePercentage >= 60) {
			icon = '🟡';
		} else {
			icon = '🟢';
		}

		// Format the display text
		const tokenText = `${totalTokens.toLocaleString()}/${maxTokens.toLocaleString()}`;
		const percentText = `${usagePercentage.toFixed(1)}%`;

		this._statusBarItem.text = `${icon} ${tokenText} (${percentText})`;
		this._statusBarItem.backgroundColor = backgroundColor;

		// Create rich tooltip with detailed breakdown
		this._statusBarItem.tooltip = this._createTooltip();

		this.show();
	}

	private _createTooltip(): vscode.MarkdownString {
		if (!this._currentTokenUsage) {
			return new vscode.MarkdownString('No token usage data available');
		}

		const { totalTokens, maxTokens, usagePercentage, sections, model } = this._currentTokenUsage;

		const tooltip = new vscode.MarkdownString();
		tooltip.isTrusted = true;
		tooltip.supportHtml = true;

		// Header
		tooltip.appendMarkdown(`### 🎯 Token Usage Monitor\n\n`);
		tooltip.appendMarkdown(`**Model:** ${model}\n\n`);
		tooltip.appendMarkdown(`**Usage:** ${totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens (${usagePercentage.toFixed(1)}%)\n\n`);

		// Visual bar
		const barLength = 20;
		const filledLength = Math.round(barLength * usagePercentage / 100);
		const emptyLength = barLength - filledLength;
		const usageBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
		tooltip.appendMarkdown(`\`${usageBar}\`\n\n`);

		// Status and recommendations
		if (usagePercentage >= 95) {
			tooltip.appendMarkdown(`⛔ **Critical:** Immediate action required\n\n`);
			tooltip.appendMarkdown(`Actions:\n`);
			tooltip.appendMarkdown(`- [Compact Context](command:github.copilot.chat.compactContext)\n`);
			tooltip.appendMarkdown(`- [Clear History](command:github.copilot.chat.clearHistory)\n`);
		} else if (usagePercentage >= 80) {
			tooltip.appendMarkdown(`⚠️ **Warning:** Approaching token limit\n\n`);
			tooltip.appendMarkdown(`Consider:\n`);
			tooltip.appendMarkdown(`- [Compact Context](command:github.copilot.chat.compactContext)\n`);
			tooltip.appendMarkdown(`- [Use Subagent](command:github.copilot.chat.delegateToSubagent)\n`);
		} else if (usagePercentage >= 60) {
			tooltip.appendMarkdown(`🟡 **Caution:** Moderate usage\n\n`);
		} else {
			tooltip.appendMarkdown(`🟢 **Optimal:** Good token efficiency\n\n`);
		}

		// Top consumers
		const topSections = [...sections]
			.sort((a, b) => b.tokenCount - a.tokenCount)
			.slice(0, 3);

		if (topSections.length > 0) {
			tooltip.appendMarkdown(`**Top Token Consumers:**\n`);
			for (const section of topSections) {
				const percentage = (section.tokenCount / totalTokens * 100).toFixed(0);
				const truncated = section.wasTruncated ? ' ⚠️' : '';
				tooltip.appendMarkdown(`- ${section.section}: ${section.tokenCount.toLocaleString()} (${percentage}%)${truncated}\n`);
			}
			tooltip.appendMarkdown(`\n`);
		}

		tooltip.appendMarkdown(`\n---\n\n`);
		tooltip.appendMarkdown(`💡 *Click for detailed breakdown*\n`);

		return tooltip;
	}
}

/**
 * Contribution that manages the token usage status bar item lifecycle
 */
export class TokenUsageStatusBarContribution extends Disposable implements IExtensionContribution {
	readonly id = 'tokenUsageStatusBar';
	private readonly _statusBarItem: TokenUsageStatusBarItem;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this._statusBarItem = this._register(new TokenUsageStatusBarItem());
		
		this.logService.debug('[TokenUsageStatusBar] Token usage status bar initialized');
		// Status bar will be shown/hidden based on token usage updates
	}

	/**
	 * Get the status bar item for external updates
	 */
	get statusBarItem(): TokenUsageStatusBarItem {
		return this._statusBarItem;
	}
}
