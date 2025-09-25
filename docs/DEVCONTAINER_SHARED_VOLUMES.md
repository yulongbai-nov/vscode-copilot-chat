# Dev Container: Shared External Volumes

This repository's dev container can attach to a set of **pre‑provisioned external Docker volumes** that hold developer machine–agnostic assets:

| Purpose | Default External Volume Name | Mount Path (Container) | Notes |
|---------|------------------------------|-------------------------|-------|
| Global Git config & (optional) gitignore | `git_config` | `/opt/shared/git` | Exposes `.gitconfig` used via `GIT_CONFIG_GLOBAL` env. |
| SSH private/public keys & config | `ssh_keys` | `/home/node/.ssh` | Permissions normalized at start; keys not created here. |
| Corporate / internal CA certificates | `corporate_certificates` | `/opt/shared/certs` | Bundle file: `corporate-ca-bundle.pem`. |

The devcontainer **does not create** these volumes. Use the provisioning scripts from the companion automation repository (see below) to create and seed them first.

## Why External Volumes?

* Separation of secrets / trust material from the workspace source tree.
* Reusable across multiple repositories / branches.
* Safe to rebuild containers without re-copying host secrets.
* Enables ephemeral test prefixes (e.g. `smoketest-`) for validation without touching production volumes.

## Provisioning Workflow (Summary)

Run (on host) from the automation repo (example names shown):

PowerShell:
```
./scripts/provision-shared-volumes.ps1 -VolumePrefix dev1
```

Bash:
```
VOLUME_PREFIX=dev1 ./scripts/provision-shared-volumes.sh
```

This will create (if missing) volumes such as `dev1-git_config`, `dev1-ssh_keys`, `dev1-corporate_certificates` (or without prefix if you omit it) and seed them with:

* Git: copy of your host global `.gitconfig` (and optional global ignore) unless `-CreateOnly` specified
* SSH: copies of key files (`id_rsa*`, `id_ed25519*`, `config`, `known_hosts`) with corrected permissions
* Certs: corporate bundle placed at `corporate-ca-bundle.pem`

Use `-CreateOnly` (PowerShell) or `CREATE_ONLY=1` (Bash) to make empty volumes for manual population.

## Selecting Volume Names in This Repo

The compose file references environment variables with fallbacks via the `name:` override approach:

```
volumes:
  git_config:
    external: true
    name: ${GIT_CONFIG_VOLUME_NAME:-git_config}
  ssh_keys:
    external: true
    name: ${SSH_KEYS_VOLUME_NAME:-ssh_keys}
  corporate_certificates:
    external: true
    name: ${CERTS_VOLUME_NAME:-corporate_certificates}
```

To point the dev container at prefixed volumes, create a `.devcontainer/.env` file (copy from `.env.example`) and set, for example:

```
GIT_CONFIG_VOLUME_NAME=dev1-git_config
SSH_KEYS_VOLUME_NAME=dev1-ssh_keys
CERTS_VOLUME_NAME=dev1-corporate_certificates
```

Bring the container up (from `.devcontainer`):
```
docker compose up -d --build
```

## Environment Variables Inside the Container

The compose configuration sets (partial list):

* `GIT_CONFIG_GLOBAL=/opt/shared/git/.gitconfig` (Git reads this global config)
* `SSL_CERT_FILE=/opt/shared/certs/corporate-ca-bundle.pem`
* `NODE_EXTRA_CA_CERTS=/opt/shared/certs/corporate-ca-bundle.pem`
* `REQUESTS_CA_BUNDLE=/opt/shared/certs/corporate-ca-bundle.pem`
* `CURL_CA_BUNDLE=/opt/shared/certs/corporate-ca-bundle.pem`
* `HTTPX_CA_BUNDLE=/opt/shared/certs/corporate-ca-bundle.pem`

This unifies language/runtime trust stores against the shared bundle.

## Validating the Setup

After the container starts:

```
# Git global config present
docker compose exec devcontainer bash -lc 'test -f /opt/shared/git/.gitconfig && echo OK: gitconfig'

# SSH permissions (600 for private keys, 700 directory)
docker compose exec devcontainer bash -lc 'stat -c "%a %n" /home/node/.ssh && ls -l /home/node/.ssh'

# CA bundle readable and used by curl
docker compose exec devcontainer bash -lc 'curl -vI https://your.internal.host 2>&1 | grep -i "SSL connection"'
```

## Conflict Scanning (Optional)

If adapting an existing devcontainer, run the conflict scan script (from automation repo) before merging changes:

```
./scripts/conflict-scan-devcontainer.ps1 -Path <path-to-repo>\vscode-copilot-chat
```

It flags duplicate mounts or environment variable collisions.

## Security Notes

* Keep private keys out of source control—volumes are Docker-managed.
* Ensure host provisioning scripts enforce restrictive permissions (already handled by provided scripts).
* Rotate certificates and keys in the source volumes; containers pick them up on restart.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Container fails: volume not found | External volume not created yet | Run provisioning script first |
| Git ignores not applied | Missing global gitignore file | Add it to git_config volume and restart container |
| SSL errors persist | Bundle not mounted or wrong path | Verify env vars & file presence in `/opt/shared/certs` |
| SSH auth fails | Keys missing or wrong perms | Re-run provisioning or `init-shared.sh` inside container |

## Next Steps / Extensibility

* Add language-specific trust store initialization (e.g., Java `cacerts`) referencing the same bundle.
* Add automated health check script that verifies connectivity to internal Git host using the mounted SSH key.
* Introduce a secrets scanner on volume seeding to prevent accidental inclusion of unrelated files.
