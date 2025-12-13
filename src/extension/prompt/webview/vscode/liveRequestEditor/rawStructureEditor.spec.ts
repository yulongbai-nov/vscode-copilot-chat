/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { describe, expect, it } from 'vitest';
import TestRenderer from 'react-test-renderer';
import { RawStructureEditor } from './rawStructureEditor';

function collectText(node: unknown): string {
	if (node === null || node === undefined) {
		return '';
	}
	if (typeof node === 'string') {
		return node;
	}
	if (Array.isArray(node)) {
		return node.map(collectText).join('');
	}
	if (typeof node === 'object') {
		const record = node as { children?: unknown };
		return collectText(record.children);
	}
	return '';
}

describe('RawStructureEditor', () => {
	it('does not render stable JSON as circular after re-render', () => {
		const message = {
			role: 'assistant',
			content: [{ type: 1, text: 'hello' }],
			toolCalls: [{ id: 'call_1', function: { name: 'readFile', arguments: '{}' } }],
		};
		const section = { id: 'assistant-0', message };
		const props = {
			section,
			payloadIndex: 0,
			canEdit: false,
			canUndo: false,
			canRedo: false,
			onEditLeaf: () => { /* no-op */ },
			onUndoLeafEdit: () => { /* no-op */ },
			onRedoLeafEdit: () => { /* no-op */ },
		};

		const renderer = TestRenderer.create(React.createElement(RawStructureEditor, props));
		expect(collectText(renderer.toJSON())).not.toContain('[circular]');

		TestRenderer.act(() => {
			renderer.update(React.createElement(RawStructureEditor, props));
		});
		expect(collectText(renderer.toJSON())).not.toContain('[circular]');
	});

	it('does not render stable JSON as circular after expanding/collapsing nodes', () => {
		const message = {
			role: 'assistant',
			content: [{ type: 1, text: 'hello' }],
			toolCalls: [{ id: 'call_1', function: { name: 'readFile', arguments: '{}' } }],
		};
		const section = { id: 'assistant-0', message };
		const props = {
			section,
			payloadIndex: 0,
			canEdit: false,
			canUndo: false,
			canRedo: false,
			onEditLeaf: () => { /* no-op */ },
			onUndoLeafEdit: () => { /* no-op */ },
			onRedoLeafEdit: () => { /* no-op */ },
		};

		const renderer = TestRenderer.create(React.createElement(RawStructureEditor, props));
		expect(collectText(renderer.toJSON())).not.toContain('[circular]');

		const headers = renderer.root.findAll(node => node.type === 'div' && node.props.className === 'raw-group-header');
		expect(headers.length).toBeGreaterThan(0);
		const header = headers[0];

		TestRenderer.act(() => {
			header.props.onClick();
		});
		expect(collectText(renderer.toJSON())).not.toContain('[circular]');

		TestRenderer.act(() => {
			header.props.onClick();
		});
		expect(collectText(renderer.toJSON())).not.toContain('[circular]');
	});
});
