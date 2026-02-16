# WezTerm Lua Configuration Reference

WezTerm uses Lua 5.4 as its configuration language. Configuration auto-reloads on save.

## Configuration File Locations

```
~/.wezterm.lua                           -- primary
~/.config/wezterm/wezterm.lua            -- XDG alternative
$XDG_CONFIG_HOME/wezterm/wezterm.lua     -- XDG explicit
```

## Basic Configuration

```lua
local wezterm = require 'wezterm'
local config = wezterm.config_builder()

-- Font
config.font = wezterm.font 'JetBrains Mono'
config.font_size = 14.0
config.line_height = 1.2

-- Font with fallbacks
config.font = wezterm.font_with_fallback {
  'JetBrains Mono',
  'Symbols Nerd Font Mono',
  'Apple Color Emoji',
}

-- Font rules for italic/bold variants
config.font_rules = {
  {
    italic = true,
    font = wezterm.font('JetBrains Mono', { italic = true }),
  },
  {
    intensity = 'Bold',
    font = wezterm.font('JetBrains Mono', { weight = 'Bold' }),
  },
}

return config
```

## Appearance

```lua
-- Color scheme
config.color_scheme = 'Catppuccin Mocha'

-- Custom colors
config.colors = {
  foreground = '#cdd6f4',
  background = '#1e1e2e',
  cursor_bg = '#f5e0dc',
  cursor_fg = '#1e1e2e',
  cursor_border = '#f5e0dc',
  selection_fg = '#1e1e2e',
  selection_bg = '#f5e0dc',
  ansi = { '#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de' },
  brights = { '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8' },
  tab_bar = {
    background = '#11111b',
    active_tab = { bg_color = '#1e1e2e', fg_color = '#cdd6f4' },
    inactive_tab = { bg_color = '#181825', fg_color = '#6c7086' },
    inactive_tab_hover = { bg_color = '#1e1e2e', fg_color = '#cdd6f4' },
    new_tab = { bg_color = '#11111b', fg_color = '#6c7086' },
    new_tab_hover = { bg_color = '#1e1e2e', fg_color = '#cdd6f4' },
  },
}

-- Window
config.window_decorations = 'RESIZE'  -- 'FULL', 'NONE', 'TITLE', 'RESIZE', 'TITLE|RESIZE'
config.window_padding = { left = 12, right = 12, top = 12, bottom = 12 }
config.window_background_opacity = 0.95
config.macos_window_background_blur = 20
config.initial_cols = 120
config.initial_rows = 35

-- Window background image/gradient
config.window_background_gradient = {
  orientation = 'Vertical',
  colors = { '#1e1e2e', '#11111b' },
  interpolation = 'Linear',
  blend = 'Rgb',
}

-- Tab bar
config.enable_tab_bar = true
config.use_fancy_tab_bar = false
config.tab_bar_at_bottom = true
config.hide_tab_bar_if_only_one_tab = true
config.tab_max_width = 32
config.show_tab_index_in_tab_bar = true
config.switch_to_last_active_tab_when_closing_tab = true

-- Cursor
config.default_cursor_style = 'BlinkingBar'  -- 'SteadyBlock', 'BlinkingBlock', 'SteadyUnderline', 'BlinkingUnderline', 'SteadyBar', 'BlinkingBar'
config.cursor_blink_rate = 500
config.force_reverse_video_cursor = false

-- Scrollback
config.scrollback_lines = 10000
config.enable_scroll_bar = false
```

## Keybindings

