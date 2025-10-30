/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const core = require('@actions/core');
const github = require('@actions/github');

const ACTIONABLE_CONCLUSIONS = new Set([
	'action_required',
	'cancelled',
	'failure',
	'stale',
	'timed_out',
]);

const MAX_RUN_ENTRIES = 10;

async function run() {
	const token = process.env.GITHUB_TOKEN;
	if (!token) {
		throw new Error('GITHUB_TOKEN is required to post comments.');
	}

	const suite = github.context.payload?.check_suite;
	if (!suite) {
		core.info('No check suite payload present; skipping.');
		return;
	}

	const conclusion = suite.conclusion ?? 'unknown';
	if (!ACTIONABLE_CONCLUSIONS.has(conclusion)) {
		core.info(`Check suite concluded with "${conclusion}"; no escalation needed.`);
		return;
	}

	const associatedPulls = suite.pull_requests ?? [];
	const prNumbers = associatedPulls
		.map(pr => pr?.number)
		.filter(number => typeof number === 'number' && number > 0);

	if (prNumbers.length === 0) {
		core.info('No pull requests are associated with this check suite; skipping.');
		return;
	}

	const octokit = github.getOctokit(token);
	const { owner, repo } = github.context.repo;

	const checkRuns = [];
	for await (const response of octokit.paginate.iterator(
		octokit.rest.checks.listForSuite,
		{
			owner,
			repo,
			check_suite_id: suite.id,
			per_page: 100,
		}
	)) {
		for (const run of response.data) {
			checkRuns.push(run);
		}
	}

	const failingRuns = checkRuns.filter(run => ACTIONABLE_CONCLUSIONS.has(run.conclusion ?? ''));
	if (failingRuns.length === 0) {
		core.info('No failing check runs detected; skipping escalation.');
		return;
	}

	/**
	 * Produce a bullet point describing a failing check run, including first summary line when available.
	 */
	const formatRun = run => {
		const conclusionLabel = (run.conclusion ?? 'unknown').toUpperCase();
		const attempt = typeof run.run_attempt === 'number' ? ` (attempt ${run.run_attempt})` : '';
		const summaryLine = (run.output?.summary || '')
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean)[0];
		let line = `- ${conclusionLabel}: [${run.name}](${run.html_url})${attempt}`;
		if (summaryLine) {
			line += `\n  - ${summaryLine}`;
		}
		return line;
	};

	const formattedRuns = failingRuns
		.slice(0, MAX_RUN_ENTRIES)
		.map(formatRun);

	if (failingRuns.length > MAX_RUN_ENTRIES) {
		formattedRuns.push(`- ... ${failingRuns.length - MAX_RUN_ENTRIES} additional failing checks omitted.`);
	}

	const basePrompt = 'Please investigate the failing GitHub Actions checks listed below, identify the root cause, outline the fix, and share the next steps for this pull request.';

	const metadata = [];
	if (suite.name) {
		metadata.push(`- **Workflow**: ${suite.name}`);
	}
	if (suite.head_branch) {
		metadata.push(`- **Branch**: ${suite.head_branch}`);
	}
	if (suite.head_sha) {
		metadata.push(`- **Commit**: [${suite.head_sha.slice(0, 7)}](https://github.com/${owner}/${repo}/commit/${suite.head_sha})`);
	}
	if (suite.head_commit?.author?.name) {
		metadata.push(`- **Latest author**: ${suite.head_commit.author.name}`);
	}
	metadata.push(`- **Conclusion**: ${conclusion.toUpperCase()}`);

	const marker = `<!-- copilot-maintenance-delegate:check-suite:${suite.id} -->`;
	const commentBody = [
		marker,
		`@copilot ${basePrompt}`,
		'',
		'### Failing checks',
		formattedRuns.join('\n'),
		'',
		'### Context',
		metadata.join('\n'),
	].join('\n');

	/**
	 * Scan existing issue comments to see whether we've already posted a delegation marker for this suite.
	 */
	const findExistingComment = async issueNumber => {
		for await (const response of octokit.paginate.iterator(
			octokit.rest.issues.listComments,
			{
				owner,
				repo,
				issue_number: issueNumber,
				per_page: 100,
			}
		)) {
			const match = response.data.find(comment => typeof comment.body === 'string' && comment.body.includes(marker));
			if (match) {
				return match;
			}
		}
		return undefined;
	};

	for (const prNumber of prNumbers) {
		const existing = await findExistingComment(prNumber);
		if (existing) {
			core.info(`A delegation comment already exists on pull request #${prNumber}; skipping.`);
			continue;
		}

		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: prNumber,
			body: commentBody,
		});

		core.info(`Posted @copilot comment to pull request #${prNumber}.`);
	}
}

run().catch(error => {
	if (error instanceof Error) {
		core.setFailed(error.message);
		return;
	}

	core.setFailed(String(error));
});
