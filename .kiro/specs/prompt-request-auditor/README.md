# Prompt Request Auditor

This spec folder tracks work to turn the Prompt Section Visualizer into a first-class **prompt request auditor** for Copilot Chat.

The goal is to drive the visualizer from the *actual* ChatML payloads being sent to the LLM (via `IChatMLFetcher.onDidMakeChatMLRequest`), so that engineers can:

- Inspect the exact XML-tagged prompt content that was sent.
- See token counts and warning levels per section.
- Compare the inline `/visualize-prompt` debug view with the production request path.

See:

- `design.md` – architecture for wiring ChatML events into `IPromptStateManager` and the visualizer surfaces.
- `requirements.md` – user stories and acceptance criteria for “prompt request auditing”.
- `tasks.md` – implementation and follow-up checklist for the next agent.

