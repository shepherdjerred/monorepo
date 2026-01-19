---
title: Zellij Backend
description: Running sessions in Zellij terminal panes
---

The Zellij backend provides lightweight session isolation using terminal multiplexer panes. Sessions run directly on your host system, providing fast startup and full access to installed tools.

## How It Works

When you create a Zellij session, clauderon:

1. Creates a git worktree in `~/.clauderon/worktrees/<session-name>/`
2. Creates a new Zellij session
3. Configures proxy environment variables
4. Starts Claude Code (or your chosen agent) with your prompt

## Creating Zellij Sessions

Zellij is the default backend, so you don't need to specify it:

```bash
clauderon create --repo ~/project --prompt "Explore the codebase"
```

Or explicitly:

```bash
clauderon create --backend zellij --repo ~/project --prompt "Task"
```

## When to Use Zellij

Choose Zellij over Docker when you:

- Need faster session startup (~100ms vs ~2-5s)
- Want access to host system tools (compilers, debuggers, etc.)
- Don't need strict isolation
- Are working on projects that use host-specific configurations
- Are debugging or developing clauderon itself

## Backend Comparison

| Feature | Zellij | Docker | Kubernetes | Sprites | Apple |
|---------|--------|--------|------------|---------|-------|
| Isolation | Process | Container | Pod | Container | Container |
| Startup | ~100ms | ~2-5s | ~10-30s | ~5-10s | ~1s |
| Host tools | Full | Limited | None | None | Limited |
| Custom image | No | Yes | Yes | Yes | No |
| Resource limits | No | Yes | Yes | Yes | Yes |
| Cloud native | No | No | Yes | Yes | No |
| Platform | Any | Any | Any | Any | macOS 26+ |

## Configuration

Zellij doesn't require much configuration, but you can set defaults in `~/.clauderon/config.toml`:

```toml
[general]
# Set Zellij as default (already the default)
default_backend = "zellij"
```

## Attaching to Sessions

Attach to a Zellij session:

```bash
clauderon attach <session-name>
```

You can also attach directly via Zellij:

```bash
zellij attach clauderon-<session-name>
```

## Environment Variables

The following environment variables are set in Zellij sessions:

| Variable | Purpose |
|----------|---------|
| `HTTP_PROXY` | Points to clauderon proxy |
| `HTTPS_PROXY` | Points to clauderon proxy |
| `SSL_CERT_FILE` | CA certificate path |
| `NODE_EXTRA_CA_CERTS` | CA for Node.js |
| `REQUESTS_CA_BUNDLE` | CA for Python |

## Multiple Sessions

You can run multiple Zellij sessions simultaneously:

```bash
clauderon create --repo ~/project-a --prompt "Work on feature A"
clauderon create --repo ~/project-b --prompt "Work on feature B"

# List all sessions
clauderon list
```

Each session gets its own Zellij session and git worktree.

## Zellij Key Bindings

While attached to a session:

- `Ctrl+p` - Zellij mode selection
- `Ctrl+p` then `d` - Detach from session
- `Ctrl+p` then `q` - Quit Zellij

## Troubleshooting

### Session Not Found

If you can't attach to a session:

```bash
# List all Zellij sessions
zellij list-sessions

# Kill orphaned sessions
zellij kill-session <name>

# Reconcile clauderon database
clauderon reconcile
```

### Environment Not Set

If proxy variables aren't set:

```bash
# Check variables in the session
echo $HTTP_PROXY
echo $HTTPS_PROXY
```

If empty, the session may have been started without the daemon running. Delete and recreate:

```bash
clauderon delete <session-name>
clauderon create --repo ~/project --prompt "Task"
```

### Zellij Not Found

Ensure Zellij is installed and in your PATH:

```bash
# Check version
zellij --version

# Install if needed (macOS)
brew install zellij

# Install if needed (cargo)
cargo install zellij
```

## See Also

- [Backends Comparison](/getting-started/backends/) - Compare all backends
- [Docker Backend](/guides/docker/) - For isolated container sessions
- [Troubleshooting](/guides/troubleshooting/) - Common issues and solutions