```lua
local act = wezterm.action

config.keys = {
  -- Pane management
  { key = 'd', mods = 'SUPER', action = act.SplitHorizontal { domain = 'CurrentPaneDomain' } },
  { key = 'd', mods = 'SUPER|SHIFT', action = act.SplitVertical { domain = 'CurrentPaneDomain' } },
  { key = 'w', mods = 'SUPER', action = act.CloseCurrentPane { confirm = true } },
  { key = 'z', mods = 'SUPER|SHIFT', action = act.TogglePaneZoomState },

  -- Pane navigation
  { key = 'h', mods = 'SUPER|SHIFT', action = act.ActivatePaneDirection 'Left' },
  { key = 'j', mods = 'SUPER|SHIFT', action = act.ActivatePaneDirection 'Down' },
  { key = 'k', mods = 'SUPER|SHIFT', action = act.ActivatePaneDirection 'Up' },
  { key = 'l', mods = 'SUPER|SHIFT', action = act.ActivatePaneDirection 'Right' },

  -- Pane resize
  { key = 'H', mods = 'SUPER|SHIFT|CTRL', action = act.AdjustPaneSize { 'Left', 5 } },
  { key = 'J', mods = 'SUPER|SHIFT|CTRL', action = act.AdjustPaneSize { 'Down', 5 } },
  { key = 'K', mods = 'SUPER|SHIFT|CTRL', action = act.AdjustPaneSize { 'Up', 5 } },
  { key = 'L', mods = 'SUPER|SHIFT|CTRL', action = act.AdjustPaneSize { 'Right', 5 } },

  -- Tab management
  { key = 't', mods = 'SUPER', action = act.SpawnTab 'CurrentPaneDomain' },
  { key = '1', mods = 'SUPER', action = act.ActivateTab(0) },
  { key = '2', mods = 'SUPER', action = act.ActivateTab(1) },
  { key = '3', mods = 'SUPER', action = act.ActivateTab(2) },
  { key = '9', mods = 'SUPER', action = act.ActivateTab(-1) },  -- last tab

  -- Scrolling
  { key = 'k', mods = 'SUPER', action = act.ClearScrollback 'ScrollbackAndViewport' },
  { key = 'u', mods = 'SUPER', action = act.ScrollByPage(-0.5) },
  { key = 'd', mods = 'CTRL', action = act.ScrollByPage(0.5) },

  -- Utility
  { key = 'f', mods = 'SUPER', action = act.ToggleFullScreen },
  { key = 'p', mods = 'SUPER', action = act.ActivateCommandPalette },
  { key = 'l', mods = 'SUPER', action = act.ShowLauncher },
  { key = 'Space', mods = 'SUPER|SHIFT', action = act.QuickSelect },
  { key = '/', mods = 'SUPER', action = act.Search 'CurrentSelectionOrEmptyString' },

  -- Copy mode
  { key = 'x', mods = 'SUPER|SHIFT', action = act.ActivateCopyMode },

  -- Send key through (when WezTerm captures it)
  { key = 'Enter', mods = 'ALT', action = act.SendKey { key = 'Enter', mods = 'ALT' } },

  -- Disable default binding
  { key = 'n', mods = 'SUPER', action = act.DisableDefaultAssignment },
}

-- Mouse bindings
config.mouse_bindings = {
  -- Cmd-click to open hyperlinks
  {
    event = { Up = { streak = 1, button = 'Left' } },
    mods = 'SUPER',
    action = act.OpenLinkAtMouseCursor,
  },
  -- Right-click paste
  {
    event = { Down = { streak = 1, button = 'Right' } },
    mods = 'NONE',
    action = act.PasteFrom 'Clipboard',
  },
}
```

## Key Tables (Modal Keybinding)

```lua
config.key_tables = {
  resize_pane = {
    { key = 'h', action = act.AdjustPaneSize { 'Left', 2 } },
    { key = 'j', action = act.AdjustPaneSize { 'Down', 2 } },
    { key = 'k', action = act.AdjustPaneSize { 'Up', 2 } },
    { key = 'l', action = act.AdjustPaneSize { 'Right', 2 } },
    { key = 'Escape', action = 'PopKeyTable' },
    { key = 'q', action = 'PopKeyTable' },
  },
}

-- Activate key table from main keys
config.keys = {
  { key = 'r', mods = 'LEADER', action = act.ActivateKeyTable {
    name = 'resize_pane',
    one_shot = false,  -- stay in table until Escape
    timeout_milliseconds = 3000,
  }},
}

-- Leader key (like tmux prefix)
config.leader = { key = 'a', mods = 'CTRL', timeout_milliseconds = 1000 }
```

## Event System

### Predefined Events

