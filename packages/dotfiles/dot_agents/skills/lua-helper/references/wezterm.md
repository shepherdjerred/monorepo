# WezTerm Lua configuration

Read this when writing WezTerm config, events, key actions, subprocesses, multiplexing, SSH domains, or platform-specific settings.

## Evaluation and precedence

WezTerm evaluates Lua 5.4 configuration and may evaluate it repeatedly. Top-level code must be idempotent and should not spawn processes, mutate external files, or perform other repeated side effects.

Config precedence includes `--config-file` and `WEZTERM_CONFIG_FILE` before standard paths. Diagnose the selected file rather than assuming `~/.wezterm.lua`.

## Strict configuration

```lua
local wezterm = require("wezterm")
local config = wezterm.config_builder()
config:set_strict_mode(true)

return config
```

Strict mode turns invalid option names and values into failures.

## Events and actions

`wezterm.on` registers callbacks. Returning `false` stops subsequent callbacks and the default action. `wezterm.action_callback` creates key-action callbacks, and `window:perform_action` dispatches actions programmatically.

## Processes

```lua
local success, stdout, stderr = wezterm.run_child_process({ "git", "status", "--short" })
if not success then
  error(stderr)
end
```

Never ignore the success boolean or construct a shell command from untrusted input.

## Multiplexing

Unix domains provide local mux connectivity. SSH domains can use the WezTerm mux server; remote mux requires WezTerm on the remote host. `default_gui_startup_args = { 'connect', 'unix' }` remains supported.

Keep SSH secrets out of config. `ssh_option.identityfile` can point to a protected key, while an SSH agent is preferable where the environment supports it.

## Version gates

The current stable binary remains from 2024 while online documentation includes newer APIs. Check each page's “Since” annotation and the installed `wezterm --version` before adopting it.

## Primary documentation

- [Configuration files](https://wezterm.org/config/files.html)
- [Lua overview](https://wezterm.org/config/lua/general.html)
- [config_builder](https://wezterm.org/config/lua/wezterm/config_builder.html)
- [wezterm.on](https://wezterm.org/config/lua/wezterm/on.html)
- [action_callback](https://wezterm.org/config/lua/wezterm/action_callback.html)
- [run_child_process](https://wezterm.org/config/lua/wezterm/run_child_process.html)
- [mux.spawn_window](https://wezterm.org/config/lua/wezterm.mux/spawn_window.html)
- [window.perform_action](https://wezterm.org/config/lua/window/perform_action.html)
- [SSH domains](https://wezterm.org/config/lua/config/ssh_domains.html)
- [Unix domains](https://wezterm.org/config/lua/config/unix_domains.html)
- [Default GUI startup arguments](https://wezterm.org/config/lua/config/default_gui_startup_args.html)
- [Multiplexing](https://wezterm.org/multiplexing.html)
- [Changelog](https://wezterm.org/changelog.html)
- [json_parse](https://wezterm.org/config/lua/wezterm/json_parse.html)
- [target_triple](https://wezterm.org/config/lua/wezterm/target_triple.html)
- [SshDomain](https://wezterm.org/config/lua/SshDomain.html)
- [procinfo.pid](https://wezterm.org/config/lua/wezterm.procinfo/pid.html)
- [Latest WezTerm release](https://github.com/wezterm/wezterm/releases/latest)
