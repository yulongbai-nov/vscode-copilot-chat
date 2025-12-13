# Design Document: Chat API Migration (Parked)

## Overview

This feature proposed migrating the Prompt Section Visualizer to VS Code's native Copilot Chat rendering APIs. No implementation exists in this repository: there are no `PromptVisualizer`/`NativeChatRenderer`/chat-participant classes, no feature flag, and no supporting commands. The migration is therefore **parked**.

- **Current reality:** The legacy Prompt Section Visualizer code referenced by the original plan is not present in this repo. No migration work has begun.
- **Decision:** Keep this feature parked until a concrete requirement resurfaces. When/if resumed, revisit the design, align with the then-current chat API surface, and create a fresh plan.

## Future Considerations (if revived)

- Re-evaluate native chat APIs available at that time.
- Define a minimal viable scope (render-only vs. edit) and the gating flag.
- Align naming with existing settings/commands to avoid collisions.
- Ensure parity testing and telemetry plans exist before implementation.