```lua
-- Startup
wezterm.on('gui-startup', function(cmd)
  local tab, pane, window = wezterm.mux.spawn_window(cmd or {})
  window:gui_window():maximize()
end)

-- Attached to mux (reconnection)
wezterm.on('gui-attached', function(domain)
  local workspace = wezterm.mux.get_active_workspace()
  wezterm.log_info('Attached to ' .. workspace)
end)

-- Config reload
wezterm.on('window-config-reloaded', function(window, pane)
  window:toast_notification('wezterm', 'Config reloaded', nil, 2000)
end)

-- Tab title formatting
wezterm.on('format-tab-title', function(tab, tabs, panes, config, hover, max_width)
  local title = tab.active_pane.title
  local index = tab.tab_index + 1

  if tab.is_active then
    return {
      { Background = { Color = '#1e1e2e' } },
      { Foreground = { Color = '#89b4fa' } },
      { Text = ' ' .. index .. ': ' .. title .. ' ' },
    }
  end
  return ' ' .. index .. ': ' .. title .. ' '
end)

-- Window title
wezterm.on('format-window-title', function(tab, pane, tabs, panes, config)
  return pane.title .. ' - WezTerm'
end)

-- Status bar (right side)
wezterm.on('update-right-status', function(window, pane)
  local date = wezterm.strftime '%H:%M'
  local workspace = window:active_workspace()

  window:set_right_status(wezterm.format {
    { Foreground = { Color = '#89b4fa' } },
    { Text = workspace .. '  ' .. date .. ' ' },
  })
end)

-- Status bar (left side)
wezterm.on('update-status', function(window, pane)
  local mode = window:active_key_table()
  if mode then
    window:set_left_status(' ' .. mode .. ' ')
  else
    window:set_left_status('')
  end
end)

-- Bell notification
wezterm.on('bell', function(window, pane)
  wezterm.log_info('Bell in pane ' .. pane:pane_id())
end)

-- User variable change (set from shell via OSC)
wezterm.on('user-var-changed', function(window, pane, name, value)
  if name == 'CURRENT_DIR' then
    -- React to directory changes
  end
end)
```

### Custom Events

```lua
-- Register custom event handler
wezterm.on('my-custom-event', function(window, pane)
  window:perform_action(act.SendString 'hello', pane)
end)

-- Trigger from keybinding
config.keys = {
  { key = 'e', mods = 'SUPER', action = act.EmitEvent 'my-custom-event' },
}

-- Inline callback (action_callback helper)
config.keys = {
  {
    key = 'i',
    mods = 'SUPER',
    action = wezterm.action_callback(function(window, pane)
      local info = pane:get_foreground_process_info()
      wezterm.log_info('Process: ' .. (info and info.name or 'unknown'))
    end),
  },
}
```

### Event Return Values

Returning `false` from a callback prevents subsequent callbacks for that event from firing. This enables priority-based event handling.

## Multiplexing Domains

### Unix Domain (Local Multiplexer)

```lua
config.unix_domains = {
  {
    name = 'unix',
    -- socket_path = '/tmp/wezterm-mux',  -- optional custom path
  },
}

-- Auto-connect on startup
config.default_gui_startup_args = { 'connect', 'unix' }
```

### SSH Domains

```lua
config.ssh_domains = {
  {
    name = 'dev-server',
    remote_address = 'dev.example.com:22',
    username = 'deploy',
    -- remote_wezterm_path = '/usr/local/bin/wezterm',  -- if not in PATH
    -- multiplexing = 'WezTerm',  -- default; requires wezterm on remote
    -- multiplexing = 'None',     -- no mux, single pane
    -- ssh_option = { identityfile = '~/.ssh/id_ed25519' },
  },
}
```

### WSL Domains (Windows)

```lua
config.wsl_domains = {
  {
    name = 'WSL:Ubuntu',
    distribution = 'Ubuntu',
    default_cwd = '~',
  },
}
```

### Workspaces

```lua
-- Switch workspace
config.keys = {
  { key = 's', mods = 'LEADER', action = act.ShowLauncherArgs { flags = 'WORKSPACES' } },
  {
    key = 'n',
    mods = 'LEADER',
    action = act.PromptInputLine {
      description = 'Enter workspace name:',
      action = wezterm.action_callback(function(window, pane, line)
        if line then
          window:perform_action(act.SwitchToWorkspace { name = line }, pane)
        end
      end),
    },
  },
}

-- Startup with specific workspace
wezterm.on('gui-startup', function()
  local project_dir = wezterm.home_dir .. '/projects/myapp'

  local tab, build_pane, window = wezterm.mux.spawn_window {
    workspace = 'coding',
    cwd = project_dir,
  }
  local edit_pane = build_pane:split {
    direction = 'Top',
    size = 0.7,
    cwd = project_dir,
  }

  wezterm.mux.spawn_window {
    workspace = 'monitoring',
    args = { 'htop' },
  }

  wezterm.mux.set_active_workspace 'coding'
end)
```

