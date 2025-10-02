/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../common/contributions';
import { IPromptSectionTokenUsage, IPromptTokenUsageInfo } from '../../prompts/common/tokenUsageMetadata';
import { TokenUsageStatusBarContribution } from './tokenUsageStatusBar';

/**
 * Test commands for visualizing token usage status bar at different thresholds
 * These commands inject mock token usage data to test visual indicators
 */
export class TokenUsageTestCommandsContribution extends Disposable implements IExtensionContribution {
	readonly id = 'tokenUsageTestCommands';

	constructor(
		@ILogService private readonly logService: ILogService,
		private readonly statusBarContribution: TokenUsageStatusBarContribution,
	) {
		super();

		// Register test commands
		this._register(vscode.commands.registerCommand(
			'github.copilot.chat.test.tokenUsage.optimal',
			() => this.testOptimalUsage()
		));

		this._register(vscode.commands.registerCommand(
			'github.copilot.chat.test.tokenUsage.caution',
			() => this.testCautionUsage()
		));

		this._register(vscode.commands.registerCommand(
			'github.copilot.chat.test.tokenUsage.warning',
			() => this.testWarningUsage()
		));

		this._register(vscode.commands.registerCommand(
			'github.copilot.chat.test.tokenUsage.critical',
			() => this.testCriticalUsage()
		));

		this._register(vscode.commands.registerCommand(
			'github.copilot.chat.test.tokenUsage.clear',
			() => this.clearUsage()
		));

		this.logService.info('[TokenUsageTestCommands] Test commands registered');
	}

	private testOptimalUsage(): void {
		const mockUsage = this.createMockTokenUsage(40); // 40% usage
		this.statusBarContribution.statusBarItem.updateTokenUsage(mockUsage);
		vscode.window.showInformationMessage('✅ Token usage set to OPTIMAL (40%) - Check status bar');
	}

	private testCautionUsage(): void {
		const mockUsage = this.createMockTokenUsage(65); // 65% usage
		this.statusBarContribution.statusBarItem.updateTokenUsage(mockUsage);
		vscode.window.showInformationMessage('🟡 Token usage set to CAUTION (65%) - Check status bar');
	}

	private testWarningUsage(): void {
		const mockUsage = this.createMockTokenUsage(85); // 85% usage
		this.statusBarContribution.statusBarItem.updateTokenUsage(mockUsage);
		vscode.window.showInformationMessage('⚠️ Token usage set to WARNING (85%) - Check status bar');
	}

	private testCriticalUsage(): void {
		const mockUsage = this.createMockTokenUsage(97); // 97% usage
		this.statusBarContribution.statusBarItem.updateTokenUsage(mockUsage);
		vscode.window.showInformationMessage('⛔ Token usage set to CRITICAL (97%) - Check status bar');
	}

	private clearUsage(): void {
		this.statusBarContribution.statusBarItem.clear();
		vscode.window.showInformationMessage('Token usage status bar cleared');
	}

	private createMockTokenUsage(targetPercentage: number): IPromptTokenUsageInfo {
		const maxTokens = 128000; // Typical model context window
		const totalTokens = Math.round((maxTokens * targetPercentage) / 100);

		// Create mock sections that add up to totalTokens
		const sectionData: Array<{ section: string; content: string; tokenCount: number; priority?: number; wasTruncated?: boolean }> = [
			{
				section: 'system-instructions',
				content: 'You are a helpful AI assistant...',
				tokenCount: Math.round(totalTokens * 0.15),
				priority: 1000,
			},
			{
				section: 'user-query',
				content: 'How do I implement a feature?',
				tokenCount: Math.round(totalTokens * 0.10),
				priority: 800,
			},
			{
				section: 'workspace-context',
				content: 'Project files and structure...',
				tokenCount: Math.round(totalTokens * 0.35),
				priority: 600,
			},
			{
				section: 'conversation-history',
				content: 'Previous messages in the conversation...',
				tokenCount: Math.round(totalTokens * 0.25),
				priority: 400,
			},
			{
				section: 'code-context',
				content: 'Relevant code snippets...',
				tokenCount: Math.round(totalTokens * 0.15),
				priority: 500,
			},
		];

		// Adjust the last section to ensure exact total
		const currentTotal = sectionData.reduce((sum, s) => sum + s.tokenCount, 0);
		sectionData[sectionData.length - 1].tokenCount += (totalTokens - currentTotal);

		// Convert to readonly sections
		const sections: readonly IPromptSectionTokenUsage[] = sectionData as readonly IPromptSectionTokenUsage[];

		return {
			totalTokens,
			maxTokens,
			sections,
			usagePercentage: targetPercentage,
			isNearLimit: targetPercentage >= 85,
			model: 'gpt-4',
			timestamp: Date.now(),
		};
	}
}
