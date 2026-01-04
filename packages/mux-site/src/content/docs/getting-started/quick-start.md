---
title: Quick Start
description: Create your first mux session in minutes
---

This guide will walk you through creating your first mux session.

## Start the TUI

Launch mux without any arguments to open the terminal user interface:

```bash
mux
```

You'll see the main session list view. Use the keyboard to navigate:

- `n` - Create a new session
- `Enter` - Attach to a session
- `d` - Delete a session
- `q` - Quit

## Create a Session

Press `n` to create a new session. You'll be prompted to configure:

1. **Session Name**: A memorable name for your session
2. **Backend**: Choose Docker or Zellij
3. **Working Directory**: The directory to mount/work in
4. **Git Repository** (optional): Clone a repo for the session

## Configure Credentials

Create a configuration file at `~/.config/mux/config.toml`:

```toml
[credentials]
# Your Anthropic API key for Claude
anthropic_api_key = "sk-ant-..."

# GitHub OAuth token for git operations
github_token = "ghp_..."

[proxy]
# Port for the HTTP proxy
port = 8080

# Auto-generate TLS certificates
generate_certs = true
```

## Run Claude Code in a Session

Once your session is created and attached:

```bash
# The proxy is automatically configured
# Claude Code will use the proxy for API calls
claude

# Your real credentials are never exposed to the agent
echo $ANTHROPIC_API_KEY  # Shows "placeholder"
```

## Session Lifecycle

Sessions persist across mux restarts:

```bash
# List all sessions
mux list

# Attach to an existing session
mux attach <session-name>

# Delete a session
mux delete <session-name>
```

## Next Steps

- Learn about [Docker Backend](/guides/docker/) configuration
- Configure the [Credential Proxy](/guides/proxy/)
- View the full [CLI Reference](/reference/cli/)
