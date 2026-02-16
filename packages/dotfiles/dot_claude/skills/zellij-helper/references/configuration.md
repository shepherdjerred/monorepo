# Zellij Configuration Reference

## Config File Location

```
~/.config/zellij/config.kdl
```

## Key Configuration Options

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

## Keybindings Configuration

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
