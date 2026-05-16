---
name: lua-helper
description: |
  Lua scripting for Neovim and WezTerm configuration - language patterns, vim API, and config management
  When user works with .lua files, mentions Lua, Neovim config, WezTerm config, vim.api, or Lua scripting
---

# Lua Helper Agent

## What's New (2025)

### Lua Language

- **Lua 5.5.0** (Dec 2025): Declarations for global variables, named vararg tables, compact arrays (60% memory reduction), incremental major GC, read-only for-loop variables
- **Lua 5.4.8** (Jun 2025): Latest bug-fix release for 5.4 series
- **LuaJIT**: Still based on Lua 5.1 syntax; Neovim permanently targets LuaJIT/5.1

### Neovim 0.11

- **Native LSP config**: `vim.lsp.config()` and `vim.lsp.enable()` replace nvim-lspconfig for basic setups
- **LSP completion**: `vim.lsp.completion.enable()` provides built-in auto-completion
- **Default LSP mappings**: `grn` (rename), `grr` (references), `gri` (implementation), `gO` (symbols), `gra` (code actions)
- **Async treesitter**: Highlighting, folding, and injection processing run asynchronously
- **Virtual lines diagnostics**: Display diagnostics as separate buffer lines
- **Snippet navigation**: Tab/Shift-Tab jump through `vim.snippet` nodes in insert mode
- **`winborder` option**: Set default borders for all floating windows
- **Grapheme cluster support**: Proper emoji and Unicode display

### Neovim 0.10

- **`vim.iter()`**: Generic iterator interface for tables and iterator functions
- **`vim.snippet`**: Built-in snippet expansion and navigation
- **`vim.ringbuf()`**: Generic ring buffer data structure
- **`vim.ui.open()`**: Open URIs with system default handler

## Overview

Lua serves as the primary configuration and extension language for Neovim and WezTerm. Neovim uses LuaJIT (Lua 5.1 compatible), while WezTerm embeds Lua 5.4. Both use Lua's table-based configuration model, but their APIs differ significantly.

**Key distinction**: Write Neovim Lua targeting Lua 5.1/LuaJIT semantics. Write WezTerm Lua targeting Lua 5.4 semantics. Avoid Lua 5.4 features (integers, to-be-closed variables, generational GC control) in Neovim code.

## Core Lua Quick Reference

### Tables

```lua
-- Array-style (1-indexed)
local list = { 'a', 'b', 'c' }
print(#list)  -- 3

-- Dictionary-style
local map = { name = 'value', ['key-with-dash'] = true }

-- Mixed
local mixed = { 'first', key = 'val', 'second' }

-- Nested
local config = {
  ui = { border = 'rounded', width = 80 },
  keys = { '<leader>f', '<leader>g' },
}

-- Table manipulation
table.insert(list, 'd')        -- append
table.insert(list, 2, 'x')    -- insert at position
table.remove(list, 1)          -- remove at position
table.sort(list)               -- in-place sort
table.concat(list, ', ')       -- join to string
```

### Functions and Closures

```lua
-- Named function
local function greet(name)
  return 'Hello, ' .. name
end

-- Anonymous / closure
local counter = (function()
  local count = 0
  return function()
    count = count + 1
    return count
  end
end)()

-- Variadic
local function log(level, ...)
  local args = { ... }
  print(string.format('[%s] %s', level, table.concat(args, ' ')))
end

-- Method syntax (colon passes self)
local obj = { name = 'test' }
function obj:get_name()
  return self.name
end
```

### Metatables

```lua
local Vector = {}
Vector.__index = Vector

function Vector.new(x, y)
  return setmetatable({ x = x, y = y }, Vector)
end

function Vector:length()
  return math.sqrt(self.x^2 + self.y^2)
end

function Vector.__add(a, b)
  return Vector.new(a.x + b.x, a.y + b.y)
end

function Vector:__tostring()
  return string.format('(%g, %g)', self.x, self.y)
end
```

### String Patterns

```lua
-- Lua patterns (NOT regex)
-- Character classes: %a (letter), %d (digit), %w (alphanumeric), %s (space), %p (punctuation)
-- Uppercase = complement: %A (non-letter), %D (non-digit)

string.find('hello world', 'world')         -- 7, 11
string.match('key=value', '(%w+)=(%w+)')    -- 'key', 'value'
string.gmatch('a,b,c', '[^,]+')             -- iterator: 'a', 'b', 'c'
string.gsub('hello', 'l', 'L')              -- 'heLLo', 2
string.format('%s has %d items', 'list', 5)  -- 'list has 5 items'
```

### Error Handling

