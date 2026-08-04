# Fish syntax and safety

Read this when handling variables, lists, argv, command status, input, tracing, temp directories, or shell evaluation.

## Variable scopes

`set` combines scope (`-l`, `-g`, `-U`) and export state (`-x`, `-u`). Do not request export and unexport simultaneously. Use a project-managed global for deterministic config and universal state only for intentional cross-session preferences.

## Lists and expansion

Fish variables are lists. A zero-element list can remove an unquoted expansion, including surrounding unquoted concatenation. `${name}` is not Fish syntax; combine quoted and unquoted segments deliberately.

The empty-list behavior makes “stringly” command construction fragile. Keep executable and arguments as list elements.

## Command-scoped variables

Fish supports `NAME=value command` for a command-scoped environment override. Use `set` for persistent or standalone assignment.

## Status

Capture `$status` immediately after the command it describes. Pipelines expose `$pipestatus`. A later `echo`, `set`, or cleanup command replaces `$status`.

## Safe temp wrapper

```fish
function with_temp
    if test (count $argv) -eq 0
        echo 'with_temp: missing command' >&2
        return 2
    end

    set -l temp_dir (mktemp -d)
    or return

    pushd $temp_dir
    or begin
        command rm -rf -- $temp_dir
        return 1
    end

    $argv
    set -l command_status $status

    popd
    set -l popd_status $status
    command rm -rf -- $temp_dir
    or return

    if test $popd_status -ne 0
        return $popd_status
    end
    return $command_status
end
```

Resolve and validate the exact temp path before cleanup. Run the `rm -rf` unconditionally after `popd`, not gated behind its success: a wrapped Fish function that clears the directory stack, or a since-removed original directory, makes `popd` fail, and an early `return` there would skip cleanup and leak the temp directory. This wrapper handles ordinary completion; interruption-safe cleanup may need a job/process lifecycle outside a simple function.

## Source

Resolve an intended function or file with `type --path`. Do not use external `which` output as trusted source code. Generated init output is code; run it only from a required, versioned tool and propagate failure.

## Tracing

Set `fish_trace` to a non-empty value to trace. Erase it to disable. Profiling startup uses `--profile-startup` rather than `--profile`.

## Primary documentation

- [Fish language](https://fishshell.com/docs/current/language.html)
- [Fish for Bash users](https://fishshell.com/docs/current/fish_for_bash_users.html)
- [Tutorial](https://fishshell.com/docs/current/tutorial.html)
- [set](https://fishshell.com/docs/current/cmds/set.html)
- [read](https://fishshell.com/docs/current/cmds/read.html)
- [status](https://fishshell.com/docs/current/cmds/status.html)
- [source](https://fishshell.com/docs/current/cmds/source.html)
- [string](https://fishshell.com/docs/current/cmds/string.html)
- [math](https://fishshell.com/docs/current/cmds/math.html)
- [psub](https://fishshell.com/docs/current/cmds/psub.html)
- [type](https://fishshell.com/docs/current/cmds/type.html)
- [command](https://fishshell.com/docs/current/cmds/command.html)
- [eval](https://fishshell.com/docs/current/cmds/eval.html)
- [argparse](https://fishshell.com/docs/current/cmds/argparse.html)
- [wait](https://fishshell.com/docs/current/cmds/wait.html)
- [contains](https://fishshell.com/docs/current/cmds/contains.html)
- [fish](https://fishshell.com/docs/current/cmds/fish.html)
- [fish_indent](https://fishshell.com/docs/current/cmds/fish_indent.html)
