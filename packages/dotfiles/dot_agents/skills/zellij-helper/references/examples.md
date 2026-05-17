# Zellij Examples & Workflows Reference

## Common Workflows

### Development Workspace Setup

```bash
#!/bin/bash
# Start development session with layout

SESSION="dev"
PROJECT_DIR="/path/to/project"

# Check if session exists
if zellij list-sessions | grep -q "^$SESSION$"; then
    zellij attach "$SESSION"
else
    cd "$PROJECT_DIR"
    zellij -s "$SESSION" --layout dev
fi
```

### Session Management Script

```bash
#!/bin/bash
# Interactive session selector using fzf

SESSION=$(zellij list-sessions | fzf --header="Select session (or type new name)")

if [ -z "$SESSION" ]; then
    exit 0
fi

if zellij list-sessions | grep -q "^$SESSION$"; then
    zellij attach "$SESSION"
else
    zellij -s "$SESSION"
fi
```

### Bulk Pane Operations

```bash
# Select multiple panes with Alt+click, then:
# - Close all selected: x
# - Float all selected: w
# - Stack all selected: s

# Or from CLI (create multi-pane setup)
zellij action new-pane -d right
zellij action new-pane -d down
zellij action move-focus left
zellij action new-pane -d down
```

### Layout for Microservices

```kdl
// microservices.kdl
layout {
    tab name="Services" {
        pane split_direction="vertical" {
            pane command="npm" {
                args "run" "dev"
                cwd "/path/to/api-gateway"
                name "API Gateway"
            }
            pane split_direction="horizontal" {
                pane command="npm" {
                    args "run" "dev"
                    cwd "/path/to/user-service"
                    name "User Service"
                }
                pane command="npm" {
                    args "run" "dev"
                    cwd "/path/to/order-service"
                    name "Order Service"
                }
            }
        }
    }
    tab name="Logs" {
        pane stacked=true {
            pane command="docker" {
                args "logs" "-f" "api-gateway"
                name "Gateway Logs"
            }
            pane command="docker" {
                args "logs" "-f" "user-service"
                name "User Logs"
            }
            pane command="docker" {
                args "logs" "-f" "order-service"
                name "Order Logs"
            }
        }
    }
    tab name="Terminal"
}
```

## Shell Integration

### Environment Variables

```bash
# Inside Zellij session
echo $ZELLIJ           # "0" if inside session
echo $ZELLIJ_SESSION_NAME  # Session name

# For scripting
if [ -n "$ZELLIJ" ]; then
    echo "Inside Zellij session: $ZELLIJ_SESSION_NAME"
fi
```

### Auto-Start Configuration

```bash
# .bashrc or .zshrc
if [ -z "$ZELLIJ" ]; then
    export ZELLIJ_AUTO_ATTACH=true  # Auto-attach to existing
    export ZELLIJ_AUTO_EXIT=true    # Exit shell when detaching
    eval "$(zellij setup --generate-auto-start bash)"
fi
```

### Prevent Nested Sessions

```bash
# .bashrc or .zshrc
if [ -z "$ZELLIJ" ]; then
    zellij attach -c default
fi
```

## Examples

### Example 1: Create IDE-like Layout

```kdl
// ide.kdl
layout {
    default_tab_template {
        pane size=1 borderless=true {
            plugin location="zellij:tab-bar"
        }
        children
        pane size=2 borderless=true {
            plugin location="zellij:status-bar"
        }
    }

    tab name="Editor" focus=true {
        pane split_direction="vertical" {
            pane size="20%" {
                plugin location="zellij:strider"
            }
            pane split_direction="horizontal" {
                pane command="nvim" focus=true {
                    args "."
                    name "Editor"
                }
                pane size="30%" {
                    name "Terminal"
                }
            }
        }
    }

    tab name="Git" {
        pane command="lazygit"
    }

    tab name="Logs" {
        pane stacked=true {
            pane command="tail" {
                args "-f" "logs/app.log"
            }
            pane command="tail" {
                args "-f" "logs/error.log"
            }
        }
    }
}
```

```bash
# Start with layout
zellij --layout ide
```

### Example 2: Scripted Session Setup

```bash
#!/bin/bash
# setup-dev.sh - Create development environment

PROJECT="my-project"

# Start new session
zellij -s "$PROJECT" &
sleep 1

# Create tabs and panes
zellij action rename-tab "Code"
zellij action new-pane -d right

zellij action new-tab -n "Server"
zellij run -i -- npm run dev

zellij action new-tab -n "Database"
zellij run -i -- docker compose up db

zellij action go-to-tab 1
zellij action move-focus left
zellij run -i -- nvim .

echo "Development environment ready!"
```

### Example 3: Web Client Setup (v0.43+)

```kdl
// config.kdl
web_server true
web_server_port 8080

// For secure access over network
// web_server_ip "0.0.0.0"
// Note: Use SSH tunnel or reverse proxy with HTTPS in production
```

```bash
# Start session with web access
zellij -s web-session

# Access from browser:
# http://localhost:8080
# Use authentication token shown in terminal
```

## Troubleshooting

### Check Configuration

```bash
# Validate config
zellij setup --check

# Show current config
zellij setup --dump-config
```

### Session Issues

```bash
# List all sessions
zellij ls

# Force kill stuck session
zellij kill-session stuck-session

# Clean up dead sessions
zellij delete-all-sessions
```

### Plugin Issues

```bash
# Check if plugin file exists
ls -la ~/.config/zellij/plugins/

# View plugin errors in scrollback
# Press Ctrl+s, then scroll up to see errors

# Reload plugin
zellij action start-or-reload-plugin file:/path/to/plugin.wasm
```

### Layout Issues

```bash
# Validate layout syntax
zellij --layout my-layout --dry-run

# Dump current state for debugging
zellij action dump-layout > debug-layout.kdl
```

### Performance Issues

```kdl
// Reduce scrollback for memory
scroll_buffer_size 5000
scrollback_lines_to_serialize 5000

// Disable features if slow
pane_viewport_serialization false
session_serialization false
```
