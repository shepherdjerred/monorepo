---
name: zellij-helper
description: |
  Zellij terminal multiplexer for session management, layouts, and pane operations
  When user mentions Zellij, terminal multiplexer, zellij commands, sessions, panes, layouts, or tabs
---

# Zellij Helper Agent

## What's New in Zellij 2025 (v0.42-0.43)

- **Web Client**: Built-in web server for browser access with authentication tokens
- **Stacked Resize**: Auto-stack panes when resizing for better space management
- **Pinned Floating Panes**: Keep floating panes always-on-top with toggle
- **Multiple Pane Selection**: Alt+click or Alt+p to select and operate on multiple panes
- **Session Resurrection**: Automatic serialization and resume after crash/reboot
- **New Themes**: ao, vesper, night-owl, iceberg, onedark, lucario

## Overview

Zellij is a modern terminal multiplexer with a focus on user experience, WebAssembly plugins, and KDL-based configuration. It provides sessions, tabs, and panes for organizing terminal workflows, with layouts for reproducible workspace setups.

## CLI Commands

### Session Management

```bash
# Start new session
zellij

# Start named session
zellij -s my-session

# Start with layout
zellij --layout dev

# List sessions
zellij list-sessions
zellij ls

# Attach to session
zellij attach my-session
zellij a my-session

# Attach or create if doesn't exist
zellij attach -c my-session

# Kill session
zellij kill-session my-session
zellij k my-session

# Kill all sessions
zellij kill-all-sessions
zellij ka

# Delete session (remove from resurrection)
zellij delete-session my-session
zellij d my-session

# Delete all sessions
zellij delete-all-sessions
zellij da
```

### Setup Commands

```bash
# Validate configuration
zellij setup --check

# Dump default config
zellij setup --dump-config > config.kdl

# Dump specific layout
zellij setup --dump-layout default

# Generate shell completions
zellij setup --generate-completion bash
zellij setup --generate-completion zsh
zellij setup --generate-completion fish

# Generate autostart script
zellij setup --generate-auto-start bash
```

### Zellij Run

Run commands in new panes from the shell:

```bash
# Run command in new pane
zellij run -- htop

# Run in floating pane
zellij run -f -- npm run dev

# Run in specific direction
zellij run -d right -- tail -f /var/log/syslog

# Close pane on command exit
zellij run -c -- make build

# Run in-place (replace current pane)
zellij run -i -- vim file.txt

# Start suspended (press Enter to run)
zellij run -s -- dangerous-command

# Custom pane name
zellij run -n "Build Output" -- cargo build

# Set working directory
zellij run --cwd /path/to/project -- ls -la

# Floating pane with size and position
zellij run -f --width 50% --height 30 -x 10% -y 5 -- htop
```

### Zellij Edit

Open files in editor panes:

```bash
# Open file in $EDITOR
zellij edit file.txt

# Open at specific line
zellij edit --line-number 42 src/main.rs

# Open in floating pane
zellij edit -f config.yaml

# Open in-place
zellij edit -i notes.md

# With direction
zellij edit -d down Makefile
```

### Zellij Actions

Control Zellij programmatically:

```bash
# Execute action
zellij action <action-name>

# Pane actions
zellij action new-pane
zellij action new-pane -d right
zellij action new-pane -f  # floating
zellij action close-pane
zellij action toggle-fullscreen
zellij action toggle-floating-panes
zellij action toggle-pane-frames
zellij action toggle-pane-embed-or-floating
zellij action move-pane
zellij action move-pane -d left

# Tab actions
zellij action new-tab
zellij action new-tab -n "Dev"
zellij action new-tab -l dev-layout
zellij action close-tab
zellij action go-to-tab 3
zellij action go-to-tab-name "Dev"
zellij action go-to-next-tab
zellij action go-to-previous-tab
zellij action rename-tab "New Name"

# Navigation
zellij action focus-next-pane
zellij action focus-previous-pane
zellij action move-focus left
zellij action move-focus right
zellij action move-focus up
zellij action move-focus down

# Scrolling
zellij action scroll-up
zellij action scroll-down
zellij action page-scroll-up
zellij action page-scroll-down
zellij action half-page-scroll-up
zellij action half-page-scroll-down
zellij action scroll-to-bottom

# Resize
zellij action resize increase left
zellij action resize decrease right
zellij action resize increase up 5
zellij action resize decrease down 10

# Utility actions
zellij action dump-screen /tmp/screen.txt
zellij action dump-layout > current-layout.kdl
zellij action edit-scrollback
zellij action toggle-active-sync-tab
zellij action write "echo hello"
zellij action write-chars "hello world"

# Plugin actions
zellij action launch-or-focus-plugin file:~/.config/zellij/plugins/my-plugin.wasm
zellij action start-or-reload-plugin file:~/.config/zellij/plugins/my-plugin.wasm
```

