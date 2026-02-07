---
title: File Locations
description: Where clauderon stores configuration and data
---

clauderon stores all files under `~/.clauderon/`. This document describes each file and directory.

## Directory Structure

```
~/.clauderon/
├── config.toml              # Main configuration
├── proxy.toml               # Proxy configuration
├── db.sqlite                # Session database
├── proxy-ca.pem             # CA certificate (public)
├── proxy-ca-key.pem         # CA private key
├── claude.json              # Claude Code settings
├── managed-settings.json    # Bypass permissions
├── audit.jsonl              # Proxy audit log
├── secrets/                 # Credential files
│   ├── github_token
│   ├── anthropic_oauth_token
│   └── ...
├── worktrees/               # Git worktrees
│   └── <session-name>/
├── uploads/                 # Uploaded images
│   └── <session-id>/
├── logs/                    # Log files
├── codex/                   # Codex auth
│   └── auth.json
└── talos/                   # Talos kubeconfig
    └── talosconfig
```

## Configuration Files

### config.toml

Main configuration file.

**Location:** `~/.clauderon/config.toml`

**Contents:** Backend defaults, feature flags, hooks

**Created:** On first run with defaults, or manually

See [Configuration Reference](/reference/configuration/) for format.

### proxy.toml

Proxy-specific configuration.

**Location:** `~/.clauderon/proxy.toml`

**Contents:** Credential sources, 1Password settings, audit config

**Created:** Manually when customizing proxy

See [Configuration Reference](/reference/configuration/) for format.

## Database

### db.sqlite

SQLite database storing session state.

**Location:** `~/.clauderon/db.sqlite`

**Contains:**
- Session records
- Session status history
- Chat history references

**Backup:** Copy the file while daemon is stopped

**Reset:** Delete to start fresh (loses all session history)

## Certificates

### proxy-ca.pem

Public CA certificate for TLS interception.

**Location:** `~/.clauderon/proxy-ca.pem`

**Mounted in containers:** Yes, at `/etc/clauderon/proxy-ca.pem`

**Regenerate:** Delete and restart daemon

### proxy-ca-key.pem

Private key for the CA certificate.

**Location:** `~/.clauderon/proxy-ca-key.pem`

**Permissions:** `0600` (owner read/write only)

**Mounted in containers:** **Never** (security critical)

## Claude Code Files

### claude.json

Claude Code onboarding/configuration file.

**Location:** `~/.clauderon/claude.json`

**Mounted in containers:** Yes, at `/workspace/.claude.json`

**Purpose:** Skip Claude Code onboarding prompts

### managed-settings.json

Permission bypass settings for Claude Code.

**Location:** `~/.clauderon/managed-settings.json`

**Purpose:** Pre-approve tool permissions

## Credentials

### secrets/

Directory containing credential files.

**Location:** `~/.clauderon/secrets/`

**Permissions:** Directory `0700`, files `0600`

**Files:**
| File | Service |
|------|---------|
| `github_token` | GitHub API & git |
| `anthropic_oauth_token` | Claude Code |
| `openai_api_key` | Codex |
| `google_api_key` | Gemini |
| `pagerduty_token` | PagerDuty |
| `sentry_auth_token` | Sentry |
| `grafana_api_key` | Grafana |
| `npm_token` | npm |
| `docker_token` | Docker Hub |
| `sprites_api_key` | sprites.dev |
| `k8s_token` | Kubernetes |
| `talos_token` | Talos |

**Never mount in containers:** Security critical

## Session Data

### worktrees/

Git worktrees for sessions.

**Location:** `~/.clauderon/worktrees/<session-name>/`

**Contains:** Checked-out copy of the repository

**Mounted in containers:** Yes, at `/workspace`

**Cleanup:** Deleted when session is deleted

### uploads/

Uploaded images for sessions.

**Location:** `~/.clauderon/uploads/<session-id>/`

**Contains:** Images uploaded to chat

**Mounted in containers:** Yes, at `/workspace/.clauderon/uploads/<session-id>/`

**Cleanup:** Deleted when session is deleted

## Audit Log

### audit.jsonl

JSON Lines log of all proxied requests.

**Location:** `~/.clauderon/audit.jsonl`

**Format:** One JSON object per line

**Rotation:** Not automatic; rotate manually if needed

**Example entry:**
```json
{"timestamp":"2024-01-15T10:30:00Z","session_id":"abc123","method":"GET","path":"/repos/owner/repo","response_code":200}
```

## Logs

### logs/

Application log files.

**Location:** `~/.clauderon/logs/`

**Contents:** Daemon logs, session logs

**Rotation:** Based on configuration

## Agent-Specific

### codex/

Codex authentication data.

**Location:** `~/.clauderon/codex/auth.json`

**Contains:** Codex OAuth tokens

### talos/

Talos cluster configuration.

**Location:** `~/.clauderon/talos/talosconfig`

**Contains:** Talos cluster kubeconfig

## Temporary Files

Temporary files are stored in:

**Location:** System temp directory (`/tmp` or `$TMPDIR`)

**Prefix:** `clauderon-`

**Cleanup:** Automatic on daemon shutdown

## Permissions Summary

| Path | Permissions | Reason |
|------|-------------|--------|
| `~/.clauderon/` | `0755` | Directory access |
| `config.toml` | `0644` | Config readable |
| `proxy.toml` | `0644` | Config readable |
| `proxy-ca-key.pem` | `0600` | Private key |
| `secrets/` | `0700` | Credential directory |
| `secrets/*` | `0600` | Credential files |
| `db.sqlite` | `0644` | Database |

## Backup

To backup clauderon data:

```bash
# Stop daemon first
pkill clauderon

# Backup
tar -czf clauderon-backup.tar.gz \
  ~/.clauderon/config.toml \
  ~/.clauderon/proxy.toml \
  ~/.clauderon/db.sqlite \
  ~/.clauderon/secrets/ \
  ~/.clauderon/claude.json

# Restart daemon
clauderon daemon
```

**Do NOT backup:**
- `proxy-ca-key.pem` (regenerates automatically)
- `worktrees/` (can be recreated)
- `logs/` (optional)

## Reset

To reset clauderon completely:

```bash
# Stop daemon
pkill clauderon

# Remove all data
rm -rf ~/.clauderon

# Start fresh
clauderon daemon
```

## See Also

- [Configuration Reference](/reference/configuration/) - Configuration format
- [Environment Variables](/reference/environment-variables/) - Env vars
- [Installation](/getting-started/installation/) - Initial setup
