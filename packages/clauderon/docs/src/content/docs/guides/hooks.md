---
title: Hooks
description: Execute custom commands on session lifecycle events
---

Hooks let you run custom commands when session events occur, enabling integration with external tools and workflows.

## Configuration

Configure hooks in `~/.clauderon/config.toml`:

```toml
[hooks]
on_create = "notify-send 'clauderon' 'Session created: $SESSION_NAME'"
on_delete = "/usr/local/bin/cleanup.sh $SESSION_NAME"
on_start = "logger -t clauderon 'Session started: $SESSION_NAME'"
on_stop = "logger -t clauderon 'Session stopped: $SESSION_NAME'"
```

## Hook Types

### on_create

Runs after a session is created.

```toml
[hooks]
on_create = "echo 'Created: $SESSION_NAME' >> ~/clauderon-events.log"
```

Use cases:
- Logging session creation
- Sending notifications
- Creating associated resources

### on_delete

Runs before a session is deleted.

```toml
[hooks]
on_delete = "/usr/local/bin/archive-session.sh $SESSION_NAME"
```

Use cases:
- Archiving session data
- Cleaning up external resources
- Final logging

### on_start

Runs when a session starts running.

```toml
[hooks]
on_start = "curl -X POST https://slack.webhook.url -d '{\"text\": \"Session started: $SESSION_NAME\"}'"
```

Use cases:
- Notifications
- Starting related services
- Metrics tracking

### on_stop

Runs when a session stops.

```toml
[hooks]
on_stop = "curl -X POST https://slack.webhook.url -d '{\"text\": \"Session stopped: $SESSION_NAME\"}'"
```

Use cases:
- Notifications
- Stopping related services
- Cleanup tasks

## Environment Variables

Hooks receive these environment variables:

| Variable | Description |
|----------|-------------|
| `SESSION_NAME` | Name of the session |
| `SESSION_ID` | Unique session ID |
| `BACKEND` | Backend type (zellij, docker, etc.) |
| `AGENT` | Agent type (claude, codex, gemini) |
| `ACCESS_MODE` | Access mode (read-only, read-write) |
| `REPO_PATH` | Path to the git repository |
| `WORKTREE_PATH` | Path to the worktree |

## Examples

### Desktop Notifications

```toml
[hooks]
# macOS
on_create = "osascript -e 'display notification \"Session $SESSION_NAME created\" with title \"clauderon\"'"

# Linux (notify-send)
on_create = "notify-send 'clauderon' 'Session created: $SESSION_NAME'"
```

### Logging to File

```toml
[hooks]
on_create = "echo \"$(date -Iseconds) CREATE $SESSION_NAME\" >> ~/.clauderon/events.log"
on_delete = "echo \"$(date -Iseconds) DELETE $SESSION_NAME\" >> ~/.clauderon/events.log"
on_start = "echo \"$(date -Iseconds) START $SESSION_NAME\" >> ~/.clauderon/events.log"
on_stop = "echo \"$(date -Iseconds) STOP $SESSION_NAME\" >> ~/.clauderon/events.log"
```

### Slack Notifications

```toml
[hooks]
on_create = '''
curl -X POST https://hooks.slack.com/services/YOUR/WEBHOOK/URL \
  -H 'Content-Type: application/json' \
  -d "{\"text\": \"New clauderon session: $SESSION_NAME ($BACKEND/$AGENT)\"}"
'''
```

### System Logger

```toml
[hooks]
on_create = "logger -t clauderon -p user.info 'Session created: $SESSION_NAME'"
on_delete = "logger -t clauderon -p user.info 'Session deleted: $SESSION_NAME'"
```

### Custom Cleanup Script

Create `/usr/local/bin/clauderon-cleanup.sh`:

```bash
#!/bin/bash
SESSION_NAME="$1"

# Archive worktree before deletion
tar -czf "$HOME/archives/$SESSION_NAME.tar.gz" "$WORKTREE_PATH"

# Clean up Docker volumes
docker volume rm "clauderon-$SESSION_NAME-data" 2>/dev/null || true

# Remove from tracking system
curl -X DELETE "https://api.internal/sessions/$SESSION_ID"
```

Configure:

```toml
[hooks]
on_delete = "/usr/local/bin/clauderon-cleanup.sh $SESSION_NAME"
```

### Metrics with Prometheus Pushgateway

```toml
[hooks]
on_create = '''
curl -X POST "http://pushgateway:9091/metrics/job/clauderon/instance/$SESSION_NAME" \
  --data-binary "clauderon_session_created{backend=\"$BACKEND\",agent=\"$AGENT\"} 1"
'''

on_delete = '''
curl -X DELETE "http://pushgateway:9091/metrics/job/clauderon/instance/$SESSION_NAME"
'''
```

### Git Operations

```toml
[hooks]
# Fetch latest before session starts
on_start = "cd $WORKTREE_PATH && git fetch origin"

# Push changes after session stops
on_stop = "cd $WORKTREE_PATH && git push origin HEAD 2>/dev/null || true"
```

## Multi-Command Hooks

Use shell scripts or command chaining:

```toml
[hooks]
# Using && for sequential execution
on_create = "echo 'Creating...' && notify-send 'clauderon' 'Session: $SESSION_NAME'"

# Using script file
on_create = "/usr/local/bin/on-session-create.sh"
```

## Error Handling

Hook failures don't prevent the session operation from completing. Check logs for hook errors:

```bash
# Filter clauderon logs for hook errors
journalctl -u clauderon | grep -i hook
```

## Async Hooks

For long-running hooks, run them in the background:

```toml
[hooks]
# Background execution
on_create = "/usr/local/bin/slow-task.sh $SESSION_NAME &"
```

## Security Considerations

### Command Injection

Hook commands are executed with your user's permissions. Avoid using untrusted input in hooks.

### Credential Exposure

Hooks run outside the proxy. Don't pass credentials through environment variables in hooks.

### Script Permissions

Ensure hook scripts have appropriate permissions:

```bash
chmod 755 /usr/local/bin/clauderon-*.sh
```

## Debugging Hooks

Test hooks manually:

```bash
# Simulate on_create
SESSION_NAME="test" BACKEND="docker" AGENT="claude" \
  /usr/local/bin/on-session-create.sh
```

Enable verbose logging:

```bash
RUST_LOG=clauderon=debug clauderon daemon
```

## See Also

- [Configuration Reference](/reference/configuration/) - All configuration options
- [CLI Reference](/reference/cli/) - Command documentation
