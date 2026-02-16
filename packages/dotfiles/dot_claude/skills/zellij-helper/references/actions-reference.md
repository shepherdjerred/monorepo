# Zellij Actions Reference

## Zellij Actions CLI

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

## Pane Operations

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

## Tab Operations

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

## Navigation

| Action | Description |
|--------|-------------|
| `focus-next-pane` | Focus next pane |
| `focus-previous-pane` | Focus previous pane |
| `move-focus` | Focus pane in direction |
| `move-focus-or-tab` | Focus pane or switch tab |
| `clear` | Clear terminal screen |

## Session & Mode

| Action | Description |
|--------|-------------|
| `detach` | Detach from session |
| `quit` | Exit Zellij |
| `switch-mode` | Change input mode |
| `previous-swap-layout` | Previous layout |
| `next-swap-layout` | Next layout |
