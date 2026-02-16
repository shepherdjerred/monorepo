# Neovim Lua API Reference

## API Layers

Neovim exposes three API layers to Lua:

1. **Vim API** (`vim.cmd()`, `vim.fn`): Inherited Vimscript Ex-commands and functions
2. **Nvim API** (`vim.api`): C-based API for remote plugins and GUIs, prefixed `nvim_`
3. **Lua API** (`vim.*`): Native Lua functions designed specifically for Lua consumers

Target Lua 5.1/LuaJIT semantics exclusively. Check `jit` global before using LuaJIT extensions.

## vim.api -- Core C API Bindings

### Buffer Operations

```lua
-- Get/set current buffer
local buf = vim.api.nvim_get_current_buf()
vim.api.nvim_set_current_buf(buf)

-- List buffers
local bufs = vim.api.nvim_list_bufs()

-- Get buffer info
local name = vim.api.nvim_buf_get_name(buf)
local loaded = vim.api.nvim_buf_is_loaded(buf)
local valid = vim.api.nvim_buf_is_valid(buf)
local line_count = vim.api.nvim_buf_line_count(buf)

-- Read lines (0-indexed, end-exclusive)
local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)   -- all lines
local first = vim.api.nvim_buf_get_lines(buf, 0, 1, false)    -- first line
local range = vim.api.nvim_buf_get_lines(buf, 5, 10, false)   -- lines 6-10

-- Write lines
vim.api.nvim_buf_set_lines(buf, 0, -1, false, { 'line1', 'line2' })  -- replace all
vim.api.nvim_buf_set_lines(buf, -1, -1, false, { 'appended' })       -- append

-- Get/set text (row/col coordinates, 0-indexed)
local text = vim.api.nvim_buf_get_text(buf, 0, 0, 0, 5, {})  -- first 5 chars of line 1
vim.api.nvim_buf_set_text(buf, 0, 0, 0, 5, { 'replaced' })

-- Create scratch buffer
local scratch = vim.api.nvim_create_buf(false, true)  -- listed=false, scratch=true
vim.api.nvim_buf_set_name(scratch, 'MyBuffer')

-- Delete buffer
vim.api.nvim_buf_delete(buf, { force = true })

-- Buffer options
vim.api.nvim_set_option_value('modifiable', false, { buf = buf })
vim.api.nvim_set_option_value('filetype', 'markdown', { buf = buf })
vim.api.nvim_set_option_value('bufhidden', 'wipe', { buf = buf })
```

### Window Operations

```lua
-- Get/set current window
local win = vim.api.nvim_get_current_win()
vim.api.nvim_set_current_win(win)

-- List windows
local wins = vim.api.nvim_list_wins()
local tab_wins = vim.api.nvim_tabpage_list_wins(0)

-- Cursor position (1-indexed row, 0-indexed col)
local pos = vim.api.nvim_win_get_cursor(win)  -- { row, col }
vim.api.nvim_win_set_cursor(win, { 10, 0 })

-- Window dimensions
local width = vim.api.nvim_win_get_width(win)
local height = vim.api.nvim_win_get_height(win)
vim.api.nvim_win_set_width(win, 80)
vim.api.nvim_win_set_height(win, 24)

-- Window buffer
local buf = vim.api.nvim_win_get_buf(win)
vim.api.nvim_win_set_buf(win, other_buf)

-- Window options
vim.api.nvim_set_option_value('number', true, { win = win })
vim.api.nvim_set_option_value('wrap', false, { win = win })

-- Close window
vim.api.nvim_win_close(win, true)  -- force=true
```

### Floating Windows

```lua
local buf = vim.api.nvim_create_buf(false, true)

-- Centered floating window
local width = math.floor(vim.o.columns * 0.8)
local height = math.floor(vim.o.lines * 0.8)
local win = vim.api.nvim_open_win(buf, true, {
  relative = 'editor',
  width = width,
  height = height,
  col = math.floor((vim.o.columns - width) / 2),
  row = math.floor((vim.o.lines - height) / 2),
  style = 'minimal',
  border = 'rounded',  -- 'none', 'single', 'double', 'rounded', 'solid', 'shadow'
  title = 'My Window',
  title_pos = 'center',
  footer = 'Press q to close',
  footer_pos = 'center',
})

-- Window relative to cursor
vim.api.nvim_open_win(buf, false, {
  relative = 'cursor',
  width = 40,
  height = 10,
  col = 0,
  row = 1,
  style = 'minimal',
  border = 'single',
})

-- Set window config after creation
vim.api.nvim_win_set_config(win, { title = 'Updated Title' })
```

