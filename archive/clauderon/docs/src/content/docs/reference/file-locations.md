---
title: File Locations
description: Where clauderon stores configuration and data
---

## Directory Structure

```
~/.clauderon/
├── config.toml              # Main configuration
├── db.sqlite                # Session database
├── claude.json              # Claude Code settings (mounted at /workspace/.claude.json)
├── managed-settings.json    # Permission bypass settings
├── worktrees/               # Git worktrees (mounted at /workspace)
│   └── <session-name>/
├── uploads/                 # Uploaded images
│   └── <session-id>/
├── logs/                    # Application logs
└── codex/                   # Codex auth
    └── auth.json
```

## Permissions

| Path            | Permissions | Reason           |
| --------------- | ----------- | ---------------- |
| `~/.clauderon/` | `0755`      | Directory access |
| `config.toml`   | `0644`      | Readable config  |
| `db.sqlite`     | `0644`      | Database         |

## Database (db.sqlite)

- **Backup:** Copy while daemon is stopped
- **Reset:** Delete to start fresh (loses session history)

## Temporary Files

Location: `$TMPDIR` or `/tmp`, prefix `clauderon-`. Cleaned on daemon shutdown.

## Backup

```bash
pkill clauderon
tar -czf clauderon-backup.tar.gz \
  ~/.clauderon/config.toml \
  ~/.clauderon/db.sqlite \
  ~/.clauderon/claude.json
clauderon daemon
```

Skip: `worktrees/` (recreatable), `logs/`.

## Reset

```bash
pkill clauderon
rm -rf ~/.clauderon
clauderon daemon
```
