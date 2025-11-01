/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentOptions, Attachment, ModelProvider, PostToolUseHookInput, PreToolUseHookInput, Session, SessionEvent } from '@github/copilot/sdk';
import type * as vscode from 'vscode';
import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { ILogService } from '../../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { ChatResponseThinkingProgressPart, ChatSessionStatus, EventEmitter, LanguageModelTextPart } from '../../../../vscodeTypes';
import { IToolsService } from '../../../tools/common/toolsService';
import { ExternalEditTracker } from '../../common/externalEditTracker';
import { getAffectedUrisForEditTool } from '../common/copilotcliTools';
import { ICopilotCLISDK } from './copilotCli';
import { processToolExecutionComplete, processToolExecutionStart } from './copilotcliToolInvocationFormatter';
import { getCopilotLogger } from './logger';
import { getConfirmationToolParams, PermissionRequest } from './permissionHelpers';

export class CopilotCLISession extends DisposableStore {
	private _abortController = new AbortController();
	private _pendingToolInvocations = new Map<string, vscode.ChatToolInvocationPart>();
	private _editTracker = new ExternalEditTracker();
	public readonly sessionId: string;
	private _status?: vscode.ChatSessionStatus;
	public get status(): vscode.ChatSessionStatus | undefined {
		return this._status;
	}
	private readonly _statusChange = this.add(new EventEmitter<vscode.ChatSessionStatus | undefined>());

	public readonly onDidChangeStatus = this._statusChange.event;

	constructor(
		private readonly _sdkSession: Session,
		@ILogService private readonly logService: ILogService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IToolsService private readonly toolsService: IToolsService,
		@ICopilotCLISDK private readonly copilotCLISDK: ICopilotCLISDK
	) {
		super();
		this.sessionId = _sdkSession.sessionId;
	}

	public override dispose(): void {
		this._abortController.abort();
		super.dispose();
	}

	async *query(prompt: string, attachments: Attachment[], options: AgentOptions): AsyncGenerator<SessionEvent> {
		// Dynamically import the SDK
		const { Agent } = await this.copilotCLISDK.getPackage();
		const agent = new Agent(options);
		yield* agent.query(prompt, attachments);
	}

