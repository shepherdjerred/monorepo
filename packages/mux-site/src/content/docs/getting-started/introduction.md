---
title: Introduction
description: Learn what mux is and why you might want to use it
---

**mux** is a session management system for AI coding agents. It enables Claude Code and other AI tools to run in isolated environments with secure credential handling.

## The Problem

When running AI coding agents, you face a security dilemma:

- **Full access**: Give the agent your API keys and credentials, risking exposure
- **Manual intervention**: Approve every API call, breaking the autonomous workflow

## The Solution

mux solves this with a **zero-credential proxy architecture**:

1. AI agents run with placeholder credentials (e.g., `ANTHROPIC_API_KEY=placeholder`)
2. mux's HTTP proxy intercepts outgoing requests
3. Real credentials are injected at request time
4. Agents never see your actual tokens

## Key Features

### Multiple Backends

- **Docker**: Full container isolation with mounted volumes
- **Zellij**: Lightweight terminal multiplexer sessions
- **Git-based**: Clone repositories into isolated workspaces

### Credential Proxy

- TLS interception with auto-generated certificates
- OAuth token injection for GitHub, Anthropic, and more
- Request filtering to block malicious patterns

### Terminal UI

- Full-featured TUI built with Ratatui
- Create and manage sessions interactively
- Real-time session status monitoring

### Persistence

- SQLite-based session storage
- Resume sessions across restarts
- Event hooks for external integrations

## Next Steps

Ready to get started? Head to the [Installation](/getting-started/installation/) guide.
