---
title: Quick Start
description: Create your first clauderon session in minutes
---

This guide will walk you through creating your first clauderon session.

## 1. Start the Daemon

clauderon requires a background daemon for session management:

```bash
clauderon daemon
```

The daemon starts:
- HTTP server at http://localhost:3030
- Credential proxy for secure token injection
- Session lifecycle management

Keep this terminal running, or run the daemon in the background.

## 2. Create a Session

### Via CLI

```bash
clauderon create --repo ~/my-project --prompt "Fix the login bug"
```

Required flags:
- `--repo` - Path to your git repository
- `--prompt` - Initial task for the AI agent

Optional flags:
- `--backend` - zellij (default), docker, kubernetes, sprites, apple
- `--agent` - claude (default), codex, gemini
- `--access-mode` - read-write (default), read-only

### Via Web UI

1. Open http://localhost:3030
2. Click "New Session"
3. Select repository and enter prompt
4. Choose backend and agent

### Via TUI

```bash
clauderon tui
```

Press `n` to create a new session interactively.

![TUI Create Dialog](~/assets/screenshots/tui/create-dialog.png)

**Keyboard shortcuts:**
- `n` - Create new session
- `Enter` - Attach to session
- `a` - Archive session
- `d` - Delete session
- `j/k` - Navigate up/down
- `?` - Show help
- `q` - Quit

![TUI Help Screen](~/assets/screenshots/tui/help-screen.png)

## 3. Configure Credentials

Credentials are stored in `~/.clauderon/secrets/`:

```bash
mkdir -p ~/.clauderon/secrets
echo "your-github-token" > ~/.clauderon/secrets/github_token
echo "your-anthropic-token" > ~/.clauderon/secrets/anthropic_oauth_token
chmod 600 ~/.clauderon/secrets/*
```

Or use 1Password for automatic credential injection (see [1Password Guide](/guides/onepassword/)).

### Supported Credentials

| Credential | File Name |
|------------|-----------|
| GitHub | `github_token` |
| Anthropic OAuth | `anthropic_oauth_token` |
| OpenAI/Codex | `openai_api_key` |
| PagerDuty | `pagerduty_token` |
| Sentry | `sentry_auth_token` |
| Grafana | `grafana_api_key` |
| npm | `npm_token` |

## 4. Session Lifecycle

```bash
# List sessions
clauderon list

# List including archived
clauderon list --archived

# Attach to session terminal
clauderon attach <session-name>

# Archive (hide but preserve)
clauderon archive <session-name>

# Restore archived session
clauderon unarchive <session-name>

# Delete permanently
clauderon delete <session-name>
```

![Session List Output](~/assets/screenshots/cli/clauderon-list.svg)

![TUI Session List](~/assets/screenshots/tui/session-list.png)

When you delete a session, you'll see a confirmation dialog:

![TUI Delete Confirmation](~/assets/screenshots/tui/delete-confirmation.png)

If you don't have any sessions yet, you'll see an empty state:

![TUI Empty Session List](~/assets/screenshots/tui/empty-session-list.png)

## Example Workflows

### Bug Fix Session

```bash
# Start a session to fix a specific bug
clauderon create \
  --repo ~/my-project \
  --prompt "Fix the authentication timeout bug in the login handler"
```

### Code Review Session (Read-Only)

```bash
# Create a read-only session for safe code exploration
clauderon create \
  --access-mode read-only \
  --repo ~/my-project \
  --prompt "Review the recent changes to the payment module"
```

### Docker-Isolated Session

```bash
# Use Docker for full isolation
clauderon create \
  --backend docker \
  --repo ~/my-project \
  --prompt "Refactor the database layer"
```

## Next Steps

- [Choose a Backend](/getting-started/backends/) - Compare isolation options
- [Choose an Agent](/getting-started/agents/) - Compare AI agents
- [Configure 1Password](/guides/onepassword/) - Secure credential management
- [Web Interface Guide](/guides/web-ui/) - Browser-based session management
- [CLI Reference](/reference/cli/) - Complete command documentation