## Actions Reference

### Pane Operations

| Action | Description |
|--------|-------------|
| `new-pane` | Create new pane |
| `close-pane` | Close current pane |
| `move-pane` | Move pane in direction |
| `resize` | Resize pane |
| `toggle-fullscreen` | Fullscreen current pane |
| `toggle-floating-panes` | Show/hide floating panes |
| `toggle-pane-embed-or-floating` | Convert between embedded/floating |
| `toggle-pane-frames` | Show/hide pane borders |
| `toggle-pane-pinned` | Pin floating pane on top |
| `stack-panes` | Stack panes in direction |

### Tab Operations

| Action | Description |
|--------|-------------|
| `new-tab` | Create new tab |
| `close-tab` | Close current tab |
| `go-to-tab` | Go to tab by index |
| `go-to-tab-name` | Go to tab by name |
| `go-to-next-tab` | Next tab |
| `go-to-previous-tab` | Previous tab |
| `rename-tab` | Rename current tab |
| `toggle-tab` | Toggle to previous tab |
| `break-pane` | Move pane to new tab |
| `break-pane-left` | Move pane to new tab on left |
| `break-pane-right` | Move pane to new tab on right |

### Navigation

| Action | Description |
|--------|-------------|
| `focus-next-pane` | Focus next pane |
| `focus-previous-pane` | Focus previous pane |
| `move-focus` | Focus pane in direction |
| `move-focus-or-tab` | Focus pane or switch tab |
| `clear` | Clear terminal screen |

### Session & Mode

| Action | Description |
|--------|-------------|
| `detach` | Detach from session |
| `quit` | Exit Zellij |
| `switch-mode` | Change input mode |
| `previous-swap-layout` | Previous layout |
| `next-swap-layout` | Next layout |

## Layouts

### Loading Layouts

```bash
# Start with layout
zellij --layout my-layout

# Create new tab with layout
zellij action new-tab -l my-layout

# Dump current layout
zellij action dump-layout > layout.kdl
```

### Layout File Format (KDL)

```kdl
// ~/.config/zellij/layouts/dev.kdl
layout {
    // Default tab template
    default_tab_template {
        pane size=1 borderless=true {
            plugin location="zellij:tab-bar"
        }
        children
        pane size=2 borderless=true {
            plugin location="zellij:status-bar"
        }
    }

    // First tab - code editing
    tab name="Code" focus=true {
        pane split_direction="vertical" {
            pane command="nvim" {
                args "."
            }
            pane split_direction="horizontal" size="30%" {
                pane command="lazygit"
                pane name="Terminal"
            }
        }
    }

    // Second tab - services
    tab name="Services" {
        pane split_direction="horizontal" {
            pane command="npm" {
                args "run" "dev"
                cwd "/path/to/frontend"
            }
            pane command="npm" {
                args "run" "dev"
                cwd "/path/to/backend"
            }
        }
    }
}
```

### Floating Panes in Layouts

```kdl
layout {
    tab {
        pane
        floating_panes {
            pane command="htop" {
                x 10%
                y 10%
                width "60%"
                height "60%"
            }
        }
    }
}
```

### Stacked Panes

```kdl
layout {
    tab {
        pane stacked=true {
            pane command="tail" {
                args "-f" "/var/log/app.log"
                name "App Logs"
            }
            pane command="tail" {
                args "-f" "/var/log/system.log"
                name "System Logs"
            }
            pane command="tail" {
                args "-f" "/var/log/error.log"
                name "Error Logs"
            }
        }
        pane  // Main working pane
    }
}
```

