---
title: Resource Health & Reconciliation
description: Understanding and managing session health states and automatic recovery
---

Clauderon continuously monitors the health of your sessions and can automatically recover from failures. This guide explains health states, reconciliation, and recovery workflows.

## Health States

Every session has a health state representing the status of its backend resources (containers, pods, processes).

### State Definitions

| State                 | Description                         | Recoverable | User Action         |
| --------------------- | ----------------------------------- | ----------- | ------------------- |
| **Healthy**           | Session running normally            | N/A         | None needed         |
| **Stopped**           | Container stopped but intact        | ✅ Yes      | Start               |
| **Hibernated**        | Session suspended to save resources | ✅ Yes      | Wake                |
| **Pending**           | Resource creation in progress       | ⏳ Wait     | Wait or cancel      |
| **Error**             | Container failed to start/run       | ✅ Yes      | Recreate            |
| **CrashLoop**         | Container repeatedly crashing (K8s) | ⚠️ Maybe    | Recreate Fresh      |
| **Missing**           | Resource deleted externally         | ✅ Yes      | Recreate            |
| **DeletedExternally** | Resource removed outside Clauderon  | ✅ Yes      | Recreate or Cleanup |

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

### Backend-Specific Mappings

Different backends report health differently:

**Docker:**

- **Healthy** - Container running
- **Stopped** - Container exists but not running
- **Missing** - Container deleted
- **Error** - Container exited with error

**Kubernetes:**

- **Healthy** - Pod running and ready
- **Pending** - Pod scheduled but not yet running
- **CrashLoop** - Pod in CrashLoopBackOff state
- **Error** - Pod failed or ImagePullBackOff
- **Missing** - Pod/deployment deleted

**Zellij:**

- **Healthy** - Zellij session active
- **Missing** - Zellij session not found
- **Error** - Zellij process exited

**Sprites:**

- **Healthy** - Container running
- **Hibernated** - Container suspended
- **Error** - Container failed
- **Missing** - Container not found on sprites.dev

**Apple Container:**

- **Healthy** - Container running
- **Stopped** - Container stopped
- **Error** - Container failed
- **Missing** - Container deleted

## Health Checking

### Automatic Health Checks

Clauderon automatically checks session health:

- **On access** - When you attach, view, or interact with session
- **Periodic** - Background health checks (configurable interval)
- **On reconciliation** - During reconciliation attempts

### Manual Health Check

Check session health via API:

```bash
GET /api/sessions/{id}/health
```

**Response:**

```json
{
  "session_id": "abc123",
  "health": "Error",
  "details": {
    "container_status": "exited",
    "exit_code": 1,
    "error_message": "OCI runtime error"
  },
  "available_actions": ["recreate", "recreate_fresh", "cleanup"],
  "data_preservation": {
    "recreate": true,
    "recreate_fresh": false,
    "cleanup": false
  },
  "last_check": "2025-01-28T12:34:56Z"
}
```

### Health in User Interfaces

**Web UI:**

- Health badge on session card
- Detailed health view in session detail page
- Action buttons based on available actions

**TUI:**

- Color-coded session list (green=healthy, yellow=stopped, red=error)
- Press `h` on session to show health modal
- Health modal shows state, actions, and data preservation

**CLI:**

```bash
# View session status (includes health)
clauderon status <session-name>

# Detailed health info
clauderon inspect <session-name>
```

## Available Actions by State

Actions you can take depend on the current health state:

### Healthy State

| Action       | Effect               | Preserves Data |
| ------------ | -------------------- | -------------- |
| **Recreate** | Rebuild container    | ✅ Yes         |
| **Cleanup**  | Delete all resources | ❌ No          |

**Use case:** Force rebuild without stopping first

### Stopped State

| Action       | Effect                   | Preserves Data |
| ------------ | ------------------------ | -------------- |
| **Start**    | Start existing container | ✅ Yes         |
| **Recreate** | Rebuild container        | ✅ Yes         |
| **Cleanup**  | Delete all resources     | ❌ No          |

**Use case:** Resume stopped session or rebuild if needed