```lua
-- Protected call
local ok, result = pcall(function()
  return risky_operation()
end)
if not ok then
  print('Error: ' .. result)
end

-- With error handler (gets stack trace)
local ok, result = xpcall(risky_fn, debug.traceback)

-- Assert pattern (common in Neovim)
local value = assert(some_function(), 'Expected non-nil result')

-- Result-or-error pattern
local function safe_read(path)
  local f, err = io.open(path, 'r')
  if not f then return nil, err end
  local content = f:read('*a')
  f:close()
  return content
end
```

### Modules

```lua
-- Define a module
local M = {}

function M.setup(opts)
  -- configure
end

function M.run()
  -- execute
end

return M

-- Use a module
local mymod = require('mymod')
mymod.setup({ option = true })
```

## Neovim Lua Essentials

### Options

```lua
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.shiftwidth = 2
vim.opt.expandtab = true
vim.opt.smartindent = true
vim.opt.wrap = false
vim.opt.signcolumn = 'yes'
vim.opt.completeopt = { 'menu', 'menuone', 'noselect' }
vim.opt.wildignore:append({ '*.o', '*.pyc', 'node_modules' })

-- Buffer/window local
vim.bo.filetype = 'lua'
vim.wo.foldmethod = 'expr'
```

### Key Mappings

```lua
-- vim.keymap.set(mode, lhs, rhs, opts)
vim.keymap.set('n', '<leader>ff', function()
  require('telescope.builtin').find_files()
end, { desc = 'Find files' })

vim.keymap.set('n', '<Esc>', '<cmd>nohlsearch<CR>', { desc = 'Clear search highlight' })
vim.keymap.set({ 'n', 'v' }, '<leader>y', '"+y', { desc = 'Yank to clipboard' })
vim.keymap.set('i', 'jk', '<Esc>', { desc = 'Exit insert mode' })
vim.keymap.set('n', '<leader>e', vim.diagnostic.open_float, { desc = 'Show diagnostic' })

-- Buffer-local mapping
vim.keymap.set('n', 'K', vim.lsp.buf.hover, { buffer = true, desc = 'LSP hover' })

-- Delete a mapping
vim.keymap.del('n', '<leader>ff')
```

### Autocommands

```lua
local group = vim.api.nvim_create_augroup('MyGroup', { clear = true })

vim.api.nvim_create_autocmd('BufWritePre', {
  group = group,
  pattern = '*.lua',
  callback = function(args)
    -- args.buf, args.match, args.file
    vim.lsp.buf.format({ bufnr = args.buf })
  end,
})

vim.api.nvim_create_autocmd('FileType', {
  group = group,
  pattern = { 'javascript', 'typescript' },
  callback = function()
    vim.opt_local.shiftwidth = 2
  end,
})

vim.api.nvim_create_autocmd('TextYankPost', {
  group = group,
  callback = function()
    vim.hl.on_yank()
  end,
})
```

### User Commands

```lua
vim.api.nvim_create_user_command('Greet', function(opts)
  local name = opts.fargs[1] or 'World'
  print('Hello, ' .. name .. (opts.bang and '!' or '.'))
end, {
  nargs = '?',
  bang = true,
  desc = 'Greet someone',
  complete = function()
    return { 'Alice', 'Bob', 'World' }
  end,
})
```

### Variables

```lua
vim.g.mapleader = ' '          -- global variable
vim.g.maplocalleader = '\\'
vim.b.some_flag = true          -- buffer variable
vim.g.loaded_netrw = 1          -- disable built-in plugin
```

### LSP Configuration (0.11+)

```lua
-- ~/.config/nvim/lsp/lua_ls.lua
return {
  cmd = { 'lua-language-server' },
  filetypes = { 'lua' },
  root_markers = { '.luarc.json', '.luarc.jsonc' },
  settings = {
    Lua = {
      runtime = { version = 'LuaJIT' },
      workspace = { library = vim.api.nvim_get_runtime_file('', true) },
    },
  },
}

-- init.lua
vim.lsp.enable({ 'lua_ls', 'ts_ls', 'rust_analyzer' })
```

### Vim API Common Functions

```lua
-- Buffer operations
local buf = vim.api.nvim_get_current_buf()
local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
vim.api.nvim_buf_set_lines(buf, 0, -1, false, { 'new content' })
vim.api.nvim_buf_set_option(buf, 'modifiable', false)

-- Window operations
local win = vim.api.nvim_get_current_win()
vim.api.nvim_win_set_cursor(win, { 10, 0 })  -- row 10, col 0
local cursor = vim.api.nvim_win_get_cursor(win)

-- Create floating window
local buf = vim.api.nvim_create_buf(false, true)
local win = vim.api.nvim_open_win(buf, true, {
  relative = 'editor',
  width = 60,
  height = 20,
  col = 10,
  row = 5,
  style = 'minimal',
  border = 'rounded',
})

-- Highlights
vim.api.nvim_set_hl(0, 'MyHighlight', { fg = '#ff0000', bold = true })
```

