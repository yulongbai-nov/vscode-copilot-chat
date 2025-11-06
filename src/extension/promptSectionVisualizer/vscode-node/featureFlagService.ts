/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Service for managing feature flags related to the Prompt Section Visualizer
 */
export class FeatureFlagService {
	private static readonly CONFIG_SECTION = 'github.copilot.chat.promptSectionVisualizer';

	/**
	 * Check if native rendering is enabled
	 */
	public isNativeRenderingEnabled(): boolean {
		const config = vscode.workspace.getConfiguration(FeatureFlagService.CONFIG_SECTION);
		return config.get<boolean>('useNativeRendering', false);
	}

	/**
	 * Get the current render mode
	 */
	public getRenderMode(): 'inline' | 'standalone' | 'auto' {
		const config = vscode.workspace.getConfiguration(FeatureFlagService.CONFIG_SECTION);
		return config.get<'inline' | 'standalone' | 'auto'>('renderMode', 'auto');
	}

	/**
	 * Check if the visualizer is enabled
	 */
	public isVisualizerEnabled(): boolean {
		const config = vscode.workspace.getConfiguration(FeatureFlagService.CONFIG_SECTION);
		return config.get<boolean>('enabled', false);
	}

	/**
	 * Determine the effective render mode based on configuration and context
	 */
	public getEffectiveRenderMode(context?: 'chat' | 'standalone'): 'inline' | 'standalone' {
		const mode = this.getRenderMode();

		if (mode === 'auto') {
			// Auto-detect based on context
			return context === 'chat' ? 'inline' : 'standalone';
		}

		return mode;
	}

	/**
	 * Listen for configuration changes
	 */
	public onConfigurationChanged(
		callback: (useNativeRendering: boolean, renderMode: 'inline' | 'standalone' | 'auto') => void
	): vscode.Disposable {
		return vscode.workspace.onDidChangeConfiguration((e) => {
			if (
				e.affectsConfiguration(`${FeatureFlagService.CONFIG_SECTION}.useNativeRendering`) ||
				e.affectsConfiguration(`${FeatureFlagService.CONFIG_SECTION}.renderMode`)
			) {
				callback(this.isNativeRenderingEnabled(), this.getRenderMode());
			}
		});
	}
}
