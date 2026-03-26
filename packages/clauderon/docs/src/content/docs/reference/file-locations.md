---
title: File Locations
description: Where clauderon stores configuration and data
---

## Directory Structure

```
~/.clauderon/
├── config.toml              # Main configuration
├── proxy.toml               # Proxy configuration
├── db.sqlite                # Session database
├── proxy-ca.pem             # CA certificate (public, mounted in containers)
├── proxy-ca-key.pem         # CA private key (NEVER mounted in containers)
├── claude.json              # Claude Code settings (mounted at /workspace/.claude.json)
├── managed-settings.json    # Permission bypass settings
├── audit.jsonl              # Proxy audit log (JSONL, one entry per request)
├── secrets/                 # Credential files (0700 dir, 0600 files)
│   ├── github_token
│   ├── anthropic_oauth_token
│   └── ...
├── worktrees/               # Git worktrees (mounted at /workspace)
│   └── <session-name>/
├── uploads/                 # Uploaded images
│   └── <session-id>/
├── logs/                    # Application logs
├── codex/                   # Codex auth
│   └── auth.json
└── talos/                   # Talos kubeconfig
    └── talosconfig
```

## Credential Files

| File                    | Service          |
| ----------------------- | ---------------- |
| `github_token`          | GitHub API & git |
| `anthropic_oauth_token` | Claude Code      |
| `openai_api_key`        | Codex            |
| `google_api_key`        | Gemini           |
| `pagerduty_token`       | PagerDuty        |
| `sentry_auth_token`     | Sentry           |
| `grafana_api_key`       | Grafana          |
| `npm_token`             | npm              |
| `docker_token`          | Docker Hub       |
| `talos_token`           | Talos            |

Never mounted in containers -- the proxy injects credentials.

## Permissions

| Path               | Permissions | Reason           |
| ------------------ | ----------- | ---------------- |
| `~/.clauderon/`    | `0755`      | Directory access |
| `config.toml`      | `0644`      | Readable config  |
| `proxy-ca-key.pem` | `0600`      | Private key      |
| `secrets/`         | `0700`      | Credentials dir  |
| `secrets/*`        | `0600`      | Credential files |
| `db.sqlite`        | `0644`      | Database         |

## Database (db.sqlite)

- **Backup:** Copy while daemon is stopped
- **Reset:** Delete to start fresh (loses session history)
- **Regenerate CA:** Delete `proxy-ca*.pem` and restart daemon

## Audit Log (audit.jsonl)

```json
{"timestamp": "2024-01-15T10:30:00Z", "session_id": "abc123", "method": "GET", "path": "/repos/owner/repo", "response_code": 200}
```

No automatic rotation; rotate manually.

## Temporary Files

Location: `$TMPDIR` or `/tmp`, prefix `clauderon-`. Cleaned on daemon shutdown.

## Backup

```bash
pkill clauderon
tar -czf clauderon-backup.tar.gz \
  ~/.clauderon/config.toml \
  ~/.clauderon/proxy.toml \
  ~/.clauderon/db.sqlite \
  ~/.clauderon/secrets/ \
  ~/.clauderon/claude.json
clauderon daemon
```

Skip: `proxy-ca-key.pem` (regenerates), `worktrees/` (recreatable), `logs/`.

## Reset

```bash
pkill clauderon
rm -rf ~/.clauderon
clauderon daemon
```
