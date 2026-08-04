# Lua ecosystem release lifecycle

Read this when upgrading Lua, Neovim, WezTerm, LuaLS, LuaRocks, or the formatting/testing toolchain.

## Version boundaries

- Lua 5.5.0 is current; 5.4.8 is the latest 5.4 maintenance release.
- LuaJIT is a rolling 2.1 branch rather than a conventional official tarball release.
- Neovim 0.12.4 is current stable and guarantees Lua 5.1 interface semantics.
- WezTerm's online docs can be ahead of its 2024 stable binary; check “Since” annotations.
- Lua tooling release pages are more current than some hosted “stable” documentation.

## Research ledger

The following 68 primary pages were fetched and inspected:

1. [Lua versions](https://www.lua.org/versions.html)
2. [Lua 5.5 manual](https://www.lua.org/manual/5.5/manual.html)
3. [Lua 5.5 readme](https://www.lua.org/manual/5.5/readme.html)
4. [Lua 5.4 manual](https://www.lua.org/manual/5.4/manual.html)
5. [Lua 5.4 readme](https://www.lua.org/manual/5.4/readme.html)
6. [Lua bugs](https://www.lua.org/bugs.html)
7. [LuaJIT status](https://luajit.org/status.html)
8. [LuaJIT extensions](https://luajit.org/extensions.html)
9. [Running LuaJIT](https://luajit.org/running.html)
10. [Installing LuaJIT](https://luajit.org/install.html)
11. [LuaJIT FFI](https://luajit.org/ext_ffi.html)
12. [LuaJIT repository](https://github.com/LuaJIT/LuaJIT)
13. [Neovim 0.11 news](https://neovim.io/doc/user/news-0.11.html)
14. [Neovim 0.12 news](https://neovim.io/doc/user/news-0.12.html)
15. [Neovim Lua](https://neovim.io/doc/user/lua.html)
16. [Neovim Lua guide](https://neovim.io/doc/user/lua-guide.html)
17. [Neovim API](https://neovim.io/doc/user/api.html)
18. [Neovim LSP](https://neovim.io/doc/user/lsp.html)
19. [Neovim diagnostics](https://neovim.io/doc/user/diagnostic.html)
20. [Neovim Tree-sitter](https://neovim.io/doc/user/treesitter.html)
21. [Neovim options](https://neovim.io/doc/user/options.html)
22. [Neovim deprecated APIs](https://neovim.io/doc/user/deprecated.html)
23. [Neovim trust](https://neovim.io/doc/user/starting.html#trust)
24. [Neovim latest release](https://github.com/neovim/neovim/releases/latest)
25. [WezTerm config files](https://wezterm.org/config/files.html)
26. [WezTerm Lua](https://wezterm.org/config/lua/general.html)
27. [config_builder](https://wezterm.org/config/lua/wezterm/config_builder.html)
28. [wezterm.on](https://wezterm.org/config/lua/wezterm/on.html)
29. [action_callback](https://wezterm.org/config/lua/wezterm/action_callback.html)
30. [run_child_process](https://wezterm.org/config/lua/wezterm/run_child_process.html)
31. [mux.spawn_window](https://wezterm.org/config/lua/wezterm.mux/spawn_window.html)
32. [window.perform_action](https://wezterm.org/config/lua/window/perform_action.html)
33. [SSH domains](https://wezterm.org/config/lua/config/ssh_domains.html)
34. [Unix domains](https://wezterm.org/config/lua/config/unix_domains.html)
35. [Default GUI startup arguments](https://wezterm.org/config/lua/config/default_gui_startup_args.html)
36. [WezTerm multiplexing](https://wezterm.org/multiplexing.html)
37. [WezTerm changelog](https://wezterm.org/changelog.html)
38. [json_parse](https://wezterm.org/config/lua/wezterm/json_parse.html)
39. [target_triple](https://wezterm.org/config/lua/wezterm/target_triple.html)
40. [SshDomain](https://wezterm.org/config/lua/SshDomain.html)
41. [procinfo.pid](https://wezterm.org/config/lua/wezterm.procinfo/pid.html)
42. [WezTerm latest release](https://github.com/wezterm/wezterm/releases/latest)
43. [LuaRocks](https://luarocks.org/)
44. [LuaRocks releases](https://github.com/luarocks/luarocks/releases/latest)
45. [LuaLS configuration](https://luals.github.io/wiki/configuration/)
46. [LuaLS annotations](https://luals.github.io/wiki/annotations/)
47. [LuaLS diagnostics](https://luals.github.io/wiki/diagnostics/)
48. [LuaLS addons](https://luals.github.io/wiki/addons/)
49. [LuaLS workspace library](https://luals.github.io/wiki/settings/#workspace-library)
50. [LuaLS type checking](https://luals.github.io/wiki/type-checking/)
51. [LuaLS releases](https://github.com/LuaLS/lua-language-server/releases/latest)
52. [StyLua](https://github.com/JohnnyMorganz/StyLua)
53. [StyLua releases](https://github.com/JohnnyMorganz/StyLua/releases/latest)
54. [Luacheck](https://github.com/lunarmodules/luacheck)
55. [Luacheck releases](https://github.com/lunarmodules/luacheck/releases/latest)
56. [Luacheck hosted docs](https://luacheck.readthedocs.io/en/stable/)
57. [Selene](https://kampfkarren.github.io/selene/)
58. [Selene releases](https://github.com/Kampfkarren/selene/releases/latest)
59. [Busted](https://lunarmodules.github.io/busted/)
60. [Busted releases](https://github.com/lunarmodules/busted/releases/latest)
61. [LuaUnit](https://luaunit.readthedocs.io/en/latest/)
62. [LuaUnit releases](https://github.com/bluebird75/luaunit/releases/latest)
63. [Teal](https://teal-language.org/book/)
64. [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig)
65. [cmp-nvim-lsp](https://github.com/hrsh7th/cmp-nvim-lsp)
66. [lazy.nvim](https://github.com/folke/lazy.nvim)
67. [rocks.nvim](https://github.com/lumen-oss/rocks.nvim)
68. [Plenary](https://github.com/nvim-lua/plenary.nvim)
