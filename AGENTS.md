# Agent Instructions

This repository’s workflow rules are defined in `agent-prompt.md`. Treat `agent-prompt.md` as the source of truth for:

- Spec-first workflow (`.specs/<feature>/{design,requirements,tasks}.md`)
- Phase discipline (design vs implementation)
- Verification expectations (“quad verification”)
- Documentation link format (clickable relative file links with `#L` anchors)

If any instruction in this file conflicts with `agent-prompt.md`, prefer `agent-prompt.md`.

## Workflow Coach reminders

At workflow checkpoints (before commit/push/PR/scope changes), run:

`npm run workflow:coach -- --query "<current request>" --no-gh`

Optionally install repo-local git hooks to run the coach automatically:

`npm run workflow:install-hooks`
