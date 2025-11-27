# Kiro Workspace Overview

This folder captures larger implementation efforts as hand-off ready specs. Use it as the "source of truth" for work items that span multiple PRs.

## Structure

```
.kiro/
├── README.md                # (this file) folder overview & conventions
└── specs/
    ├── chat-api-migration/  # feature-specific specs (tasks, summaries, etc.)
    │   ├── tasks.md
    │   ├── requirements.md
    │   └── ...
    └── prompt-section-visualizer/
        ├── design.md
        ├── tasks.md
        ├── manual-test-prompts.md
        ├── standalone-renderer-plan.md  # latest hand-off plan
        └── ...
```

## How Specs Cooperate
- Each feature gets its own subfolder under `.kiro/specs/`.
- `tasks.md` files describe incremental implementation plans (checked list style).
- `design.md` captures architecture and service relationships.
- Summary files (e.g., `task-12-summary.md`) document what shipped.
- Additional plans (like `standalone-renderer-plan.md`) add follow-up work.
- Docs reference actual source files (e.g., `src/extension/promptSectionVisualizer/...`).

Hosting specs alongside code keeps requirements and implementation history in sync; link relevant spec sections in PR descriptions so reviewers can follow along.