### Tab Pages

```lua
local tab = vim.api.nvim_get_current_tabpage()
local tabs = vim.api.nvim_list_tabpages()
local tab_win = vim.api.nvim_tabpage_get_win(tab)
local tab_num = vim.api.nvim_tabpage_get_number(tab)
```

### Extmarks and Namespaces

```lua
-- Create namespace
local ns = vim.api.nvim_create_namespace('my-plugin')

-- Set extmark (virtual text, highlights, signs)
local mark_id = vim.api.nvim_buf_set_extmark(buf, ns, 0, 0, {
  virt_text = { { 'virtual text', 'Comment' } },
  virt_text_pos = 'eol',  -- 'eol', 'overlay', 'right_align', 'inline'
  hl_group = 'Search',
  end_row = 0,
  end_col = 5,
  priority = 100,
  sign_text = '>>',
  sign_hl_group = 'DiagnosticSignError',
})

-- Get extmarks
local marks = vim.api.nvim_buf_get_extmarks(buf, ns, 0, -1, { details = true })

-- Delete extmark
vim.api.nvim_buf_del_extmark(buf, ns, mark_id)

-- Clear namespace
vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
```

### Highlights

```lua
-- Set highlight group
vim.api.nvim_set_hl(0, 'MyHighlight', {
  fg = '#e06c75',
  bg = '#282c34',
  bold = true,
  italic = false,
  underline = false,
  sp = '#ff0000',       -- special color (underline/undercurl)
  undercurl = true,
  strikethrough = false,
  link = 'OtherGroup',  -- link to existing group (overrides other attrs)
  default = false,       -- only set if not already defined
})

-- Get highlight info
local hl = vim.api.nvim_get_hl(0, { name = 'Normal' })

-- Namespace-scoped highlights (for plugins)
vim.api.nvim_set_hl(ns, 'MyPluginHl', { fg = '#00ff00' })
vim.api.nvim_win_set_hl_ns(win, ns)  -- apply namespace to window
```

## vim.fn -- Vimscript Function Bridge

```lua
-- File operations
vim.fn.expand('%:p')           -- full path of current file
vim.fn.expand('%:t')           -- filename only
vim.fn.fnamemodify(path, ':h') -- directory of path
vim.fn.filereadable(path)      -- 1 if readable, 0 if not
vim.fn.isdirectory(path)       -- 1 if directory
vim.fn.glob('*.lua')           -- glob pattern match
vim.fn.globpath('.', '**/*.lua') -- recursive glob
vim.fn.mkdir(path, 'p')       -- mkdir -p equivalent

-- String operations
vim.fn.trim(str)               -- trim whitespace
vim.fn.toupper(str)            -- uppercase
vim.fn.tolower(str)            -- lowercase
vim.fn.substitute(str, pat, rep, flags)

-- System interaction
vim.fn.system('ls -la')        -- run shell command, return output
vim.fn.systemlist('ls -la')    -- run command, return lines
vim.fn.executable('rg')        -- 1 if in PATH
vim.fn.getenv('HOME')          -- environment variable
vim.fn.shellescape(arg)        -- escape for shell

-- Input
vim.fn.input('Enter name: ')
vim.fn.confirm('Delete?', '&Yes\n&No', 2)
vim.fn.inputlist({ 'Select:', '1. Option A', '2. Option B' })

-- Register and cursor
vim.fn.getreg('"')            -- get register content
vim.fn.setreg('"', 'text')    -- set register
vim.fn.line('.')               -- current line number
vim.fn.col('.')                -- current column
vim.fn.getline('.')            -- current line text
vim.fn.getpos('.')             -- [bufnum, lnum, col, off]

-- Autoload functions (use bracket notation)
vim.fn['my#plugin#func']()
```

## vim.opt -- Option Management

```lua
-- Set options (like :set)
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.tabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true
vim.opt.smartindent = true
vim.opt.wrap = false
vim.opt.cursorline = true
vim.opt.termguicolors = true
vim.opt.signcolumn = 'yes'
vim.opt.scrolloff = 8
vim.opt.sidescrolloff = 8
vim.opt.updatetime = 250
vim.opt.timeoutlen = 300
vim.opt.undofile = true
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.splitbelow = true
vim.opt.splitright = true
vim.opt.clipboard = 'unnamedplus'

-- List/map options
vim.opt.completeopt = { 'menu', 'menuone', 'noselect' }
vim.opt.shortmess:append('c')
vim.opt.wildignore:append({ '*.o', '*.a', '__pycache__' })
vim.opt.formatoptions:remove('o')

-- Get current value
local sw = vim.opt.shiftwidth:get()

-- Buffer/window specific
vim.opt_local.spell = true
vim.opt_local.spelllang = 'en_us'

-- Global only (like :setglobal)
vim.opt_global.laststatus = 3
```

