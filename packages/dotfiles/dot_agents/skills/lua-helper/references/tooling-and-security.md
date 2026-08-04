# Lua tooling and security

Read this when configuring LuaLS, formatting, linting, tests, LuaRocks, plugin managers, or code-loading and shell trust boundaries.

## LuaLS

LuaLS supports `.luarc.json` / `.luarc.jsonc`, structured annotations, diagnostics, workspace libraries, addons, and stricter checking modes.

Use addons for host libraries when available. Built-in addons are planned for removal, so treat addon selection as external project configuration. Loading the complete Neovim runtime into `workspace.library` is valid but broad.

Annotations improve tooling; they do not validate data at runtime. Teal is a separate statically typed Lua dialect, not another name for LuaLS annotations.

## Format, lint, and test

- StyLua: formatter with check mode.
- Luacheck: maintained, but its hosted “stable” docs can lag the GitHub release.
- Selene: configurable static analyzer.
- Busted: behavior-driven test framework.
- LuaUnit: lightweight xUnit tests and current Lua 5.5 support.
- Plenary: common Neovim utilities/testing dependency; use when host integration is necessary.

Pin tool releases in reproducible environments. Do not infer current versions from a stale hosted-doc banner.

## LuaRocks

Installing a rock downloads and executes package/build logic. Review the rockspec, source, native compilation, and transitive dependencies. Pin versions and verify the repository/index policy.

`rocks.nvim` moved from `nvim-neorocks` to `lumen-oss`; follow the current repository before writing ownership or install guidance.

## Neovim plugins

nvim-lspconfig remains active. `cmp-nvim-lsp` capabilities belong to nvim-cmp integrations, not every LSP client. lazy.nvim remains an active plugin manager; installation and update execute third-party code.

## Shell and code loading

- Prefer argv-based host subprocess APIs.
- Never concatenate untrusted input into `os.execute`, `vim.fn.system`, or a shell string.
- Accept untrusted Lua only as text with a constrained environment where supported.
- Do not load untrusted binary chunks.
- Treat LuaJIT FFI as native code access.

## Primary documentation

- [LuaRocks](https://luarocks.org/)
- [LuaRocks releases](https://github.com/luarocks/luarocks/releases/latest)
- [LuaLS configuration](https://luals.github.io/wiki/configuration/)
- [LuaLS annotations](https://luals.github.io/wiki/annotations/)
- [LuaLS diagnostics](https://luals.github.io/wiki/diagnostics/)
- [LuaLS addons](https://luals.github.io/wiki/addons/)
- [LuaLS workspace library](https://luals.github.io/wiki/settings/#workspace-library)
- [LuaLS type checking](https://luals.github.io/wiki/type-checking/)
- [LuaLS releases](https://github.com/LuaLS/lua-language-server/releases/latest)
- [StyLua](https://github.com/JohnnyMorganz/StyLua)
- [StyLua releases](https://github.com/JohnnyMorganz/StyLua/releases/latest)
- [Luacheck](https://github.com/lunarmodules/luacheck)
- [Luacheck releases](https://github.com/lunarmodules/luacheck/releases/latest)
- [Luacheck hosted docs](https://luacheck.readthedocs.io/en/stable/)
- [Selene](https://kampfkarren.github.io/selene/)
- [Selene releases](https://github.com/Kampfkarren/selene/releases/latest)
- [Busted](https://lunarmodules.github.io/busted/)
- [Busted releases](https://github.com/lunarmodules/busted/releases/latest)
- [LuaUnit](https://luaunit.readthedocs.io/en/latest/)
- [LuaUnit releases](https://github.com/bluebird75/luaunit/releases/latest)
- [Teal](https://teal-language.org/book/)
- [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig)
- [cmp-nvim-lsp](https://github.com/hrsh7th/cmp-nvim-lsp)
- [lazy.nvim](https://github.com/folke/lazy.nvim)
- [rocks.nvim](https://github.com/lumen-oss/rocks.nvim)
- [Plenary](https://github.com/nvim-lua/plenary.nvim)