### Utility Functions

```lua
-- Table utilities
vim.tbl_extend('force', defaults, user_opts)
vim.tbl_deep_extend('force', defaults, user_opts)
vim.tbl_contains(list, 'value')
vim.tbl_keys(map)
vim.tbl_filter(function(v) return v > 0 end, numbers)

-- Iterators (0.10+)
vim.iter(ipairs(list)):map(function(_, v) return v * 2 end):totable()
vim.iter(pairs(map)):filter(function(k, v) return v ~= nil end):totable()

-- File system
vim.fs.find('init.lua', { upward = true })
vim.fs.root(0, { '.git', 'Makefile' })
vim.fs.joinpath(vim.fn.stdpath('config'), 'lua')

-- Scheduling (required from vim.uv callbacks)
vim.schedule(function()
  vim.api.nvim_echo({ { 'Done!', 'Normal' } }, true, {})
end)

-- Deferred execution
vim.defer_fn(function()
  print('Delayed message')
end, 1000)

-- Inspect
print(vim.inspect({ nested = { data = true } }))
```

## WezTerm Config Essentials

### Basic Structure

```lua
local wezterm = require 'wezterm'
local config = wezterm.config_builder()

config.font = wezterm.font 'JetBrains Mono'
config.font_size = 14.0
config.color_scheme = 'Catppuccin Mocha'
config.window_decorations = 'RESIZE'
config.enable_tab_bar = true
config.hide_tab_bar_if_only_one_tab = true
config.window_padding = { left = 8, right = 8, top = 8, bottom = 8 }

return config
```

### Keybindings

```lua
local act = wezterm.action

config.keys = {
  { key = 'l', mods = 'SUPER', action = act.ShowLauncher },
  { key = 'f', mods = 'SUPER', action = act.ToggleFullScreen },
  { key = 'd', mods = 'SUPER', action = act.SplitHorizontal { domain = 'CurrentPaneDomain' } },
  { key = 'd', mods = 'SUPER|SHIFT', action = act.SplitVertical { domain = 'CurrentPaneDomain' } },
  { key = 'w', mods = 'SUPER', action = act.CloseCurrentPane { confirm = true } },
  { key = '[', mods = 'SUPER', action = act.ActivatePaneDirection 'Prev' },
  { key = ']', mods = 'SUPER', action = act.ActivatePaneDirection 'Next' },
  { key = 'k', mods = 'SUPER', action = act.ClearScrollback 'ScrollbackAndViewport' },
  { key = 'p', mods = 'SUPER', action = act.ActivateCommandPalette },
}
```

### Events

```lua
wezterm.on('gui-startup', function(cmd)
  local tab, pane, window = wezterm.mux.spawn_window(cmd or {})
  window:gui_window():maximize()
end)

wezterm.on('format-tab-title', function(tab, tabs, panes, config, hover, max_width)
  local title = tab.active_pane.title
  if tab.is_active then
    return { { Background = { Color = '#1e1e2e' } }, { Text = ' ' .. title .. ' ' } }
  end
  return ' ' .. title .. ' '
end)

-- Custom event with action_callback
config.keys = {
  {
    key = 'r',
    mods = 'SUPER|SHIFT',
    action = wezterm.action_callback(function(window, pane)
      window:perform_action(act.ReloadConfiguration, pane)
    end),
  },
}
```

### Multiplexing

```lua
config.unix_domains = {
  { name = 'unix' },
}

config.ssh_domains = {
  {
    name = 'my-server',
    remote_address = 'server.example.com',
    username = 'user',
  },
}

-- Default to multiplexer domain
config.default_gui_startup_args = { 'connect', 'unix' }
```

## Reference Files

Detailed references in `references/` directory:

- **neovim-lua-api.md**: Complete Neovim Lua API patterns - vim.api._, vim.fn._, vim.opt, keymaps, autocommands, user commands, highlights, plugin development, LSP, treesitter, diagnostics
- **wezterm-config.md**: WezTerm Lua configuration - keybindings, appearance, multiplexing, events, custom actions, domains, status bar
- **lua-language.md**: Core Lua language patterns - tables, metatables, closures, coroutines, modules, string patterns, error handling, OOP, iterators

## When to Ask for Help

Ask the user for clarification when:

- Target environment is ambiguous (Neovim LuaJIT vs WezTerm Lua 5.4)
- Plugin manager choice affects configuration structure
- LSP server configuration needs specific project settings
- Keybinding conflicts with existing mappings are possible
- WezTerm multiplexing domain setup needs network details
