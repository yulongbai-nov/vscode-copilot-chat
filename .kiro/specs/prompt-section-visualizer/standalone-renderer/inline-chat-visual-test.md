# Inline Visualizer Test Prompt

Use this doc when you need a deterministic prompt to validate inline `/visualize-prompt` rendering. It mirrors the content we used while building the shared renderer so discrepancies between chat vs. panel are easy to spot.

## Steps
1. Launch the extension (`F5` in VS Code) and open Copilot Chat.
2. Paste the full payload below into the chat input (or the `vscode-chat-input` document).
3. Run `/visualize-prompt`.
4. Inspect the chat response for:
   - Section headers with collapse icons and token badges.
   - Token warnings on the `<constraints>` block (it is intentionally long).
   - Header token summary showing **Total**, **Content**, **Tags**, and **Overhead**.
   - Rendered code block inside `<examples>`.
   - Command buttons (`Edit`, `Delete`, `Collapse`) when `showActions` is enabled.
   - Pagination (`Load more…`) if your `maxSections` setting is below the total number of sections (add the optional sections if needed).

## Prompt Payload
```
<context>
You are debugging a flaky integration test that fails only on Linux runners after ~50 minutes. Reproduce locally, capture telemetry, and summarize why the retry logic behaves differently under low disk space.
</context>

<instructions>
1. Audit the retry/backoff helpers in src/core/retry.ts for any clock drift assumptions.
2. Validate that the workflow job definition aligns with the documented SLO: total runtime under 60 minutes with max 3 retries.
3. Produce a risk matrix covering env vars, cache state, and artifact retention, then propose mitigations ordered by cost.
</instructions>

<examples>
```ts
import { withBackoff } from '../retry';
test('uploads stay under 5 minutes', async () => {
  await withBackoff(async attempt => {
    expect(await uploadArtifacts()).toBeLessThan(5 * attempt);
  });
});
```
</examples>

<constraints>
- Treat tokens ≥ 900 as critical and call out any single section crossing that threshold.
- Responses must cite log files using backticks (for example, `logs/runner-1234.txt`).
- Never suggest deleting caches unless you have a reproducible script to rebuild them.
- Preferred output format: markdown bullets with bolded labels and inline code for file paths.
</constraints>

<customer_context>
Customer: “Northwind ML Ops”
Region: WUS2
Contact: Priya Shah (priya.shah@nwind.com)
Premium SLA: yes — respond within 2 business hours.
</customer_context>

<open_questions>
- Do we have proof that the retry counter resets after a canceled workflow?
- Is the artifact bundle compressed before upload on runners without gzip installed?
- Should we escalate to the reliability guild if the issue reproduces on ARM agents?
</open_questions>

<!-- Optional sections to trigger pagination -->
<telemetry_plan>
List the log streams, metrics, and traces you’ll capture. Highlight anything that requires sampling overrides or feature flags.
</telemetry_plan>

<follow_up>
Confirm who will own the follow-up root-cause report and when it’s due. Include a placeholder link to the doc.
</follow_up>
```

## Recording Issues
- If chat renders correctly but the standalone panel diverges, capture screenshots plus the current commit SHA.
- Note whether `showActions`, `maxSections`, or `showTokenBreakdown` were toggled—these flags help reproduce layout glitches.
