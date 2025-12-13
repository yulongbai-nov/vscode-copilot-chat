/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

export interface RawStructureEditorSection {
	readonly id: string;
	readonly message?: unknown;
}

function isSupportedRawPath(path: string): boolean {
	if (!path.length) {
		return false;
	}
	const segments = path.split('.').filter(Boolean);
	if (!segments.length) {
		return false;
	}
	return segments.every(segment => /^([a-zA-Z0-9_]+)(?:\[(\d+)\])?$/.test(segment));
}

function formatLeafValue(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (value === undefined) {
		return 'undefined';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isLeafValue(value: unknown): boolean {
	return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

interface RawTreeNodeProps {
	label: string;
	value: unknown;
	path: string;
	displayPath: string;
	depth: number;
	sectionId: string;
	canEdit: boolean;
	onEditLeaf: (sectionId: string, path: string, value: unknown) => void;
	seen: WeakSet<object>;
}

const RawTreeNode: React.FC<RawTreeNodeProps> = ({ label, value, path, displayPath, depth, sectionId, canEdit, onEditLeaf, seen }) => {
	const isArray = Array.isArray(value);
	const isObject = isPlainObject(value);
	const isEditableLeaf = canEdit && isLeafValue(value) && isSupportedRawPath(path);

	const [collapsed, setCollapsed] = React.useState(() => depth >= 2);
	const [draft, setDraft] = React.useState(() => formatLeafValue(value));

	React.useEffect(() => {
		setDraft(formatLeafValue(value));
	}, [value]);

	if (isArray || isObject) {
		if (typeof value === 'object' && value !== null) {
			if (seen.has(value)) {
				return React.createElement(
					'div',
					{ className: 'raw-node raw-node-leaf', style: { marginLeft: depth * 10 } },
					React.createElement(
						'div',
						{ className: 'raw-leaf-header' },
						React.createElement('span', { className: 'raw-key' }, label),
						React.createElement('span', { className: 'raw-path' }, displayPath),
					),
					React.createElement('div', { className: 'raw-leaf-value raw-leaf-value-readonly' }, '[circular]'),
				);
			}
			seen.add(value);
		}

		const entries = isArray
			? (value as unknown[]).map((entry, index) => ({
				childLabel: `${label}[${index}]`,
				childPath: `${path}[${index}]`,
				childDisplayPath: `${displayPath}[${index}]`,
				childValue: entry
			}))
			: Object.keys(value as Record<string, unknown>).map(key => ({
				childLabel: key,
				childPath: `${path}.${key}`,
				childDisplayPath: `${displayPath}.${key}`,
				childValue: (value as Record<string, unknown>)[key]
			}));

		const summary = isArray ? `(${(value as unknown[]).length})` : `(${Object.keys(value as Record<string, unknown>).length})`;

		return React.createElement(
			'div',
			{ className: 'raw-node raw-node-group', style: { marginLeft: depth * 10 } },
			React.createElement(
				'div',
				{
					className: 'raw-group-header',
					role: 'button',
					tabIndex: 0,
					onClick: () => setCollapsed(prev => !prev),
					onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							setCollapsed(prev => !prev);
						}
					},
				},
				React.createElement('span', { className: 'raw-caret', 'aria-hidden': true }, collapsed ? '\u25B6' : '\u25BC'),
				React.createElement('span', { className: 'raw-key' }, label),
				React.createElement('span', { className: 'raw-summary' }, summary),
				React.createElement('span', { className: 'raw-path' }, displayPath),
			),
			collapsed
				? null
				: React.createElement(
					'div',
					{ className: 'raw-group-body' },
					entries.length
						? entries.map(entry =>
							React.createElement(RawTreeNode, {
								key: entry.childPath,
								label: entry.childLabel,
								value: entry.childValue,
								path: entry.childPath,
								displayPath: entry.childDisplayPath,
								depth: depth + 1,
								sectionId,
								canEdit,
								onEditLeaf,
								seen,
							}))
						: React.createElement('div', { className: 'raw-empty' }, 'Empty'),
				),
		);
	}

	const isDirty = draft !== formatLeafValue(value);
	const useTextarea = typeof value === 'string' && (value.includes('\n') || value.length > 80);

	return React.createElement(
		'div',
		{ className: 'raw-node raw-node-leaf', style: { marginLeft: depth * 10 } },
		React.createElement(
			'div',
			{ className: 'raw-leaf-header' },
			React.createElement('span', { className: 'raw-key' }, label),
			React.createElement('span', { className: 'raw-path' }, displayPath),
		),
		isEditableLeaf
			? React.createElement(
				'div',
				{ className: 'raw-leaf-editor' },
				useTextarea
					? React.createElement('textarea', {
						className: 'raw-leaf-input raw-leaf-textarea',
						value: draft,
						onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value),
					})
					: React.createElement('input', {
						className: 'raw-leaf-input',
						value: draft,
						onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
					}),
				React.createElement(
					'button',
					{
						type: 'button',
						className: 'raw-apply-button',
						disabled: !isDirty,
						onClick: () => onEditLeaf(sectionId, path, draft),
						title: 'Apply leaf edit',
					},
					'Apply',
				),
			)
			: React.createElement('div', { className: 'raw-leaf-value raw-leaf-value-readonly' }, formatLeafValue(value)),
	);
};