## vim.keymap -- Key Mapping

```lua
-- Basic mappings
vim.keymap.set('n', '<leader>w', '<cmd>write<CR>', { desc = 'Save file' })
vim.keymap.set('n', '<leader>q', '<cmd>quit<CR>', { desc = 'Quit' })

-- Lua function as rhs
vim.keymap.set('n', '<leader>ff', function()
  require('telescope.builtin').find_files()
end, { desc = 'Find files' })

-- Multiple modes
vim.keymap.set({ 'n', 'v' }, '<leader>y', '"+y', { desc = 'Yank to system clipboard' })

-- All options
vim.keymap.set('n', 'lhs', 'rhs', {
  desc = 'Description for which-key',
  buffer = nil,     -- buffer number, or true for current buffer
  silent = true,    -- default: true
  noremap = true,   -- default: true (non-recursive)
  nowait = false,
  expr = false,     -- rhs is expression to evaluate
  remap = false,    -- set true for recursive mapping
  replace_keycodes = true,  -- when expr=true
})

-- Expression mapping
vim.keymap.set('n', 'j', function()
  return vim.v.count > 0 and 'j' or 'gj'
end, { expr = true, desc = 'Smart j' })

-- <Plug> mappings (for plugin authors)
vim.keymap.set('n', '<Plug>(my-action)', function()
  -- plugin action
end)

-- Delete mapping
vim.keymap.del('n', '<leader>ff')
vim.keymap.del('n', 'K', { buffer = 0 })  -- buffer-local
```

## Autocommands

```lua
-- Create autocommand group (clear=true removes old entries on re-source)
local group = vim.api.nvim_create_augroup('MyPlugin', { clear = true })

-- BufWritePre - format on save
vim.api.nvim_create_autocmd('BufWritePre', {
  group = group,
  pattern = { '*.lua', '*.py', '*.rs' },
  callback = function(args)
    vim.lsp.buf.format({ bufnr = args.buf, async = false })
  end,
})

-- FileType - filetype specific settings
vim.api.nvim_create_autocmd('FileType', {
  group = group,
  pattern = 'lua',
  callback = function()
    vim.opt_local.shiftwidth = 2
    vim.opt_local.tabstop = 2
  end,
})

-- BufEnter - when entering a buffer
vim.api.nvim_create_autocmd('BufEnter', {
  group = group,
  pattern = '*.md',
  callback = function()
    vim.opt_local.wrap = true
    vim.opt_local.spell = true
  end,
})

-- LspAttach - when LSP client attaches
vim.api.nvim_create_autocmd('LspAttach', {
  group = group,
  callback = function(args)
    local client = vim.lsp.get_client_by_id(args.data.client_id)
    if client and client.supports_method('textDocument/formatting') then
      vim.keymap.set('n', '<leader>f', function()
        vim.lsp.buf.format({ bufnr = args.buf })
      end, { buffer = args.buf, desc = 'Format buffer' })
    end
  end,
})

-- VimEnter - after startup
vim.api.nvim_create_autocmd('VimEnter', {
  group = group,
  callback = function()
    if vim.fn.argc() == 0 then
      -- Open dashboard or file picker
    end
  end,
})

-- TextYankPost - highlight on yank
vim.api.nvim_create_autocmd('TextYankPost', {
  group = group,
  callback = function()
    vim.hl.on_yank({ timeout = 200 })
  end,
})

-- Callback args table fields:
-- args.id       - autocommand id
-- args.event    - event name
-- args.group    - group id
-- args.match    - expanded <amatch>
-- args.buf      - buffer number
-- args.file     - expanded <afile>
-- args.data     - event-specific data
```

## User Commands

