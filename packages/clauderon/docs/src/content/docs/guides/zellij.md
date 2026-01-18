---
title: Zellij Backend
description: Running sessions in Zellij terminal panes
---

The Zellij backend provides lightweight session isolation using terminal clauderon panes.

## How It Works

When you create a Zellij session, clauderon:

1. Creates a new Zellij session or pane
2. Configures proxy environment variables
3. Starts your shell with the working directory

## When to Use Zellij

Choose Zellij over Docker when you:

- Need faster session startup
- Don't need full container isolation
- Want access to host system tools
- Are debugging or developing clauderon itself

## Configuration

Configure Zellij settings in `~/.config/clauderon/config.toml`:

```toml
[zellij]
# Shell to use in sessions
shell = "/bin/zsh"

# Layout for new sessions
layout = "default"

# Additional environment variables
env = [
  "TERM=xterm-256color"
]
```

## Session Options

### Working Directory

Sessions start in the specified working directory:

```bash
clauderon new --backend zellij --workdir /home/user/projects my-session
```

### Named Sessions

Zellij sessions are named for easy reattachment:

```bash
# Create a named session
clauderon new --backend zellij --name my-project project-session

# Attach from Zellij
zellij attach my-project-project-session
```

## Zellij Layouts

Create custom layouts for clauderon sessions in `~/.config/zellij/layouts/clauderon.kdl`:

```kdl
layout {
    pane size=1 borderless=true {
        plugin location="tab-bar"
    }
    pane {
        // Main working pane
    }
    pane size=10 {
        // Log/status pane
    }
    pane size=2 borderless=true {
        plugin location="status-bar"
    }
}
```

Then configure clauderon to use it:

```toml
[zellij]
layout = "clauderon"
```

## Comparison with Docker

| Feature | Docker | Zellij |
|---------|--------|--------|
| Isolation | Full container | Process-level |
| Startup time | ~2-5 seconds | ~100ms |
| Host tool access | Limited | Full |
| Resource overhead | Higher | Lower |
| Network isolation | Optional | None |

## Troubleshooting

### Session Not Found

If you can't attach to a session:

```bash
# List all Zellij sessions
zellij list-sessions

# Kill orphaned sessions
zellij kill-session <name>
```

### Environment Not Set

If proxy variables aren't set, check your shell initialization:

```bash
# Variables should be set
echo $HTTP_PROXY
echo $HTTPS_PROXY
```