### Session Configuration in Layouts

```kdl
layout {
    // Attach to existing session or create new one
    session name="dev-session"

    tab name="Editor" {
        pane command="nvim"
    }
}
```

## Configuration

### Config File Location

```
~/.config/zellij/config.kdl
```

### Key Configuration Options

```kdl
// config.kdl

// Behavior options
on_force_close "quit"  // or "detach"
simplified_ui false
pane_frames true
auto_layout true
session_serialization true
pane_viewport_serialization true
scrollback_lines_to_serialize 10000

// Shell and editor
default_shell "zsh"
default_layout "default"
default_mode "normal"  // or "locked"

// Mouse and copy
mouse_mode true
scroll_buffer_size 10000
copy_command "pbcopy"  // macOS
copy_clipboard "system"  // or "primary"
copy_on_select true

// Theme
theme "nord"

// Scrollback editor (for edit-scrollback action)
scrollback_editor "/usr/bin/nvim"

// Mirror sessions (sync input across panes)
mirror_session false

// Web client (v0.43+)
// web_server true
// web_server_port 8080

// Layout and theme directories
layout_dir "/path/to/layouts"
theme_dir "/path/to/themes"

// UI styling
styled_underlines true
hide_session_name false
```

### Keybindings Configuration

```kdl
// config.kdl
keybinds clear-defaults=true {
    // Normal mode
    normal {
        bind "Ctrl g" { SwitchToMode "locked"; }
        bind "Ctrl p" { SwitchToMode "pane"; }
        bind "Ctrl t" { SwitchToMode "tab"; }
        bind "Ctrl n" { SwitchToMode "resize"; }
        bind "Ctrl s" { SwitchToMode "scroll"; }
        bind "Ctrl o" { SwitchToMode "session"; }
        bind "Ctrl q" { Quit; }
    }

    // Locked mode (only unlock binding works)
    locked {
        bind "Ctrl g" { SwitchToMode "normal"; }
    }

    // Pane mode
    pane {
        bind "h" "Left" { MoveFocus "Left"; }
        bind "l" "Right" { MoveFocus "Right"; }
        bind "j" "Down" { MoveFocus "Down"; }
        bind "k" "Up" { MoveFocus "Up"; }
        bind "n" { NewPane; SwitchToMode "normal"; }
        bind "d" { NewPane "Down"; SwitchToMode "normal"; }
        bind "r" { NewPane "Right"; SwitchToMode "normal"; }
        bind "x" { CloseFocus; SwitchToMode "normal"; }
        bind "f" { ToggleFocusFullscreen; SwitchToMode "normal"; }
        bind "w" { ToggleFloatingPanes; SwitchToMode "normal"; }
        bind "e" { TogglePaneEmbedOrFloating; SwitchToMode "normal"; }
        bind "Esc" { SwitchToMode "normal"; }
    }

    // Tab mode
    tab {
        bind "h" "Left" { GoToPreviousTab; }
        bind "l" "Right" { GoToNextTab; }
        bind "n" { NewTab; SwitchToMode "normal"; }
        bind "x" { CloseTab; SwitchToMode "normal"; }
        bind "r" { SwitchToMode "RenameTab"; TabNameInput 0; }
        bind "1" { GoToTab 1; SwitchToMode "normal"; }
        bind "2" { GoToTab 2; SwitchToMode "normal"; }
        bind "3" { GoToTab 3; SwitchToMode "normal"; }
        bind "Esc" { SwitchToMode "normal"; }
    }

    // Resize mode
    resize {
        bind "h" "Left" { Resize "Increase Left"; }
        bind "j" "Down" { Resize "Increase Down"; }
        bind "k" "Up" { Resize "Increase Up"; }
        bind "l" "Right" { Resize "Increase Right"; }
        bind "H" { Resize "Decrease Left"; }
        bind "J" { Resize "Decrease Down"; }
        bind "K" { Resize "Decrease Up"; }
        bind "L" { Resize "Decrease Right"; }
        bind "=" "+" { Resize "Increase"; }
        bind "-" { Resize "Decrease"; }
        bind "Esc" { SwitchToMode "normal"; }
    }

    // Scroll mode
    scroll {
        bind "j" "Down" { ScrollDown; }
        bind "k" "Up" { ScrollUp; }
        bind "Ctrl f" "PageDown" { PageScrollDown; }
        bind "Ctrl b" "PageUp" { PageScrollUp; }
        bind "d" { HalfPageScrollDown; }
        bind "u" { HalfPageScrollUp; }
        bind "e" { EditScrollback; SwitchToMode "normal"; }
        bind "/" { SwitchToMode "EnterSearch"; SearchInput 0; }
        bind "Esc" { SwitchToMode "normal"; }
    }

    // Search mode
    search {
        bind "n" { Search "down"; }
        bind "N" { Search "up"; }
        bind "c" { SearchToggleOption "CaseSensitivity"; }
        bind "w" { SearchToggleOption "Wrap"; }
        bind "o" { SearchToggleOption "WholeWord"; }
        bind "Esc" { SwitchToMode "normal"; }
    }

    // Session mode
    session {
        bind "d" { Detach; }
        bind "w" {
            LaunchOrFocusPlugin "session-manager" {
                floating true
                move_to_focused_tab true
            }
            SwitchToMode "normal"
        }
        bind "Esc" { SwitchToMode "normal"; }
    }

    // Shared bindings across modes
    shared_except "locked" {
        bind "Alt h" { MoveFocusOrTab "Left"; }
        bind "Alt l" { MoveFocusOrTab "Right"; }
        bind "Alt j" { MoveFocus "Down"; }
        bind "Alt k" { MoveFocus "Up"; }
        bind "Alt n" { NewPane; }
        bind "Alt [" { PreviousSwapLayout; }
        bind "Alt ]" { NextSwapLayout; }
    }
}
```

