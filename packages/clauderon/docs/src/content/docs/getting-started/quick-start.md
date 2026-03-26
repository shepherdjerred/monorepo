---
title: Quick Start
description: Create your first clauderon session in minutes
---

## 1. Start the Daemon

```bash
clauderon daemon
```

## 2. Create a Session

```bash
clauderon create --repo ~/my-project --prompt "Fix the login bug"
```

Options: `--backend` (zellij/docker), `--agent` (claude/codex/gemini), `--access-mode` (read-write/read-only).

Or use the TUI (`clauderon tui`, press `n`) or Web UI (`http://localhost:3030`).

![TUI Create Dialog](../../../assets/screenshots/tui/create-dialog.png)

## 3. Configure Credentials

```bash
mkdir -p ~/.clauderon/secrets
echo "your-github-token" > ~/.clauderon/secrets/github_token
echo "your-anthropic-token" > ~/.clauderon/secrets/anthropic_oauth_token
chmod 600 ~/.clauderon/secrets/*
```

| Credential      | File Name               |
| --------------- | ----------------------- |
| GitHub          | `github_token`          |
| Anthropic OAuth | `anthropic_oauth_token` |
| OpenAI/Codex    | `openai_api_key`        |
| PagerDuty       | `pagerduty_token`       |
| Sentry          | `sentry_auth_token`     |
| Grafana         | `grafana_api_key`       |
| npm             | `npm_token`             |

Or use [1Password integration](/guides/onepassword/).

## 4. Session Lifecycle

```bash
clauderon list                        # List sessions
clauderon list --archived             # Include archived
clauderon attach <session-name>       # Attach to terminal
clauderon archive <session-name>      # Hide but preserve
clauderon delete <session-name>       # Delete permanently
```

![Session List Output](../../../assets/screenshots/cli/clauderon-list.svg)

## Example Workflows

```bash
# Read-only code review
clauderon create --access-mode read-only --repo ~/project --prompt "Review payment module"

# Docker-isolated session
clauderon create --backend docker --repo ~/project --prompt "Refactor database layer"
```