```lua
-- Simple command
vim.api.nvim_create_user_command('Hello', function(opts)
  print('Hello, ' .. (opts.fargs[1] or 'World'))
end, { nargs = '?', desc = 'Say hello' })

-- With range support
vim.api.nvim_create_user_command('FormatRange', function(opts)
  vim.lsp.buf.format({
    range = {
      ['start'] = { opts.line1, 0 },
      ['end'] = { opts.line2, 0 },
    },
  })
end, { range = true, desc = 'Format selection' })

-- With completion
vim.api.nvim_create_user_command('SetTheme', function(opts)
  vim.cmd.colorscheme(opts.fargs[1])
end, {
  nargs = 1,
  complete = function()
    return vim.fn.getcompletion('', 'color')
  end,
  desc = 'Set colorscheme',
})

-- Buffer-local command
vim.api.nvim_buf_create_user_command(0, 'BufOnly', function()
  -- buffer-specific command
end, { desc = 'Buffer-local command' })

-- opts table fields:
-- opts.name      - command name
-- opts.args      - raw argument string
-- opts.fargs     - split arguments table
-- opts.bang       - true if ! was used
-- opts.line1     - start line of range
-- opts.line2     - end line of range
-- opts.range     - number of items in range (0, 1, or 2)
-- opts.count     - supplied count
-- opts.reg       - supplied register
-- opts.mods      - command modifiers (split, vertical, etc.)
-- opts.smods     - structured modifiers table
```

## vim.diagnostic -- Diagnostics

```lua
-- Configure diagnostics display
vim.diagnostic.config({
  virtual_text = {
    prefix = '!',
    severity = { min = vim.diagnostic.severity.WARN },
    current_line = true,  -- 0.11+: only show on current line
  },
  signs = {
    text = {
      [vim.diagnostic.severity.ERROR] = 'E',
      [vim.diagnostic.severity.WARN] = 'W',
      [vim.diagnostic.severity.INFO] = 'I',
      [vim.diagnostic.severity.HINT] = 'H',
    },
  },
  underline = true,
  update_in_insert = false,
  severity_sort = true,
  float = {
    border = 'rounded',
    source = true,
  },
})

-- Get diagnostics
local diags = vim.diagnostic.get(buf)                       -- all for buffer
local errors = vim.diagnostic.get(buf, { severity = vim.diagnostic.severity.ERROR })
local all = vim.diagnostic.get()                             -- all buffers

-- Navigate
vim.diagnostic.goto_next({ severity = vim.diagnostic.severity.ERROR })
vim.diagnostic.goto_prev()

-- Show in float
vim.diagnostic.open_float({ scope = 'line' })  -- 'line', 'cursor', 'buffer'

-- Show in location list / quickfix
vim.diagnostic.setloclist()
vim.diagnostic.setqflist()

-- Custom diagnostic source
vim.diagnostic.set(ns, buf, {
  {
    lnum = 0,     -- 0-indexed line
    col = 0,       -- 0-indexed column
    end_lnum = 0,
    end_col = 5,
    severity = vim.diagnostic.severity.ERROR,
    message = 'Something is wrong',
    source = 'my-linter',
  },
})
```

## vim.lsp -- Language Server Protocol

```lua
-- LSP setup (0.11+ native config)
-- Place in ~/.config/nvim/lsp/<name>.lua
-- Return config table from file
vim.lsp.enable({ 'lua_ls', 'ts_ls', 'gopls' })

-- Manual client start
vim.lsp.start({
  name = 'my-lsp',
  cmd = { 'my-language-server', '--stdio' },
  root_dir = vim.fs.root(0, { '.git', 'package.json' }),
  capabilities = vim.lsp.protocol.make_client_capabilities(),
})

-- Common LSP actions
vim.lsp.buf.hover()
vim.lsp.buf.definition()
vim.lsp.buf.declaration()
vim.lsp.buf.type_definition()
vim.lsp.buf.implementation()
vim.lsp.buf.references()
vim.lsp.buf.rename()
vim.lsp.buf.code_action()
vim.lsp.buf.signature_help()
vim.lsp.buf.format({ async = false })
vim.lsp.buf.document_symbol()
vim.lsp.buf.workspace_symbol('query')

-- Get active clients
local clients = vim.lsp.get_clients({ bufnr = buf })
for _, client in ipairs(clients) do
  print(client.name, client.id)
end

-- Built-in completion (0.11+)
vim.lsp.completion.enable(true, client_id, buf, { autotrigger = true })

-- Client capabilities (merge with plugin capabilities)
local capabilities = vim.tbl_deep_extend('force',
  vim.lsp.protocol.make_client_capabilities(),
  require('cmp_nvim_lsp').default_capabilities()
)
```

## vim.treesitter -- Tree-sitter Integration

