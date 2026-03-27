---
title: Resource Health & Reconciliation
description: Understanding and managing session health states and automatic recovery
---

## Health States

| State                 | Description                  | Recoverable | Action              |
| --------------------- | ---------------------------- | ----------- | ------------------- |
| **Healthy**           | Running normally             | N/A         | None                |
| **Stopped**           | Container stopped but intact | ✅ Yes      | Start               |
| **Hibernated**        | Suspended to save resources  | ✅ Yes      | Wake                |
| **Pending**           | Creation in progress         | ⏳ Wait     | Wait or cancel      |
| **Error**             | Failed to start/run          | ✅ Yes      | Recreate            |
| **CrashLoop**         | Repeatedly crashing          | ⚠️ Maybe    | Recreate Fresh      |
| **Missing**           | Resource deleted externally  | ✅ Yes      | Recreate            |
| **DeletedExternally** | Removed outside Clauderon    | ✅ Yes      | Recreate or Cleanup |

### State Transitions

```
                    ┌─────────────┐
                    │   Pending   │
                    └──────┬──────┘
                           │
                           ▼
    ┌─────────────────►  Healthy  ◄─────────────┐
    │                     │                      │
    │                     ▼                      │
    │               ┌──────────┐           ┌─────┴────┐
    │               │ Stopped  │           │   Wake   │
    │               └────┬─────┘           └──────────┘
    │                    │                      ▲
    │                    ▼                      │
    │              ┌──────────┐           ┌─────┴────────┐
    └──────────────┤  Start   │           │  Hibernated  │
                   └──────────┘           └──────────────┘

         Error/Missing/CrashLoop
                   │
                   ▼
            ┌──────────────┐
            │  Recreate    │────► Healthy
            │ (or Cleanup) │
            └──────────────┘
```

### Backend Mappings

| State   | Docker                           | Zellij            |
| ------- | -------------------------------- | ----------------- |
| Healthy | Container running                | Session active    |
| Stopped | Container exists but not running | -                 |
| Missing | Container deleted                | Session not found |
| Error   | Container exited with error      | Process exited    |

## Available Actions by State

| State      | Start | Wake | Recreate | Recreate Fresh | Cleanup |
| ---------- | :---: | :--: | :------: | :------------: | :-----: |
| Healthy    |       |      |    ✅    |                |   ✅    |
| Stopped    |  ✅   |      |    ✅    |                |   ✅    |
| Hibernated |       |  ✅  |    ✅    |                |   ✅    |
| Error      |       |      |    ✅    |       ✅       |   ✅    |
| CrashLoop  |       |      |          |       ✅       |   ✅    |
| Missing    |       |      |    ✅    |       ✅       |   ✅    |

## Data Preservation

| Action         |     Git state     | Uncommitted changes  | Chat history | Config |
| -------------- | :---------------: | :------------------: | :----------: | :----: |
| Start / Wake   |        ✅         |          ✅          |      ✅      |   ✅   |
| Recreate       |        ✅         | ✅ (if clone exists) |      ✅      |   ✅   |
| Recreate Fresh | ✅ committed only |          ❌          |      ✅      |   ✅   |
| Cleanup        |        ❌         |          ❌          |      ❌      |   ❌   |

## Reconciliation

Automatically recovers sessions from failures using exponential backoff (30s, 2m, 5m). Stops after 3 failed attempts.

### Triggers

- On daemon startup (flag: `reconcile_on_startup`)
- After backend errors
- Manual: `clauderon reconcile [session-name]`

### Strategy by State

| State             | Action                             |
| ----------------- | ---------------------------------- |
| Error             | Attempt recreate                   |
| Missing           | Attempt recreate (if clone exists) |
| CrashLoop         | Wait, then recreate fresh          |
| DeletedExternally | Mark missing, attempt recreate     |
| Stopped           | No action (intentional)            |
| Hibernated        | No action (intentional)            |

## Recovery Commands

```bash
# CLI
clauderon start <session>
clauderon wake <session>
clauderon recreate <session>
clauderon recreate <session> --fresh
clauderon cleanup <session>
clauderon delete <session>

# API
POST /api/sessions/{id}/start
POST /api/sessions/{id}/wake
POST /api/sessions/{id}/recreate
POST /api/sessions/{id}/recreate-fresh
POST /api/sessions/{id}/cleanup
```

**TUI:** Press `h` on session for health modal with available actions.

## Configuration

```toml
# ~/.config/clauderon/config.toml
[feature_flags]
reconcile_on_startup = true

[reconciliation]
initial_delay = 30
backoff_multiplier = 2.0
max_attempts = 3
max_delay = 300

[health]
check_interval = 60
check_timeout = 10
background_checks = false
```

## Troubleshooting

| Problem                 | Diagnosis                                               | Solution                                                               |
| ----------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Fails after 3 attempts  | `clauderon inspect <session>`                           | `clauderon recreate --fresh` or cleanup + recreate                     |
| Always returns to error | Check `docker logs <id>` and `clauderon logs <session>` | Fix backend issue (disk, permissions); recreate with different backend |
| Orphaned resources      | `docker ps` shows container but Clauderon doesn't       | `docker stop/rm <id>` then `clauderon cleanup`                         |
| External deletion       | Shows "DeletedExternally"                               | `clauderon recreate` or `clauderon cleanup`                            |