### Hibernated State

| Action       | Effect                  | Preserves Data |
| ------------ | ----------------------- | -------------- |
| **Wake**     | Resume from hibernation | ✅ Yes         |
| **Recreate** | Rebuild container       | ✅ Yes         |
| **Cleanup**  | Delete all resources    | ❌ No          |

**Use case:** Wake to continue working or rebuild if corrupted

### Error State

| Action             | Effect                      | Preserves Data               |
| ------------------ | --------------------------- | ---------------------------- |
| **Recreate**       | Rebuild with existing clone | ✅ Yes (uncommitted changes) |
| **Recreate Fresh** | Rebuild with fresh clone    | ⚠️ Partial (committed only)  |
| **Cleanup**        | Delete all resources        | ❌ No                        |

**Use case:** Fix broken container while preserving work

### CrashLoop State

| Action             | Effect                   | Preserves Data              |
| ------------------ | ------------------------ | --------------------------- |
| **Recreate Fresh** | Rebuild with fresh clone | ⚠️ Partial (committed only) |
| **Cleanup**        | Delete all resources     | ❌ No                       |

**Use case:** Container won't start - fresh rebuild likely needed

### Missing State

| Action             | Effect                      | Preserves Data              |
| ------------------ | --------------------------- | --------------------------- |
| **Recreate**       | Rebuild with existing clone | ✅ Yes (if clone exists)    |
| **Recreate Fresh** | Rebuild with fresh clone    | ⚠️ Partial (committed only) |
| **Cleanup**        | Delete all resources        | ❌ No                       |

**Use case:** Container deleted externally - recreate from database state

## Data Preservation

Understanding what each action preserves:

### Preserves Everything (✅)

**Actions:** Start, Wake, Recreate (if git clone exists)

**Preserved:**

- Session chat history and metadata
- Git repository state (committed and uncommitted)
- Container filesystem (if recreating from existing clone)
- Environment variables and configuration

**Lost:**

- Running processes (must restart)
- In-memory state

### Preserves Committed Changes Only (⚠️)

**Actions:** Recreate Fresh

**Preserved:**

- Session chat history and metadata
- Git repository committed changes
- Configuration and settings

**Lost:**

- Uncommitted changes (git working directory)
- Untracked files
- Container filesystem state

### Destroys Everything (❌)

**Actions:** Cleanup

**Destroyed:**

- Session record in database
- All git repository data
- All container resources
- Chat history and metadata

**Irreversible!** Only use when you're sure.

## Reconciliation System

Reconciliation automatically recovers sessions from failures.

### What Reconciliation Does

Reconciliation attempts to:

1. **Detect failures** - Check for error states
2. **Determine cause** - Analyze why resource failed
3. **Apply fix** - Recreate, restart, or clean up
4. **Verify recovery** - Confirm session is healthy again

### Reconciliation Triggers

**Automatic (if enabled):**

- On Clauderon startup (feature flag: `reconcile_on_startup`)
- After backend errors during operations
- Periodic background reconciliation (future feature)

**Manual:**

```bash
clauderon reconcile [session-name]
```

Reconciles all sessions or specific session.

### Reconciliation Attempts

Reconciliation uses exponential backoff:

| Attempt | Delay                  | Total Time |
| ------- | ---------------------- | ---------- |
| 1       | 30 seconds             | 30s        |
| 2       | 2 minutes              | 2m 30s     |
| 3       | 5 minutes              | 7m 30s     |
| **Max** | Stops after 3 attempts | -          |

**After 3 failures**, reconciliation stops and session remains in error state. Manual intervention required.

### Reconciliation Tracking

Each session tracks reconciliation status:

```sql
-- In database
reconciliation_attempts: 2
last_reconciliation_at: "2025-01-28T12:30:00Z"
reconciliation_error: "OCI runtime create failed"
```

View via API:

```bash
GET /api/sessions/{id}
```

```json
{
  "reconciliation": {
    "attempts": 2,
    "last_attempt": "2025-01-28T12:30:00Z",
    "next_attempt": "2025-01-28T12:35:00Z",
    "error": "OCI runtime create failed"
  }
}
```