```lua
-- Get parser for buffer
local parser = vim.treesitter.get_parser(buf, 'lua')
local tree = parser:parse()[1]
local root = tree:root()

-- Get node at cursor
local node = vim.treesitter.get_node()
local node_type = node:type()
local node_text = vim.treesitter.get_node_text(node, buf)
local parent = node:parent()
local start_row, start_col, end_row, end_col = node:range()

-- Query
local query = vim.treesitter.query.parse('lua', [[
  (function_declaration
    name: (identifier) @function.name
    body: (block) @function.body)
]])

for id, node, metadata in query:iter_captures(root, buf) do
  local name = query.captures[id]
  local text = vim.treesitter.get_node_text(node, buf)
  print(name, text)
end

-- Highlighting
vim.treesitter.start(buf, 'lua')  -- enable TS highlighting
vim.treesitter.stop(buf)           -- disable

-- Folds
vim.opt.foldmethod = 'expr'
vim.opt.foldexpr = 'v:lua.vim.treesitter.foldexpr()'
vim.opt.foldlevel = 99

-- Inspect highlights at cursor
vim.treesitter.inspect_tree()      -- open TS playground
vim.show_pos()                     -- show highlight groups at cursor
```

## Plugin Development Patterns

### Standard Plugin Structure

```
my-plugin.nvim/
  lua/
    my-plugin/
      init.lua          -- M.setup(), core logic
      config.lua        -- default options, validation
      util.lua          -- helpers
    my-plugin.lua       -- optional: shorthand require
  plugin/
    my-plugin.lua       -- entry point: commands, lazy require
  ftplugin/
    lua.lua             -- filetype-specific setup
  doc/
    my-plugin.txt       -- vimdoc help file
```

### Lazy Loading Pattern

```lua
-- plugin/my-plugin.lua (loaded at startup, keep minimal)
vim.api.nvim_create_user_command('MyPlugin', function(opts)
  require('my-plugin').run(opts)  -- lazy require
end, { nargs = '*' })

vim.api.nvim_create_user_command('MyPluginSetup', function()
  require('my-plugin').setup()
end, {})
```

### Setup Pattern

```lua
-- lua/my-plugin/init.lua
local M = {}

local defaults = {
  enabled = true,
  border = 'rounded',
  mappings = {
    toggle = '<leader>m',
  },
}

function M.setup(opts)
  M.config = vim.tbl_deep_extend('force', defaults, opts or {})
  if M.config.mappings.toggle then
    vim.keymap.set('n', M.config.mappings.toggle, M.toggle, { desc = 'Toggle my plugin' })
  end
end

function M.toggle()
  -- plugin logic
end

return M
```

### lazy.nvim Plugin Spec

```lua
-- In lazy.nvim plugin spec
{
  'author/my-plugin.nvim',
  dependencies = { 'nvim-lua/plenary.nvim' },
  event = 'BufReadPost',     -- lazy load on event
  cmd = 'MyPlugin',          -- lazy load on command
  ft = { 'lua', 'python' },  -- lazy load on filetype
  keys = {                   -- lazy load on keymap
    { '<leader>m', '<cmd>MyPlugin toggle<CR>', desc = 'Toggle plugin' },
  },
  opts = {                   -- passed to setup()
    border = 'single',
  },
  config = function(_, opts)  -- custom config (default calls setup(opts))
    require('my-plugin').setup(opts)
  end,
}
```

### Health Check

```lua
-- lua/my-plugin/health.lua
local M = {}

function M.check()
  vim.health.start('my-plugin')

  -- Check dependencies
  if vim.fn.executable('rg') == 1 then
    vim.health.ok('ripgrep found')
  else
    vim.health.error('ripgrep not found', { 'Install ripgrep: brew install ripgrep' })
  end

  -- Check Neovim version
  if vim.fn.has('nvim-0.10') == 1 then
    vim.health.ok('Neovim >= 0.10')
  else
    vim.health.warn('Neovim < 0.10, some features unavailable')
  end

  -- Check config
  local config = require('my-plugin').config
  if config then
    vim.health.ok('Configuration loaded')
  else
    vim.health.info('Plugin not configured yet, call setup()')
  end
end

return M
```

## vim.fs -- File System

