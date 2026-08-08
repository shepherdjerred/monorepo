---
name: lua-helper
description: Current Lua guidance for portable Lua, LuaJIT, Neovim's Lua interface, WezTerm configuration, LuaLS, formatting, linting, testing, and security. Use when writing or reviewing Lua, Neovim plugins/config, WezTerm config, rockspecs, or Lua tooling.
---

# Lua Helper

Identify the host before writing Lua. Portable Lua 5.5, Neovim's Lua 5.1 interface, optional LuaJIT extensions, and WezTerm's Lua 5.4 runtime have different APIs and semantics.

## Current baselines

Verified 2026-08-03:

| Host or tool | Current baseline | Compatibility boundary |
| --- | --- | --- |
| Lua | 5.5.0; maintained 5.4 line at 5.4.8 | Version-gate APIs newer than the project's minimum |
| LuaJIT | Active rolling 2.1 branch | Lua 5.1-compatible with implementation extensions and build flags |
| Neovim | 0.12.4 | Permanent Lua 5.1 interface; may use LuaJIT or a compatible fork |
| WezTerm | Stable release still dated 2024 | Embeds Lua 5.4; online docs can describe nightly-only APIs |
| LuaLS | 3.18.2 | Annotations and diagnostics are tooling, not runtime validation |
| StyLua | 2.5.2 | Pin/configure per repository |
| LuaRocks | 3.13.0 | Installation runs package build logic and mutates environments |

Read [references/releases.md](references/releases.md) for the 68-page research ledger. Read [references/core-language.md](references/core-language.md) for portable Lua and LuaJIT differences. Read [references/neovim.md](references/neovim.md) for current LSP, diagnostics, process, trust, and buffer APIs. Read [references/wezterm.md](references/wezterm.md) for configuration evaluation, strict mode, events, subprocesses, and mux domains. Read [references/tooling-and-security.md](references/tooling-and-security.md) for LuaLS, formatters, linters, tests, rocks, and security.

## Select the runtime

Before using an API, establish:

1. Lua language/interface version.
2. Whether the runtime is PUC Lua, LuaJIT, or a host embedding.
3. Host application version and stable/nightly channel.
4. Tooling version and project configuration.

In Neovim, target the documented Lua 5.1 interface and check `jit` before LuaJIT-specific behavior. In WezTerm, target Lua 5.4 and check the API's “Since” version against the installed binary.

## Error discipline

Lua APIs commonly return `nil, error` or status tuples. Check every open, read, write, close, subprocess, and host callback result whose failure matters.

```lua
local function read_file(path)
  local file, open_error = io.open(path, "rb")
  if not file then
    return nil, open_error
  end

  local content, read_error = file:read("*a")
  local close_ok, close_error = file:close()
  if not content then
    return nil, read_error
  end
  if not close_ok then
    return nil, close_error
  end
  return content
end
```

Do not bind an unchecked `io.open` result as a to-be-closed value. Preserve close failures when durability matters.

## Tables and sequences

The length operator does not count arbitrary table keys. For a table with holes, `#table` returns a valid border and is not a reliable element count. Model sequences as contiguous integer keys or count explicitly.

Version-gate `table.move`, `table.unpack`, `rawlen`, `__pairs`, and related APIs. Lua 5.1 uses global `unpack`; LuaJIT compatibility libraries can depend on build flags.

Avoid memoization keys built from `table.concat({...})`: they reject many value types and can collide. Use nested tables keyed by arguments or a deliberately encoded, restricted input domain.

## Neovim

Current native LSP setup uses `vim.lsp.config` and `vim.lsp.enable`. This replaces nvim-lspconfig's deprecated legacy `require('lspconfig').setup` framework; nvim-lspconfig itself remains maintained and supplies server definitions.

Use current APIs:

- `vim.hl.hl_op()` for yank highlighting.
- `vim.diagnostic.jump({ count = 1 })` and negative count for navigation.
- `vim.api.nvim_set_option_value(name, value, { buf = buffer })` for scoped options.
- `vim.system({ program, argument }, { text = true }):wait()` for ordinary subprocesses, checking `code` and `stderr`.

Use `:trust` and `vim.secure` for project-local configuration. `exrc` executes project code and is a trust boundary.

## WezTerm

Create the configuration with strict mode so invalid options fail:

```lua
local wezterm = require("wezterm")
local config = wezterm.config_builder()
config:set_strict_mode(true)

return config
```

WezTerm may evaluate configuration repeatedly. Keep top-level evaluation idempotent and free of side effects such as spawning processes. Config precedence includes CLI and environment overrides before standard paths.

`wezterm.run_child_process` returns success, stdout, and stderr. Inspect success. Returning `false` from a `wezterm.on` callback stops later callbacks and the default action.

## Tooling

```bash
stylua --check .
luacheck .
selene .
busted
```

Use the tools configured by the project. Choose Luacheck or Selene deliberately instead of layering both without purpose. Use Busted for behavior-style suites or LuaUnit for lightweight xUnit tests. Use headless Neovim/Plenary only when host integration is part of the contract.

LuaLS supports `.luarc.json` / `.luarc.jsonc`, annotations, diagnostics, addons, and stricter type-checking modes. Loading the entire Neovim runtime as a workspace library is valid but broad; prefer an addon or narrow explicit paths when sufficient.

## Security

- Load untrusted source only as text with a constrained environment; never accept untrusted binary chunks.
- Avoid shell construction in `os.execute` and string-form `vim.fn.system`. Never concatenate untrusted input into a shell command.
- WezTerm and Neovim config execute arbitrary code. Keep secrets out of config and use protected identity/agent mechanisms.
- WezTerm config can execute more than once; repeated evaluation magnifies side effects.
- LuaRocks installation executes rock build/package logic. Inspect sources and rockspecs and pin versions in reproducible environments.
- LuaJIT FFI is an implementation extension with native-memory safety implications; do not assume it exists or is sandboxed.

## Review checklist

- Identify portable Lua, LuaJIT, Neovim, or WezTerm before choosing APIs.
- Version-gate language, host, and online-documentation features.
- Check file, process, callback, and cleanup results.
- Do not use `#` as a general map size or unsafe concatenated memo keys.
- Use current Neovim LSP, highlight, diagnostic, option, and process APIs.
- Make WezTerm config strict, idempotent, and side-effect free at top level.
- Configure LuaLS and one intentional lint/test workflow.
- Treat project config, shells, rocks, binary chunks, and FFI as trust boundaries.
- Preserve the distinction between Neovim's Lua 5.1 interface and optional LuaJIT implementation.
