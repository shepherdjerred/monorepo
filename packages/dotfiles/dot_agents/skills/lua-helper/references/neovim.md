# Neovim Lua

Read this when configuring Neovim, writing plugins, using LSP or diagnostics, spawning processes, or loading project-local configuration.

## Runtime contract

Neovim guarantees a permanent Lua 5.1 interface and may run LuaJIT or a compatible fork. Check `jit` before using implementation-specific extensions.

## LSP

Current native setup:

```lua
vim.lsp.config("example", {
  cmd = { "example-language-server" },
  filetypes = { "example" },
})
vim.lsp.enable("example")
```

nvim-lspconfig remains maintained for server definitions. Its legacy `require('lspconfig').setup` framework is deprecated.

Use `cmp_nvim_lsp.default_capabilities()` only when nvim-cmp is intentionally the completion frontend; it can change built-in omnifunc behavior.

## Diagnostics and highlighting

```lua
vim.diagnostic.jump({ count = 1 })
vim.diagnostic.jump({ count = -1 })
```

Use `vim.hl.hl_op()` for yank highlighting. Older `vim.hl.on_yank` and `vim.diagnostic.goto_next` / `goto_prev` are deprecated in 0.12.

For whole-line range formatting, end at `{ opts.line2, -1 }` rather than column zero of the last line.

## Options

Set scoped options with:

```lua
vim.api.nvim_set_option_value("modifiable", false, { buf = buffer })
```

Do not use deprecated `nvim_buf_set_option` in new code.

## Processes

Prefer `vim.system` for ordinary subprocesses:

```lua
local result = vim.system({ "git", "status", "--short" }, { text = true }):wait()
if result.code ~= 0 then
  error(result.stderr)
end
```

String-form `vim.fn.system` invokes a shell. Use it only when shell syntax is deliberate and all dynamic input is controlled.

Use libuv directly only when its event-loop or handle-level API is required. Check constructor/start/spawn/read callback errors and close every handle.

## Trust

Project-local config through `exrc` executes code. Use `:trust` and `vim.secure.read`; understand that any trust workflow has a time-of-check/time-of-use boundary when files can change afterward.

## Primary documentation

- [Neovim 0.11 news](https://neovim.io/doc/user/news-0.11.html)
- [Neovim 0.12 news](https://neovim.io/doc/user/news-0.12.html)
- [Lua interface](https://neovim.io/doc/user/lua.html)
- [Lua guide](https://neovim.io/doc/user/lua-guide.html)
- [API](https://neovim.io/doc/user/api.html)
- [LSP](https://neovim.io/doc/user/lsp.html)
- [Diagnostics](https://neovim.io/doc/user/diagnostic.html)
- [Tree-sitter](https://neovim.io/doc/user/treesitter.html)
- [Options](https://neovim.io/doc/user/options.html)
- [Deprecated APIs](https://neovim.io/doc/user/deprecated.html)
- [Trust](https://neovim.io/doc/user/starting.html#trust)
- [Neovim latest release](https://github.com/neovim/neovim/releases/latest)
