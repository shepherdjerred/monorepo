# Lua core language and LuaJIT

Read this when writing portable Lua, selecting a language version, or considering a LuaJIT extension.

## Lua 5.5 and 5.4

Lua 5.5 adds explicit global declarations, named varargs, table-creation support, and runtime/collector changes. Lua 5.4 introduced generational collection, to-be-closed variables, and const locals. Link the active bug page when exact correctness matters because point releases publish errata.

`math.type` arrived in Lua 5.3, not 5.4. `table.move`, `table.unpack`, `rawlen`, metamethods, and module search APIs vary by version; check the target manual.

## LuaJIT

LuaJIT is actively maintained as a rolling release from its 2.1 branch. Upstream does not publish official binary/tarball releases. It provides a Lua 5.1-compatible interface plus extensions.

`goto` and labels are always-enabled Lua 5.2 extensions in LuaJIT. Some library compatibility features require `LUAJIT_ENABLE_LUA52COMPAT`. FFI is LuaJIT-specific and must not be assumed on every Lua 5.1-compatible host.

Do not quote a universal LuaJIT speedup. Results depend on workload, architecture, traces, FFI, host integration, and warmup.

## To-be-closed values

Check resource creation before assigning a to-be-closed value:

```lua
local opened, open_error = io.open(path, "rb")
if not opened then
  return nil, open_error
end
local file <close> = opened
```

This is Lua 5.4+ syntax and does not apply to Neovim's Lua 5.1 interface.

## Loading code

When the target Lua version supports mode/environment parameters, accept untrusted code only as text and provide a constrained environment. Binary chunks are code and must not be accepted from untrusted sources.

## Process execution

`os.execute` crosses a shell boundary. Never concatenate untrusted values. Inspect the version-specific returned status tuple; it differs across Lua versions.

## Primary documentation

- [Lua versions](https://www.lua.org/versions.html)
- [Lua 5.5 manual](https://www.lua.org/manual/5.5/manual.html)
- [Lua 5.5 readme](https://www.lua.org/manual/5.5/readme.html)
- [Lua 5.4 manual](https://www.lua.org/manual/5.4/manual.html)
- [Lua 5.4 readme](https://www.lua.org/manual/5.4/readme.html)
- [Lua bugs](https://www.lua.org/bugs.html)
- [LuaJIT status](https://luajit.org/status.html)
- [LuaJIT extensions](https://luajit.org/extensions.html)
- [Running LuaJIT](https://luajit.org/running.html)
- [Installing LuaJIT](https://luajit.org/install.html)
- [LuaJIT FFI](https://luajit.org/ext_ffi.html)
