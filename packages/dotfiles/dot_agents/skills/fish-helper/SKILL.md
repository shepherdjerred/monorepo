---
name: fish-helper
description: Current Fish shell scripting, functions, abbreviations, completions, variables, events, configuration, plugins, testing, and safety guidance. Use when writing or reviewing Fish config, `.fish` scripts, completions, functions, prompts, or plugin setup.
---

# Fish Helper

Write Fish as Fish rather than translated POSIX shell. Preserve argv boundaries, propagate statuses, make configuration idempotent, and distinguish optional integrations from required tools.

## Current baseline

Verified against Fish 4.8.1 on 2026-08-03:

```fish
fish --version
```

Fish 4.8 changed installed/embedded completion and function layout, added `cd -L/-P`, and removed automatic `__fish_initialized` universal creation. Fish 4.7 changed noninteractive theme initialization; Fish 4.6 changed emoji width and added prompt environment controls; Fish 4.5 mainly fixed Vi-mode regressions.

Read [references/releases.md](references/releases.md) for the 51-page research ledger. Read [references/syntax-and-safety.md](references/syntax-and-safety.md) for variables, argv, statuses, reading, tracing, temp directories, and shell boundaries. Read [references/functions-completions-config.md](references/functions-completions-config.md) for functions, events, abbreviations, completions, startup, prompts, and themes. Read [references/plugins-and-testing.md](references/plugins-and-testing.md) for Fisher, popular plugins, testing, and installation security.

## Variables and environment

Use exported global variables in version-controlled config for child-process environment:

```fish
set -gx EDITOR nvim
fish_add_path $HOME/.local/bin
```

Universal variables remain supported, but Fish 4.3 stopped creating several user-facing defaults as universal values. Use universal state only when cross-session persistence is intentional. `set -U EDITOR vim` is not exported; `set -Ux` is persistent and exported but can create hidden machine state.

Use `fish_add_path` for idempotent path changes. Do not replace `PATH` with a short hard-coded list or prepend the same directory every time config is sourced.

Fish supports command-scoped environment overrides:

```fish
MODE=test command --flag
```

Standalone assignment still uses `set`.

## Preserve argv

Accept commands as the remaining arguments and invoke them directly:

```fish
function retry --description 'Retry a command with exact arguments'
    argparse 'n/max-attempts=' -- $argv
    or return

    set -l max_attempts 3
    if set -q _flag_max_attempts
        set max_attempts $_flag_max_attempts
    end
    if test (count $argv) -eq 0
        echo 'retry: missing command' >&2
        return 2
    end

    for attempt in (seq $max_attempts)
        $argv
        set -l command_status $status
        if test $command_status -eq 0
            return 0
        end
        if test $attempt -eq $max_attempts
            return $command_status
        end
    end
end
```

Do not turn command arguments into source text with `eval`. Invoke the argv list directly or call an exact function.

## Error propagation

Fish functions return the status of their last command unless overridden. A helper named `die` that only executes `return 1` returns from itself; its caller continues unless it propagates the status.

```fish
require_tool rg
or return
```

Check `mktemp`, `pushd`, reads, generated init commands, and cleanup explicitly. Required tools should fail fast. Only optional integrations may be conditionally absent, and the config should label them optional.

## Reading input

`read` normally reads one line. It does not turn a whole file into an array by adding list flags:

```fish
while read -l line
    process_line $line
end < file.txt
```

Use `string split` when delimiter-based parsing is deliberate. Use `read --silent` for interactive secrets, or a tool-specific credential file/secret manager; do not write credential-shaped literals into shell config.

## Abbreviations

Use abbreviations for interactive expansion and functions for reusable logic. Cursor markers default to `%`:

```fish
abbr --add L --position anywhere --set-cursor '% | less'
```

The expansion needs the marker for cursor movement.

## Transient prompts and themes

Enable transient prompts with a variable, not a function:

```fish
set -g fish_transient_prompt 1
```

Fish reruns `fish_prompt`, `fish_right_prompt`, and `fish_mode_prompt` with `--final-rendering`.

Prefer `fish_config theme choose THEME` for adaptive theme behavior. `fish_config theme save` stores universal colors and disables dynamic light/dark switching. Theme files use `fish_color_command blue`, not assignment syntax.

## Startup and configuration

Fish searches user `conf.d`, system configuration, and user/vendor data directories according to documented priority; snippets are naturally sorted, and only the first same-named file is run. Do not describe a simple system-then-user order.

Put environment and path setup needed by noninteractive Fish before an interactive-only guard:

```fish
fish_add_path $HOME/.local/bin
set -gx EDITOR nvim

status is-interactive
or return
```

Use `fish --profile-startup <file> -ic exit` to profile startup. Plain `--profile` excludes startup/config loading.

## Completions and events

Fish 4.8 embeds bundled completions/functions; use `status list-files` to inspect embedded files rather than assuming `/usr/share/fish/completions`.

Register multiple commands with repeated `--command` or brace expansion:

```fish
complete --command={docker,podman} --long-option help --description 'Show help'
```

Dynamic completion generators must be fast, bounded, side-effect-free, and must not interpret untrusted source. Avoid network calls on each Tab press.

Variable event handlers can coalesce updates, can run on same-value sets, and have unspecified ordering across handlers. Universal updates from another shell have distinct delivery behavior. Use events for notifications, not ordering-critical state machines.

## Tracing and introspection

`type --type name` prints classifications such as function, builtin, or file. `type --short` only suppresses full function definitions.

Tracing is enabled when `fish_trace` is set and non-empty. Disable it by erasing the variable:

```fish
set -e fish_trace
```

Use `$version` or compatibility variable `$FISH_VERSION`; `$fish_version` does not exist in Fish 4.8.1.

## Security

- Avoid `eval` and remote `curl | source` installation patterns.
- Pin and inspect a downloaded plugin installer before sourcing it.
- Resolve source paths with `type --path`, verify exactly one intended file, then source it.
- Keep dynamic completions and event handlers free of destructive side effects.
- Use secret managers, protected credential files, or `read --silent`; environment variables can still leak through child processes and diagnostics.
- Preserve exact arguments rather than re-parsing command text.
- Create and clean temporary directories only after each operation succeeds, preserving the wrapped command status.

## Review checklist

- Verify Fish 4.8.1 behavior and the project's minimum version.
- Use exported globals and `fish_add_path` for version-controlled environment setup.
- Preserve argv and avoid `eval`.
- Propagate failures through functions and cleanup.
- Read complete files with a loop or explicit splitting.
- Use the current transient-prompt variable and adaptive theme workflow.
- Put noninteractive environment setup before the interactive guard.
- Treat completion subprocesses and event handlers as bounded, side-effect-free hooks.
- Inspect embedded completion paths with `status list-files`.
- Pin and review third-party plugin installation.