### Reconciliation Strategies by State

| State             | Reconciliation Action                |
| ----------------- | ------------------------------------ |
| Error             | Attempt recreate                     |
| Missing           | Attempt recreate (if clone exists)   |
| CrashLoop         | Wait, then attempt recreate fresh    |
| DeletedExternally | Mark as missing, attempt recreate    |
| Stopped           | Do nothing (intentional stop)        |
| Hibernated        | Do nothing (intentional hibernation) |

## Recovery Workflows

### Via TUI

1. **View Health**
   - Navigate to session in TUI
   - Press `h` to show health modal

2. **Choose Action**
   - Health modal shows available actions
   - Select action with arrow keys
   - Press Enter to confirm

3. **Confirm Data Impact**
   - TUI shows data preservation indicator
   - ✅ Green = preserves data
   - ⚠️ Yellow = partial preservation
   - ❌ Red = destructive

4. **Execute**
   - Action executes immediately
   - TUI shows progress
   - Session state updates when complete

### Via Web UI

1. **Open Session**
   - Click on session in session list
   - Session detail page opens

2. **View Health Status**
   - Health badge shows current state
   - "Actions" dropdown shows available actions

3. **Select Action**
   - Click action (Start, Wake, Recreate, etc.)
   - Confirmation dialog appears

4. **Confirm**
   - Dialog shows data preservation info
   - Click "Confirm" to proceed

5. **Monitor Progress**
   - Progress indicator shows recovery status
   - Page refreshes when complete

### Via CLI

**Start stopped session:**

```bash
clauderon start <session-name>
```

**Wake hibernated session:**

```bash
clauderon wake <session-name>
```

**Recreate failed session:**

```bash
clauderon recreate <session-name>
# or for fresh rebuild
clauderon recreate <session-name> --fresh
```

**Cleanup session:**

```bash
clauderon cleanup <session-name>
# or delete entirely
clauderon delete <session-name>
```

### Via API

**Start:**

```bash
POST /api/sessions/{id}/start
```

**Wake:**

```bash
POST /api/sessions/{id}/wake
```

**Recreate:**

```bash
POST /api/sessions/{id}/recreate
```

**Recreate Fresh:**

```bash
POST /api/sessions/{id}/recreate-fresh
```

**Cleanup:**

```bash
POST /api/sessions/{id}/cleanup
```

## Crash Loop Detection

Specific to Kubernetes backend.

### What is CrashLoop?

Kubernetes puts pods in `CrashLoopBackOff` when they repeatedly fail to start:

- Container exits immediately after starting
- Kubernetes tries to restart
- Container fails again
- Backoff delay increases each time

### Common Causes

1. **Invalid container image** - Image doesn't exist or is corrupted
2. **Missing dependencies** - Required libraries not in image
3. **Configuration errors** - Invalid environment variables or config
4. **Resource limits** - Not enough CPU/memory to start
5. **Command errors** - Entrypoint or command fails

### Detection

Clauderon detects CrashLoop by:

- Checking pod status for `CrashLoopBackOff`
- Monitoring container restart count
- Analyzing pod events

### Recovery

**Automatic reconciliation:**

1. Waits for backoff period
2. Attempts recreate fresh (resets restart count)

**Manual recovery:**

```bash
# Recreate with fresh clone
clauderon recreate <session-name> --fresh

# Or cleanup and start over
clauderon cleanup <session-name>
clauderon create <session-name> --backend kubernetes
```

### Container Restart Policies

Clauderon uses these restart policies:

| Backend         | Restart Policy   | Notes                                |
| --------------- | ---------------- | ------------------------------------ |
| Docker          | `unless-stopped` | Restarts unless manually stopped     |
| Kubernetes      | `Always`         | Always restarts, may enter CrashLoop |
| Zellij          | N/A              | No restart (process management)      |
| Sprites         | Automatic        | sprites.dev manages restarts         |
| Apple Container | `unless-stopped` | Similar to Docker                    |

