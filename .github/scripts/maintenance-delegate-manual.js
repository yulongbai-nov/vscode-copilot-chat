/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const core = require('@actions/core');
const github = require('@actions/github');

const MANUAL_MARKER = '<!-- copilot-maintenance-delegate:manual -->';

async function run() {
	const token = process.env.GITHUB_TOKEN;
	if (!token) {
		throw new Error('GITHUB_TOKEN is required to post comments.');
	}

	const prNumberRaw = core.getInput('pr_number', { required: true });
	const prNumber = Number(prNumberRaw);
	if (Number.isNaN(prNumber) || prNumber < 1) {
		throw new Error(`Invalid pull request number: ${prNumberRaw}`);
	}

	const basePrompt = 'Please investigate the failing GitHub Actions checks for this pull request. Identify the root cause, outline the fix, and push updates or document the next steps.';
	// core.getInput reads from the GitHub Actions-provided INPUT_INSTRUCTIONS environment variable.
	const extra = core.getInput('instructions');
	const trimmedExtra = (extra ?? '').trim();
	const instructions = trimmedExtra.length > 0
		? `${basePrompt}\n\nAdditional context:\n${trimmedExtra}`
		: basePrompt;

	const body = [
		MANUAL_MARKER,
		`@copilot ${instructions}`,
		'',
		'Please leave a brief status update once the issue is resolved.'
	].join('\n');

	const octokit = github.getOctokit(token);
	const { owner, repo } = github.context.repo;

	await octokit.rest.pulls.get({
		owner,
		repo,
		pull_number: prNumber,
	});

	await octokit.rest.issues.createComment({
		owner,
		repo,
		issue_number: prNumber,
		body,
	});

	core.info(`Posted @copilot comment to pull request #${prNumber}.`);
}

run().catch(error => {
	if (error instanceof Error) {
		core.setFailed(error.message);
		return;
	}

	core.setFailed(String(error));
});