## Modes

Zellij has 13 input modes:

| Mode | Description |
|------|-------------|
| `normal` | Default mode, typing goes to terminal |
| `locked` | Disable all Zellij keybindings |
| `pane` | Pane operations (create, close, move, focus) |
| `tab` | Tab operations (create, close, switch) |
| `resize` | Resize focused pane |
| `move` | Move focused pane |
| `scroll` | Scroll through pane output |
| `search` | Search within pane scrollback |
| `entersearch` | Enter search query |
| `renametab` | Rename current tab |
| `renamepane` | Rename current pane |
| `session` | Session operations (detach, manager) |
| `tmux` | tmux-compatible keybindings |

## Plugins

### Built-in Plugins

```kdl
// Tab bar at top
plugin location="zellij:tab-bar"

// Status bar at bottom
plugin location="zellij:status-bar"

// Compact status bar
plugin location="zellij:compact-bar"

// File browser
plugin location="zellij:strider"

// Session manager (v0.40+)
plugin location="zellij:session-manager"
```

### Plugin Configuration in Layouts

```kdl
layout {
    pane size=1 borderless=true {
        plugin location="zellij:tab-bar"
    }
    pane split_direction="vertical" {
        pane size="20%" {
            plugin location="zellij:strider" {
                // Plugin configuration
                cwd "/path/to/project"
            }
        }
        pane
    }
    pane size=2 borderless=true {
        plugin location="zellij:status-bar"
    }
}
```

### Loading External Plugins

```kdl
// From file path
plugin location="file:~/.config/zellij/plugins/my-plugin.wasm"

// With configuration
plugin location="file:/path/to/plugin.wasm" {
    option1 "value1"
    option2 true
}
```

### Popular Community Plugins

- **zellij-sessionizer**: FZF-powered session manager
- **zellij-autolock**: Auto-lock mode when running specific commands
- **zjstatus**: Customizable status bar
- **zellij-forgot**: Command history/cheatsheet popup
- **harpoon**: Quick pane/tab jumping

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

## When to Ask for Help

Ask the user for clarification when:
- Session name is ambiguous or conflicts with existing
- Layout file location or format is unclear
- Keybinding customization needs specifics
- Plugin paths or configuration need verification
- Destructive operations (kill-all-sessions) need confirmation
- Web client security configuration is required
