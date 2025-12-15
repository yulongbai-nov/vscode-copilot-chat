/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GraphitiPromotionKind, GraphitiPromotionScope } from './graphitiPromotionTemplates';

export interface GraphitiMemoryDirective {
	readonly kind: GraphitiPromotionKind;
	readonly scope: GraphitiPromotionScope;
	readonly content: string;
}

type ParsedDirectiveHeader = {
	readonly kind: GraphitiPromotionKind;
	readonly scopeOverride?: GraphitiPromotionScope;
	readonly contentAfterColon: string;
};

function normalizeDirectiveKind(raw: string): GraphitiPromotionKind | undefined {
	const normalized = raw.trim().toLowerCase().replaceAll(/[-\s]+/g, '_');

	switch (normalized) {
		case 'decision':
			return 'decision';
		case 'lesson':
		case 'lesson_learned':
		case 'lessons':
		case 'lessons_learned':
		case 'remember':
		case 'note':
			return 'lesson_learned';
		case 'preference':
		case 'preferences':
		case 'pref':
		case 'prefs':
			return 'preference';
		case 'procedure':
		case 'steps':
		case 'howto':
		case 'how_to':
			return 'procedure';
		case 'task':
		case 'task_update':
		case 'taskupdate':
		case 'todo':
			return 'task_update';
		case 'terminology':
		case 'term':
		case 'naming':
			return 'terminology';
		default:
			return undefined;
	}
}

function parseDirectiveHeader(line: string): ParsedDirectiveHeader | undefined {
	const match = /^\s*([a-zA-Z][a-zA-Z0-9 _-]*?)(?:\s*\(\s*(user|workspace)\s*\))?\s*:\s*(.*)\s*$/.exec(line);
	if (!match) {
		return undefined;
	}

	const kind = normalizeDirectiveKind(match[1] ?? '');
	if (!kind) {
		return undefined;
	}

	const scopeOverride = match[2] === 'user' || match[2] === 'workspace' ? match[2] : undefined;
	const contentAfterColon = match[3] ?? '';

	return { kind, scopeOverride, contentAfterColon };
}

export function inferGraphitiPromotionScope(kind: GraphitiPromotionKind, content: string): GraphitiPromotionScope {
	const normalized = content.trim().toLowerCase();

	// Project-scoped kinds default to workspace unless explicitly overridden in the directive.
	if (kind === 'decision' || kind === 'procedure' || kind === 'task_update') {
		return 'workspace';
	}

	const hasUserCue = [
		/\bi\s+prefer\b/,
		/\bmy\s+(preference|preferences|terminology|setup|workflow|style|convention|config|settings)\b/,
		/\bin\s+general\b/,
		/\bacross\s+(repos|repositories|projects|workspaces)\b/,
	].some(re => re.test(normalized));

	const hasWorkspaceCue = [
		/\b(in\s+this|for\s+this)\s+(repo|repository|project|workspace|codebase)\b/,
		/\bthis\s+(repo|repository|project|workspace|codebase)\b/,
		/\bhere\b/,
	].some(re => re.test(normalized));

	if (hasUserCue && !hasWorkspaceCue) {
		return 'user';
	}
	if (hasWorkspaceCue && !hasUserCue) {
		return 'workspace';
	}

	// Prefer the least persistent scope when ambiguous.
	return 'workspace';
}

export function looksLikeSecretForAutoPromotion(content: string): boolean {
	const normalized = content.toLowerCase();

	// Keyword-based guard (intentionally conservative).
	if (/\b(password|passwd|pwd)\b/.test(normalized)) {
		return true;
	}
	if (/\b(secret|token)\b/.test(normalized)) {
		return true;
	}
	if (/\b(api[_ -]?key|apikey)\b/.test(normalized)) {
		return true;
	}

	// Stronger signature-based guard.
	if (/-----begin [a-z ]*private key-----/i.test(content)) {
		return true;
	}
	if (/\b(ghp|gho)_[a-z0-9]{20,}\b/i.test(content)) {
		return true;
	}
	if (/\bgithub_pat_[a-z0-9_]{20,}\b/i.test(content)) {
		return true;
	}
	if (/\bsk-[a-z0-9]{20,}\b/i.test(content)) {
		return true;
	}
	if (/\bakia[0-9a-z]{16}\b/i.test(content)) {
		return true;
	}
	if (/\bxox[baprs]-[a-z0-9-]{10,}\b/i.test(content)) {
		return true;
	}

	return false;
}

export function parseGraphitiMemoryDirectives(message: string): readonly GraphitiMemoryDirective[] {
	const directives: GraphitiMemoryDirective[] = [];
	const lines = message.split(/\r?\n/);

	for (let i = 0; i < lines.length; i++) {
		const header = parseDirectiveHeader(lines[i]);
		if (!header) {
			continue;
		}

		const contentLines: string[] = [];
		if (header.contentAfterColon.trim()) {
			contentLines.push(header.contentAfterColon);
		} else {
			let j = i + 1;
			while (j < lines.length && lines[j].trim()) {
				contentLines.push(lines[j]);
				j++;
			}
			i = j - 1;
		}

		const content = contentLines.join('\n').trim();
		if (!content) {
			continue;
		}

		const scope = header.scopeOverride ?? inferGraphitiPromotionScope(header.kind, content);
		directives.push({ kind: header.kind, scope, content });
	}

	return directives;
}
