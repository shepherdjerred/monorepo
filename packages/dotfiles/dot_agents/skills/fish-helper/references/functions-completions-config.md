# Fish functions, completions, and configuration

Read this when defining functions, abbreviations, completions, bindings, events, prompts, themes, or startup configuration.

## Functions

Use `function` for logic and `funcsave` only when intentional user state should be written to the function path. Version-controlled functions should remain source-managed.

## Abbreviations

Abbreviations expand interactive input. `--set-cursor` uses `%` unless another marker is configured; the expansion must contain it.

## Completions

Use repeated `--command` or brace expansion for multiple command names. `--command=docker,podman` registers the literal comma-containing name.

Bundled completions are embedded in Fish 4.8. `status list-files` lists embedded files. Custom completions still use the documented completion path and should be fast and side-effect-free.

## Events

Functions can observe variables, signals, process exits, generic events, and newer events such as `fish_posterror`, `fish_focus_in`, and `fish_focus_out`.

Variable updates can be coalesced and same-value sets can still produce events. Handler order is unspecified. Use an explicit coordinator when ordering matters.

## Startup

Config search includes user `conf.d`, system config, and user/vendor data directories with documented priority and filename shadowing. Environment required in noninteractive shells belongs before `status is-interactive; or return`.

## Prompt

Transient prompt is enabled with:

```fish
set -g fish_transient_prompt 1
```

Prompt functions receive `--final-rendering` on the final repaint. They should avoid slow network/process calls and remain deterministic.

## Theme

Use `fish_config theme choose`. Theme files contain name and value separated by whitespace. Universal color variables can disable adaptive light/dark behavior.

## Primary documentation

- [Interactive use](https://fishshell.com/docs/current/interactive.html)
- [Completions](https://fishshell.com/docs/current/completions.html)
- [Prompt](https://fishshell.com/docs/current/prompt.html)
- [Design](https://fishshell.com/docs/current/design.html)
- [Terminal compatibility](https://fishshell.com/docs/current/terminal-compatibility.html)
- [abbr](https://fishshell.com/docs/current/cmds/abbr.html)
- [complete](https://fishshell.com/docs/current/cmds/complete.html)
- [function](https://fishshell.com/docs/current/cmds/function.html)
- [functions](https://fishshell.com/docs/current/cmds/functions.html)
- [funcsave](https://fishshell.com/docs/current/cmds/funcsave.html)
- [funced](https://fishshell.com/docs/current/cmds/funced.html)
- [bind](https://fishshell.com/docs/current/cmds/bind.html)
- [emit](https://fishshell.com/docs/current/cmds/emit.html)
- [fish_add_path](https://fishshell.com/docs/current/cmds/fish_add_path.html)
- [fish_config](https://fishshell.com/docs/current/cmds/fish_config.html)
- [set_color](https://fishshell.com/docs/current/cmds/set_color.html)
- [fish_key_reader](https://fishshell.com/docs/current/cmds/fish_key_reader.html)