export interface RawStructureEditorProps {
	section: RawStructureEditorSection;
	payloadIndex: number;
	canEdit: boolean;
	canUndo: boolean;
	canRedo: boolean;
	onEditLeaf: (sectionId: string, path: string, value: unknown) => void;
	onUndoLeafEdit: () => void;
	onRedoLeafEdit: () => void;
}

export const RawStructureEditor: React.FC<RawStructureEditorProps> = ({ section, payloadIndex, canEdit, canUndo, canRedo, onEditLeaf, onUndoLeafEdit, onRedoLeafEdit }) => {
	const message = section.message;
	const rootPath = `messages[${payloadIndex}]`;
	// Use a fresh cycle-detection set per render so repeated renders never mark
	// stable JSON graphs as "[circular]".
	const seen = new WeakSet<object>();

	if (!message || typeof message !== 'object') {
		return React.createElement('div', { className: 'raw-structure-missing' }, 'Raw message unavailable for this section.');
	}

	const keys = Object.keys(message as Record<string, unknown>);
	keys.sort((a, b) => (a === 'role' ? -1 : b === 'role' ? 1 : a.localeCompare(b)));

	return React.createElement(
		'div',
		{ className: 'raw-structure' },
		React.createElement(
			'div',
			{ className: 'raw-structure-toolbar' },
			React.createElement('div', { className: 'raw-structure-title' }, 'Raw structure'),
			React.createElement(
				'div',
				{ className: 'raw-structure-actions' },
				React.createElement('button', { type: 'button', className: 'raw-toolbar-button', disabled: !canUndo, onClick: onUndoLeafEdit, title: 'Undo last leaf edit' }, 'Undo'),
				React.createElement('button', { type: 'button', className: 'raw-toolbar-button', disabled: !canRedo, onClick: onRedoLeafEdit, title: 'Redo last leaf edit' }, 'Redo'),
			),
		),
		React.createElement('div', { className: 'raw-structure-root' }, rootPath),
		React.createElement(
			'div',
			{ className: 'raw-structure-body' },
			keys.length
				? keys.map(key =>
					React.createElement(RawTreeNode, {
						key,
						label: key,
						value: (message as Record<string, unknown>)[key],
						path: key,
						displayPath: `${rootPath}.${key}`,
						depth: 0,
						sectionId: section.id,
						canEdit,
						onEditLeaf,
						seen,
					}))
				: React.createElement('div', { className: 'raw-empty' }, 'No fields'),
		),
	);
};

