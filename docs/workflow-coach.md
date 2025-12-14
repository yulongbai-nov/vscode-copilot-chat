# Workflow Coach (MVP)

Workflow Coach is an **advisory** script that inspects the repo state (git + optional GitHub PR status) and prints the next workflow reminders (spec-first, branch hygiene, verification, PR hygiene).

It is intended to reduce “I forgot a step” errors without blocking work.

## Run

```bash
npm run workflow:coach -- --query "please implement X"
```

Fast / offline mode (skips `gh`):

```bash
npm run workflow:coach -- --query "…" --no-gh
```

Machine-readable mode:

```bash
npm run workflow:coach -- --query "…" --json
```

## When to run (recommended checkpoints)

- Before committing
- Before pushing
- Before opening a PR
- When switching scope / splitting into multiple branches
- After rebases/merges (to re-check ahead/behind + PR status)

## Output (what to expect)

- Branch + upstream + ahead/behind
- Change counts (staged/unstaged/untracked)
- Optional PR URL (if `gh` is authenticated)
- A “Detected state” + “Suggested next state”
- Warnings + suggested commands (advisory)

