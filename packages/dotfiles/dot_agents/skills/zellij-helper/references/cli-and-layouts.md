# Zellij CLI and layouts

Read this when scripting sessions, panes, tabs, CLI actions, layouts, or KDL.

## Automation primitives

Prefer:

- `--short --no-formatting` for session names,
- `--session NAME` for every out-of-session action,
- JSON pane/tab listings,
- returned pane/tab IDs,
- `send-keys` and `write-chars` for readable input,
- blocking run flags,
- `attach --create-background` for detached creation.

Do not background an attached client, sleep, and then send untargeted actions.

## CLI versus KDL

`zellij action` exposes the actions listed in CLI help. KDL keybindings use a different CamelCase action set. A keybinding action is not proof of a corresponding CLI subcommand.

## Plugin URLs

Use an absolute file path:

```text
file:/Users/example/.config/zellij/plugins/example.wasm
```

Do not use `file:~/...`; tilde expansion is not the documented plugin URL schema.

## Layout configuration

Global layout configuration such as `session_name` and `attach_to_session` sits at the KDL document root. Percent geometry values are quoted strings.

Relative working directories compose from pane through tab and layout to the invocation directory. Use absolute or deliberately composed paths in automation.

## Existing session behavior

Starting Zellij with a layout inside a current session can add tabs to it. Use the documented option for a new session with the layout when session isolation is required.

## Primary documentation

- [Commands](https://zellij.dev/documentation/commands.html)
- [Command-line options](https://zellij.dev/documentation/command-line-options.html)
- [Controlling through CLI](https://zellij.dev/documentation/controlling-zellij-through-cli.html)
- [Run and edit](https://zellij.dev/documentation/zellij-run-and-edit.html)
- [CLI actions](https://zellij.dev/documentation/cli-actions.html)
- [Plugin and pipe CLI](https://zellij.dev/documentation/zellij-plugin-and-pipe.html)
- [Subscribe](https://zellij.dev/documentation/zellij-subscribe.html)
- [CLI recipes](https://zellij.dev/documentation/cli-recipes.html)
- [Programmatic control](https://zellij.dev/documentation/programmatic-control.html)
- [Layouts](https://zellij.dev/documentation/layouts.html)
- [Creating a layout](https://zellij.dev/documentation/creating-a-layout.html)
- [Swap layouts](https://zellij.dev/documentation/swap-layouts.html)
- [Layouts with config](https://zellij.dev/documentation/layouts-with-config.html)
- [Layout examples](https://zellij.dev/documentation/layout-examples.html)
