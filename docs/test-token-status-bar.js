/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Quick test script to trigger token usage status bar visualization
 * 
 * To use this in the Extension Development Host:
 * 1. Open the Command Palette (Ctrl+Shift+P)
 * 2. Type "Developer: Execute Command in Extension Development Host"
 * 3. Or use the JavaScript Debug Terminal to execute these commands
 */

// Test Optimal (40%)
vscode.commands.executeCommand('github.copilot.chat.test.tokenUsage.optimal');

// Wait 3 seconds
await new Promise(resolve => setTimeout(resolve, 3000));

// Test Caution (65%)
vscode.commands.executeCommand('github.copilot.chat.test.tokenUsage.caution');

// Wait 3 seconds
await new Promise(resolve => setTimeout(resolve, 3000));

// Test Warning (85%)
vscode.commands.executeCommand('github.copilot.chat.test.tokenUsage.warning');

// Wait 3 seconds
await new Promise(resolve => setTimeout(resolve, 3000));

// Test Critical (97%)
vscode.commands.executeCommand('github.copilot.chat.test.tokenUsage.critical');

// Wait 3 seconds
await new Promise(resolve => setTimeout(resolve, 3000));

// Clear
vscode.commands.executeCommand('github.copilot.chat.test.tokenUsage.clear');