	public async invoke(
		prompt: string,
		attachments: Attachment[],
		toolInvocationToken: vscode.ChatParticipantToolToken,
		stream: vscode.ChatResponseStream,
		modelId: ModelProvider | undefined,
		token: vscode.CancellationToken
	): Promise<void> {
		if (this.isDisposed) {
			throw new Error('Session disposed');
		}

		this._status = ChatSessionStatus.InProgress;
		this._statusChange.fire(this._status);

		this.logService.trace(`[CopilotCLISession] Invoking session ${this.sessionId}`);
		const copilotToken = await this._authenticationService.getCopilotToken();

		const options: AgentOptions = {
			modelProvider: modelId ?? {
				type: 'anthropic',
				model: 'claude-sonnet-4.5',
			},
			abortController: this._abortController,
			// TODO@rebornix handle workspace properly
			workingDirectory: this.workspaceService.getWorkspaceFolders().at(0)?.fsPath,
			copilotToken: copilotToken.token,
			env: {
				...process.env,
				COPILOTCLI_DISABLE_NONESSENTIAL_TRAFFIC: '1'
			},
			requestPermission: async (permissionRequest) => {
				return await this.requestPermission(permissionRequest, toolInvocationToken);
			},
			logger: getCopilotLogger(this.logService),
			session: this._sdkSession,
			hooks: {
				preToolUse: [
					async (input: PreToolUseHookInput) => {
						const editKey = getEditOperationKey(input.toolName, input.toolArgs);
						await this._onWillEditTool(input, editKey, stream);
					}
				],
				postToolUse: [
					async (input: PostToolUseHookInput) => {
						const editKey = getEditOperationKey(input.toolName, input.toolArgs);
						void this._onDidEditTool(editKey);
					}
				]
			}
		};

		try {
			for await (const event of this.query(prompt, attachments, options)) {
				if (token.isCancellationRequested) {
					break;
				}

				this._processEvent(event, stream, toolInvocationToken);
			}
			this._status = ChatSessionStatus.Completed;
			this._statusChange.fire(this._status);
		} catch (error) {
			this._status = ChatSessionStatus.Failed;
			this._statusChange.fire(this._status);
			this.logService.error(`CopilotCLI session error: ${error}`);
			stream.markdown(`\n\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private _toolNames = new Map<string, string>();
	private _processEvent(
		event: SessionEvent,
		stream: vscode.ChatResponseStream,
		toolInvocationToken: vscode.ChatParticipantToolToken
	): void {
		this.logService.trace(`CopilotCLI Event: ${JSON.stringify(event, null, 2)}`);

		switch (event.type) {
			case 'assistant.turn_start':
			case 'assistant.turn_end': {
				this._toolNames.clear();
				break;
			}

			case 'assistant.message': {
				if (event.data.content.length) {
					stream.markdown(event.data.content);
				}
				break;
			}

			case 'tool.execution_start': {
				const responsePart = processToolExecutionStart(event, this._toolNames, this._pendingToolInvocations);
				const toolName = this._toolNames.get(event.data.toolCallId);
				if (responsePart instanceof ChatResponseThinkingProgressPart) {
					stream.push(responsePart);
				}
				this.logService.trace(`Start Tool ${toolName || '<unknown>'}`);
				break;
			}

			case 'tool.execution_complete': {
				const responsePart = processToolExecutionComplete(event, this._pendingToolInvocations);
				if (responsePart && !(responsePart instanceof ChatResponseThinkingProgressPart)) {
					stream.push(responsePart);
				}

				const toolName = this._toolNames.get(event.data.toolCallId) || '<unknown>';
				const success = `success: ${event.data.success}`;
				const error = event.data.error ? `error: ${event.data.error.code},${event.data.error.message}` : '';
				const result = event.data.result ? `result: ${event.data.result?.content}` : '';
				const parts = [success, error, result].filter(part => part.length > 0).join(', ');
				this.logService.trace(`Complete Tool ${toolName}, ${parts}`);
				break;
			}

			case 'session.error': {
				this.logService.error(`CopilotCLI error: (${event.data.errorType}), ${event.data.message}`);
				stream.markdown(`\n\n❌ Error: ${event.data.message}`);
				break;
			}
		}
	}

	private async requestPermission(
		permissionRequest: PermissionRequest,
		toolInvocationToken: vscode.ChatParticipantToolToken
	): Promise<{ kind: 'approved' } | { kind: 'denied-interactively-by-user' }> {
		try {
			const { tool, input } = getConfirmationToolParams(permissionRequest);
			const result = await this.toolsService.invokeTool(tool,
				{ input, toolInvocationToken },
				CancellationToken.None);

			const firstResultPart = result.content.at(0);
			if (firstResultPart instanceof LanguageModelTextPart && firstResultPart.value === 'yes') {
				return { kind: 'approved' };
			}
		} catch (error) {
			this.logService.error(`[CopilotCLISession] Permission request error: ${error}`);
		}

		return { kind: 'denied-interactively-by-user' };
	}

	private async _onWillEditTool(input: PreToolUseHookInput, editKey: string, stream: vscode.ChatResponseStream): Promise<void> {
		const uris = getAffectedUrisForEditTool(input.toolName, input.toolArgs);
		return this._editTracker.trackEdit(editKey, uris, stream);
	}

	private async _onDidEditTool(editKey: string): Promise<void> {
		return this._editTracker.completeEdit(editKey);
	}
}


function getEditOperationKey(toolName: string, toolArgs: unknown): string {
	// todo@connor4312: get copilot CLI to surface the tool call ID instead?
	return `${toolName}:${JSON.stringify(toolArgs)}`;
}
