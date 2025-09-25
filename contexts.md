# Project Context - Shared Dev Volumes Enhancements
**Last Updated:** September 25, 2025
**Current Task:** Document Codex CLI companion volume provisioning and update workflow guidance

## Active Todo List (Session Recovery)
- (none) — All work for this documentation update is complete and ready to commit.

## Ranked Entities

### Tier 1 (Critical)
- `copilot-instructions-and-workflows/docs/SHARED_VOLUMES_SETUP.md` — Added Codex CLI companion volume guidance and provisioning steps
- `copilot-instructions-and-workflows/docs/DEVCONTAINER_MERGE_SAFE_SNIPPET.md` — Merge-safe snippet updated with Codex CLI volume mount and env vars
- `copilot-instructions-and-workflows/scripts/provision-codex-cli-volume.sh` — Bash helper to seed Codex CLI Docker volume
- `copilot-instructions-and-workflows/scripts/provision-codex-cli-volume.ps1` — PowerShell companion installer for Codex CLI volume
- `copilot-instructions-and-workflows/.github/copilot-instructions.md` — Environment setup checklist includes shared volume validation and Codex CLI bootstrap scripts
- `copilot-instructions-and-workflows/.github/DEVELOPMENT_WORKFLOW.md` — Environment validation criteria mention Codex CLI shared volume drift

### Tier 2 (Supporting)
- `copilot-instructions-and-workflows/docs/DEVCONTAINER_MERGE_SAFE_SNIPPET.md` — reference for additive compose edits
- `copilot-instructions-and-workflows/docs/SHARED_VOLUMES_SETUP.md` — provisioning guide for all shared dev volumes
- `copilot-instructions-and-workflows/scripts/provision-shared-volumes.sh` / `.ps1` — existing Git/SSH/certs snapshot provisioning scripts

### Tier 3 (Background)
- `.devcontainer/` configs in downstream repos consume these shared volumes
- Docker named volumes: `git_config`, `ssh_keys`, `corporate_certificates`, `copilot_instructions`, `codex_cli`
- Devcontainer environment variables: `PATH`, `GIT_CONFIG_GLOBAL`, `NODE_EXTRA_CA_CERTS`

## Summary
- Codex CLI now ships via a reusable Docker volume with cross-platform provisioning scripts.
- Shared volume docs and merge-safe snippets instruct mounting `/opt/shared/codex` and wiring PATH/`CODEX_CLI_HOME`.
- Workflow instructions remind agents to verify shared volumes (including Codex CLI) during environment validation.

## Next Steps
- Await review/commit of the documentation and script updates.
- No additional follow-up tasks outstanding once the commit lands.