## Troubleshooting

### Reconciliation Failures

**Problem:** Session fails to reconcile after 3 attempts

**Diagnosis:**

```bash
# Check reconciliation status
clauderon inspect <session-name>

# View reconciliation errors
# (in database or via API)
```

**Common causes:**

- Backend resource limits reached (Docker/K8s)
- Network issues (Sprites)
- Corrupted git clone
- Invalid configuration

**Solutions:**

```bash
# Try manual recreate fresh
clauderon recreate <session-name> --fresh

# Or cleanup and recreate from scratch
clauderon cleanup <session-name>
clauderon create <session-name>
```

### Persistent Health Errors

**Problem:** Session always returns to error state

**Diagnosis:**

1. Check backend logs:

   ```bash
   # Docker
   docker logs <container-id>

   # Kubernetes
   kubectl logs <pod-name>
   ```

2. Check session logs:

   ```bash
   clauderon logs <session-name>
   ```

3. Inspect session configuration:
   ```bash
   clauderon inspect <session-name>
   ```

**Solutions:**

- Fix underlying backend issue (disk space, permissions, etc.)
- Update session configuration (resource limits, image, etc.)
- Recreate with different backend

### Orphaned Resources

**Problem:** Backend resources exist but Clauderon lost track

**Symptoms:**

- Session shows as "Missing" but container still running
- `docker ps` shows container, but Clauderon doesn't see it
- Resources consuming resources but not accessible

**Solutions:**

```bash
# Cleanup orphaned resources manually
docker stop <container-id>
docker rm <container-id>

# Or use backend-specific cleanup
kubectl delete pod <pod-name>

# Then cleanup in Clauderon
clauderon cleanup <session-name>
```

### External Deletion

**Problem:** Someone deleted container/pod outside Clauderon

**Detection:**

- Session shows "DeletedExternally" state
- Health check fails with "not found"

**Recovery:**

```bash
# Recreate from database state
clauderon recreate <session-name>

# Or cleanup and start fresh
clauderon cleanup <session-name>
```

### Slow Reconciliation

**Problem:** Reconciliation takes too long

**Causes:**

- Large git repository (slow to clone)
- Slow container image pull
- Backend resource contention
- Network latency (Sprites)

**Solutions:**

- Use local backends for faster recovery
- Pre-pull container images
- Increase backend resources
- Use smaller repositories when possible

## Configuration

### Reconciliation Settings

```toml
# ~/.config/clauderon/config.toml

[features]
# Enable reconciliation on startup
reconcile_on_startup = true

[reconciliation]
# First retry delay (seconds)
initial_delay = 30

# Backoff multiplier
backoff_multiplier = 2.0

# Maximum attempts
max_attempts = 3

# Maximum delay (seconds)
max_delay = 300
```

### Health Check Settings

```toml
[health]
# Health check interval (seconds)
check_interval = 60

# Timeout for health checks (seconds)
check_timeout = 10

# Enable background health checks
background_checks = false
```

## Best Practices

1. **Monitor health** - Regularly check session health in TUI/Web UI
2. **Enable reconciliation** - Set `reconcile_on_startup = true` for automatic recovery
3. **Understand data preservation** - Know what each action preserves before executing
4. **Start small** - Try "Start" or "Wake" before "Recreate"
5. **Commit work** - Commit changes before risky operations
6. **Check logs** - Always check logs before recreating
7. **Cleanup promptly** - Remove failed sessions you won't recover
8. **Use fresh carefully** - "Recreate Fresh" loses uncommitted work
9. **Test recovery** - Practice recovery workflows before you need them
10. **Document issues** - Note error messages for troubleshooting

## See Also

- [Docker Backend](/guides/docker/) - Docker-specific health checks
- [Kubernetes Backend](/guides/kubernetes/) - K8s crash loop detection
- [Sprites Backend](/guides/sprites/) - Hibernation and wake
- [API Reference](/reference/api/) - Health and recovery endpoints
- [Troubleshooting](/guides/troubleshooting/) - General troubleshooting guide
