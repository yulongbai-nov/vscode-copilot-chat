/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ILogService } from '../../../platform/log/common/logService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../common/contributions';
import { ILiveRequestEditorService, SubagentRequestEntry } from '../common/liveRequestEditorService';
import { LiveRequestSection } from '../common/liveRequestEditorModel';

type SubagentTreeNode = SubagentRequestNode | SubagentSectionNode;

interface SubagentRequestNode {
	readonly type: 'request';
	readonly entry: SubagentRequestEntry;
}

interface SubagentSectionNode {
	readonly type: 'section';
	readonly entry: SubagentRequestEntry;
	readonly sectionIndex: number;
}

export class SubagentPromptMonitorContribution extends Disposable implements IExtensionContribution, vscode.TreeDataProvider<SubagentTreeNode> {
	readonly id = 'subagentPromptMonitor';

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<SubagentTreeNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private _treeView?: vscode.TreeView<SubagentTreeNode>;
	private _history: readonly SubagentRequestEntry[];

	constructor(
		@ILiveRequestEditorService private readonly _liveRequestEditorService: ILiveRequestEditorService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._history = this._liveRequestEditorService.getSubagentRequests();
		this._treeView = vscode.window.createTreeView('github.copilot.subagentPromptMonitor', {
			treeDataProvider: this,
			showCollapseAll: true
		});
		this._register(this._treeView);
		this._register(this._liveRequestEditorService.onDidUpdateSubagentHistory(() => this._refresh()));
		this._register(this._liveRequestEditorService.onDidRemoveRequest(() => this._refresh()));
		this._register(vscode.commands.registerCommand('github.copilot.subagentPromptMonitor.copySection', (node?: SubagentSectionNode) => this.copySection(node)));
		this._register(vscode.commands.registerCommand('github.copilot.subagentPromptMonitor.clear', () => this.clearHistory()));
		this._register(this._treeView.onDidExpandElement(event => {
			if (event.element.type === 'request') {
				this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.subagentMonitor.viewed', {
					sections: String(event.element.entry.sections.length)
				});
			}
		}));
	}

	getTreeItem(element: SubagentTreeNode): vscode.TreeItem {
		if (element.type === 'request') {
			const item = new vscode.TreeItem(this.buildRequestLabel(element.entry), vscode.TreeItemCollapsibleState.Collapsed);
			item.description = element.entry.model;
			item.tooltip = this.buildRequestTooltip(element.entry);
			item.iconPath = new vscode.ThemeIcon('git-pull-request');
			item.contextValue = 'github.copilot.subagentRequest';
			return item;
		}

		const section = element.entry.sections[element.sectionIndex];
		const item = new vscode.TreeItem(section.label, vscode.TreeItemCollapsibleState.None);
		item.description = this.buildSectionDescription(section);
		const tooltip = new vscode.MarkdownString(section.content || '', true);
		tooltip.isTrusted = true;
		item.tooltip = tooltip;
		item.iconPath = this.sectionIcon(section.kind);
		item.contextValue = 'github.copilot.subagentSection';
		item.command = {
			command: 'github.copilot.subagentPromptMonitor.copySection',
			title: 'Copy Section',
			arguments: [element]
		};
		return item;
	}

	getChildren(element?: SubagentTreeNode): SubagentTreeNode[] {
		if (!element) {
			return this._history.map(entry => ({ type: 'request', entry }));
		}
		if (element.type === 'request') {
			return element.entry.sections.map((_, index) => ({ type: 'section' as const, entry: element.entry, sectionIndex: index }));
		}
		return [];
	}

	private _refresh(): void {
		this._history = this._liveRequestEditorService.getSubagentRequests();
		this._onDidChangeTreeData.fire(undefined);
	}

	private async copySection(node?: SubagentSectionNode): Promise<void> {
		if (!node) {
			return;
		}
		const section = node.entry.sections[node.sectionIndex];
		try {
			await vscode.env.clipboard.writeText(section.content ?? '');
			this._telemetryService.sendMSFTTelemetryEvent('liveRequestEditor.subagentMonitor.copySection', {});
		} catch (error) {
			this._logService.error('Subagent Prompt Monitor: failed to copy section content', error);
		}
	}

	private clearHistory(): void {
		this._liveRequestEditorService.clearSubagentHistory();
	}

	private buildRequestLabel(entry: SubagentRequestEntry): string {
		const location = ChatLocation.toStringShorter(entry.location);
		return `${location} · ${entry.debugName}`;
	}

	private buildRequestTooltip(entry: SubagentRequestEntry): vscode.MarkdownString {
		const timestamp = new Date(entry.createdAt).toLocaleString();
		const tooltip = new vscode.MarkdownString(undefined, true);
		tooltip.appendMarkdown(`**${entry.debugName}**  \n`);
		tooltip.appendMarkdown(`Model: \`${entry.model}\`  \n`);
		tooltip.appendMarkdown(`Session: \`${entry.sessionId}\`  \n`);
		tooltip.appendMarkdown(`Requested: ${timestamp}\n\n`);
		if (!entry.sections.length) {
			tooltip.appendMarkdown('_No sections_');
		} else {
			for (const section of entry.sections) {
				tooltip.appendMarkdown('---\n');
				tooltip.appendMarkdown(`**${section.label}** (_${section.kind}_)\n\n`);
				if (section.content?.trim()) {
					tooltip.appendMarkdown(`${section.content}\n\n`);
				} else {
					tooltip.appendMarkdown('_(empty)_\n\n');
				}
			}
		}
		tooltip.isTrusted = true;
		return tooltip;
	}

	private buildSectionDescription(section: LiveRequestSection): string {
		const snippet = section.content?.split('\n')[0] ?? '';
		return snippet.length > 40 ? `${snippet.slice(0, 40)}…` : snippet;
	}

	private sectionIcon(kind: LiveRequestSection['kind']): vscode.ThemeIcon {
		switch (kind) {
			case 'system':
				return new vscode.ThemeIcon('shield');
			case 'context':
			case 'history':
				return new vscode.ThemeIcon('references');
			case 'tool':
				return new vscode.ThemeIcon('wrench');
			case 'assistant':
				return new vscode.ThemeIcon('comment-discussion');
			default:
				return new vscode.ThemeIcon('note');
		}
	}
}