```lua
-- Path manipulation
vim.fs.normalize('~/config/../.config/nvim')  -- /home/user/.config/nvim
vim.fs.dirname('/path/to/file.lua')            -- /path/to
vim.fs.basename('/path/to/file.lua')           -- file.lua
vim.fs.joinpath('/path', 'to', 'file.lua')     -- /path/to/file.lua
vim.fs.abspath('relative/path')                -- /cwd/relative/path

-- Find files (search upward from buffer)
local root = vim.fs.root(0, { '.git', 'Makefile', 'package.json' })
local files = vim.fs.find('init.lua', {
  upward = true,
  path = vim.fn.expand('%:p:h'),
  type = 'file',
})
local dirs = vim.fs.find('.git', {
  upward = true,
  type = 'directory',
})
local matches = vim.fs.find(function(name)
  return name:match('%.test%.lua$')
end, { type = 'file', limit = math.huge })

-- Iterate directory
for name, type in vim.fs.dir('/path/to/dir') do
  -- type: 'file', 'directory', 'link', etc.
  print(name, type)
end

-- Standard paths
vim.fn.stdpath('config')   -- ~/.config/nvim
vim.fn.stdpath('data')     -- ~/.local/share/nvim
vim.fn.stdpath('state')    -- ~/.local/state/nvim
vim.fn.stdpath('cache')    -- ~/.cache/nvim
vim.fn.stdpath('log')      -- ~/.local/state/nvim
```

## vim.iter -- Iterator Library (0.10+)

```lua
-- From list
local doubled = vim.iter({ 1, 2, 3, 4 })
  :map(function(v) return v * 2 end)
  :totable()
-- { 2, 4, 6, 8 }

-- From pairs
local keys = vim.iter(pairs({ a = 1, b = 2, c = 3 }))
  :filter(function(_, v) return v > 1 end)
  :map(function(k) return k end)
  :totable()

-- Chaining
vim.iter(ipairs(items))
  :map(function(_, item) return item.name end)
  :filter(function(name) return name ~= '' end)
  :each(function(name) print(name) end)

-- Take and skip
vim.iter({ 1, 2, 3, 4, 5 }):take(3):totable()     -- { 1, 2, 3 }
vim.iter({ 1, 2, 3, 4, 5 }):skip(2):totable()      -- { 3, 4, 5 }

-- With predicates (0.11+)
vim.iter({ 1, 2, 3, 4 }):take(function(v) return v < 3 end):totable()  -- { 1, 2 }

-- Fold/reduce
local sum = vim.iter({ 1, 2, 3 }):fold(0, function(acc, v) return acc + v end)

-- Find
local found = vim.iter({ 'foo', 'bar', 'baz' }):find(function(v) return v:match('ba') end)

-- Enumerate
vim.iter({ 'a', 'b', 'c' }):enumerate():each(function(i, v)
  print(i, v)
end)

-- From custom iterator
local function range(start, stop)
  local i = start - 1
  return function()
    i = i + 1
    if i <= stop then return i end
  end
end
vim.iter(range(1, 5)):totable()  -- { 1, 2, 3, 4, 5 }
```

## vim.uv -- libuv Bindings

```lua
-- CRITICAL: Cannot call vim.api.* directly from uv callbacks
-- Use vim.schedule() or vim.schedule_wrap() to defer

-- Timer
local timer = vim.uv.new_timer()
timer:start(1000, 0, vim.schedule_wrap(function()
  print('Fired after 1 second')
  timer:stop()
  timer:close()
end))

-- Repeating timer
local interval = vim.uv.new_timer()
interval:start(0, 500, vim.schedule_wrap(function()
  -- runs every 500ms
end))

-- File watching
local handle = vim.uv.new_fs_event()
handle:start('/path/to/file', {}, vim.schedule_wrap(function(err, filename, events)
  if events.change then
    vim.cmd('checktime')  -- reload if changed
  end
end))

-- Async process
local stdout = vim.uv.new_pipe()
local handle, pid = vim.uv.spawn('ls', {
  args = { '-la' },
  stdio = { nil, stdout, nil },
}, vim.schedule_wrap(function(code, signal)
  stdout:close()
  print('Process exited:', code)
end))

stdout:read_start(vim.schedule_wrap(function(err, data)
  if data then print(data) end
end))
```

## Scheduling and Async

```lua
-- Schedule to main loop (safe for vim.api calls)
vim.schedule(function()
  vim.api.nvim_echo({ { 'Safe from callback', 'Normal' } }, true, {})
end)

-- Wrap callback to auto-schedule
local safe_cb = vim.schedule_wrap(function(result)
  vim.api.nvim_buf_set_lines(0, 0, -1, false, { result })
end)

-- Deferred execution (one-shot timer + schedule)
vim.defer_fn(function()
  print('Runs after 500ms')
end, 500)

-- Wait with timeout
local success = vim.wait(5000, function()
  return some_condition
end, 100)  -- check every 100ms, timeout after 5000ms
```