## Modular Configuration

### Helper Module Pattern

```lua
-- ~/.config/wezterm/keys.lua
local wezterm = require 'wezterm'
local act = wezterm.action

local M = {}

function M.apply_to_config(config)
  config.leader = { key = 'a', mods = 'CTRL', timeout_milliseconds = 1000 }
  config.keys = {
    { key = 'd', mods = 'LEADER', action = act.SplitHorizontal { domain = 'CurrentPaneDomain' } },
    -- more keys...
  }
end

return M

-- ~/.config/wezterm/appearance.lua
local M = {}

function M.apply_to_config(config)
  config.color_scheme = 'Catppuccin Mocha'
  config.font_size = 14
  -- more appearance settings...
end

return M

-- ~/.config/wezterm/wezterm.lua
local wezterm = require 'wezterm'
local config = wezterm.config_builder()

require('keys').apply_to_config(config)
require('appearance').apply_to_config(config)

return config
```

### Platform-Specific Configuration

```lua
local is_macos = wezterm.target_triple:find('darwin') ~= nil
local is_linux = wezterm.target_triple:find('linux') ~= nil
local is_windows = wezterm.target_triple:find('windows') ~= nil

if is_macos then
  config.font_size = 14
  config.window_decorations = 'RESIZE'
  config.send_composed_key_when_left_alt_is_pressed = true
elseif is_linux then
  config.font_size = 12
  config.enable_wayland = true
end

-- Platform-specific default program
if is_windows then
  config.default_prog = { 'pwsh.exe' }
end
```

## Useful wezterm Module Functions

```lua
-- Logging
wezterm.log_info('message')
wezterm.log_warn('warning')
wezterm.log_error('error')

-- Time formatting
wezterm.strftime '%Y-%m-%d %H:%M:%S'

-- Home directory
wezterm.home_dir

-- Config directory
wezterm.config_dir

-- Hostname
wezterm.hostname()

-- Running processes
wezterm.procinfo.pid()

-- Color manipulation
local color = wezterm.color.parse('#89b4fa')
local lighter = color:lighten(0.2)
local darker = color:darken(0.2)
local saturated = color:saturate(0.3)
local complement = color:complement()
local h, s, l, a = color:hsla()

-- Nerd font glyphs
wezterm.nerdfonts.fa_code_fork  -- access nerd font icon names

-- JSON
local data = wezterm.json_parse(json_string)
local json = wezterm.json_encode(table)

-- Running shell commands
local success, stdout, stderr = wezterm.run_child_process { 'ls', '-la' }
```

## Launch Menu

```lua
config.launch_menu = {
  { label = 'Bash', args = { 'bash', '-l' } },
  { label = 'Fish', args = { 'fish', '-l' } },
  { label = 'Htop', args = { 'htop' } },
  { label = 'SSH Dev', args = { 'ssh', 'dev.example.com' } },
}

-- Dynamic launch menu based on platform
if is_macos then
  table.insert(config.launch_menu, {
    label = 'Homebrew Update',
    args = { 'brew', 'update' },
  })
end
```

## Hyperlink Rules

```lua
-- Add custom hyperlink patterns (clickable links)
config.hyperlink_rules = wezterm.default_hyperlink_rules()

-- Add Jira ticket pattern
table.insert(config.hyperlink_rules, {
  regex = [[\b(PROJ-\d+)\b]],
  format = 'https://jira.example.com/browse/$1',
})

-- Add GitHub issue pattern
table.insert(config.hyperlink_rules, {
  regex = [[\b(\w+/\w+)#(\d+)\b]],
  format = 'https://github.com/$1/issues/$2',
})
```

## Quick Select Patterns

```lua
-- Add patterns for quick selection (Ctrl+Shift+Space)
config.quick_select_patterns = {
  -- UUID
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  -- IP address
  '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}',
  -- Docker container ID
  '[0-9a-f]{12,}',
}
```
