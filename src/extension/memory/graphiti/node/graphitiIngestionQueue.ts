/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GraphitiMessage } from './graphitiTypes';

export interface GraphitiIngestionBatch {
	readonly groupId: string;
	readonly messages: readonly GraphitiMessage[];
}

type QueuedMessage = { groupId: string; message: GraphitiMessage };

export class GraphitiIngestionQueue {
	private readonly _queue: QueuedMessage[] = [];

	get size(): number {
		return this._queue.length;
	}

	clear(): void {
		this._queue.length = 0;
	}

	enqueue(groupId: string, messages: readonly GraphitiMessage[], maxQueueSize: number): { droppedCount: number } {
		for (const message of messages) {
			this._queue.push({ groupId, message });
		}

		let droppedCount = 0;
		while (this._queue.length > maxQueueSize) {
			this._queue.shift();
			droppedCount++;
		}

		return { droppedCount };
	}

	takeBatch(maxBatchSize: number): GraphitiIngestionBatch | undefined {
		const first = this._queue[0];
		if (!first) {
			return undefined;
		}

		const groupId = first.groupId;
		const messages: GraphitiMessage[] = [];

		while (this._queue.length > 0 && this._queue[0].groupId === groupId && messages.length < maxBatchSize) {
			messages.push(this._queue.shift()!.message);
		}

		return { groupId, messages };
	}

	requeueBatch(batch: GraphitiIngestionBatch): void {
		for (let i = batch.messages.length - 1; i >= 0; i--) {
			this._queue.unshift({ groupId: batch.groupId, message: batch.messages[i] });
		}
	}
}

