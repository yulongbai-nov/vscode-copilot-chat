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

## Observed state transitions

Workflow Coach is **stateless**: each run recomputes `detectedState` from the current `git`/`gh` snapshot. This diagram shows the *observed* states and the repo actions that typically move you between them.

```mermaid
stateDiagram-v2
  direction LR

  %% Observed states (computed each run).
  %% Priority (from the evaluator): dirty-main > mixed-scope > staged-changes > working-tree-dirty > unpushed-commits > clean

  state "MAIN branch" as MAIN {
    direction LR

    state "main clean\n(detectedState=clean)\n(suggestedNextState: none)" as MainClean
    state "main dirty\n(detectedState=dirty-main)\n(suggestedNextState: topic branch)" as MainDirty

    [*] --> MainClean
    MainClean --> MainDirty: main AND (workingChanges OR ahead>0)
    MainDirty --> MainClean: main AND (no workingChanges) AND (ahead==0)
  }

  state "TOPIC branch (not main)" as TOPIC {
    direction LR

    state "clean\n(detectedState=clean)\n(suggestedNextState: none or open PR)" as TopicClean
    state "mixed scopes\n(detectedState=mixed-scope)\n(suggestedNextState: split scopes)" as TopicMixed
    state "staged changes\n(detectedState=staged-changes)\n(suggestedNextState: verify + commit)" as TopicStaged
    state "unstaged/untracked\n(detectedState=working-tree-dirty)\n(suggestedNextState: stage or revert/stash)" as TopicDirty
    state "unpushed commits\n(detectedState=unpushed-commits)\n(suggestedNextState: push)" as TopicUnpushed

    [*] --> TopicClean

    %% Typical repo actions => observed-state transitions
    TopicClean --> TopicDirty: edit files (unstaged/untracked appear)
    TopicDirty --> TopicStaged: git add (staged appears)
    TopicStaged --> TopicDirty: git reset (unstage; still dirty)
    TopicDirty --> TopicClean: restore/clean/stash (no local changes)

    TopicStaged --> TopicUnpushed: git commit (clean tree; ahead>0)
    TopicUnpushed --> TopicClean: git push (ahead==0)

    %% Mixed-scope warning can appear from any "workingChanges" state (topic branch)
    TopicDirty --> TopicMixed: workingChanges AND scopeBuckets>=2
    TopicStaged --> TopicMixed: workingChanges AND scopeBuckets>=2
    TopicMixed --> TopicStaged: split to 1 bucket AND stage
    TopicMixed --> TopicDirty: split to 1 bucket (still dirty)
    TopicMixed --> TopicClean: stash/split until clean
  }

  %% Branch switches move between the composites
  MAIN --> TOPIC: git checkout -b feature/scope
  TOPIC --> MAIN: git checkout main

  note right of TOPIC
    Secondary signals (do NOT change detectedState):
    - behind upstream => warning "behind-upstream"
    - authenticated but no PR => nextAction "open-pr" (can affect suggestedNextState)
    - query/type inference => nextAction "branch-format"
  end note
```
