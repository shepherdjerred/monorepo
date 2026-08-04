# Zellij configuration and resurrection

Read this when changing keybindings, options, themes, session metadata, or resurrection behavior.

## Keybindings

Retain defaults and selectively unbind unless the configuration defines every used mode, including exits and confirmation bindings. `clear-defaults=true` with an incomplete map can make modes unusable.

## Session behavior

`mirror_session` synchronizes attached-client cursor/view state. Use the active-sync-tab action to send input to multiple panes.

The web port is configurable; current default is 8082. A sample 8080 is a custom value, not the default.

## Serialization

Defaults keep viewport serialization off because it increases storage/resource use and can capture terminal output. `serialization_interval` and session metadata options should reflect retention and privacy policy.

Resurrection restores commands suspended by default. Do not enable forced automatic rerun for a generic workflow.

## Themes and UI

Current theme options include dark/light theme selection and automatic switching. `hide_session_name` is nested inside `ui.pane_frames`.

## Primary documentation

- [Rebinding keys](https://zellij.dev/documentation/rebinding-keys.html)
- [Keybinding presets](https://zellij.dev/documentation/keybinding-presets.html)
- [Changing modifiers](https://zellij.dev/documentation/changing-modifiers.html)
- [Configuration](https://zellij.dev/documentation/configuration.html)
- [Options](https://zellij.dev/documentation/options.html)
- [Keybindings](https://zellij.dev/documentation/keybindings.html)
- [Keybinding modes](https://zellij.dev/documentation/keybindings-modes.html)
- [Binding syntax](https://zellij.dev/documentation/keybindings-binding.html)
- [Keys](https://zellij.dev/documentation/keybindings-keys.html)
- [Possible actions](https://zellij.dev/documentation/keybindings-possible-actions.html)
- [Shared bindings](https://zellij.dev/documentation/keybindings-shared.html)
- [Themes](https://zellij.dev/documentation/themes.html)
- [Theme list](https://zellij.dev/documentation/theme-list.html)
- [Session resurrection](https://zellij.dev/documentation/session-resurrection.html)
