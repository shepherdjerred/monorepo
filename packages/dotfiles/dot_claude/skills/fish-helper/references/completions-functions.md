# Fish Completions, Functions, and Event Handlers

## Writing Completions

### The complete Command

Register completions for commands using `complete`. Fish evaluates completions dynamically each time Tab is pressed.

```fish
complete -c COMMAND [options]
```

### Core Options

| Flag | Long Form             | Description                                         |
| ---- | --------------------- | --------------------------------------------------- |
| `-c` | `--command`           | Command to complete for                             |
| `-s` | `--short-option`      | Single-character option (e.g., `-v`)                |
| `-l` | `--long-option`       | GNU long option (e.g., `--verbose`)                 |
| `-o` | `--old-option`        | Old-style long option (single dash, e.g., `-Wall`)  |
| `-a` | `--arguments`         | Space-separated list of completions                 |
| `-f` | `--no-files`          | Disable file completions                            |
| `-F` | `--force-files`       | Force file completions (override `-f`)              |
| `-r` | `--require-parameter` | Option requires an argument                         |
| `-x` | `--exclusive`         | Shorthand for `-r` + `-f`                           |
| `-n` | `--condition`         | Shell command; offer completion only if returns 0   |
| `-d` | `--description`       | Description shown in completion menu                |
| `-w` | `--wraps`             | Inherit completions from another command            |
| `-k` | `--keep-order`        | Preserve argument order (don't sort)                |
| `-e` | `--erase`             | Remove completions                                  |
| `-p` | `--path`              | Match command by absolute path (supports wildcards) |

### Basic Examples

```fish
# Simple command with options
complete -c myapp -s h -l help -d "Show help"
complete -c myapp -s v -l version -d "Show version"
complete -c myapp -s V -l verbose -d "Enable verbose output"

# Option that requires a parameter
complete -c myapp -s o -l output -r -d "Output file"

# Option with specific choices (exclusive: requires param, no file completion)
complete -c myapp -s f -l format -x -a "json yaml toml csv" -d "Output format"

# Disable all file completions for command
complete -c myapp -f

# Force file completions for specific option
complete -c myapp -s i -l input -r -F -d "Input file"
```

### Dynamic Completions

Generate completions from commands:

```fish
# Complete git branches
complete -c git-checkout -a "(git branch --format='%(refname:short)')"

# Complete running process names
complete -c kill -a "(ps -eo comm= | sort -u)"

# Complete usernames
complete -c chown -a "(__fish_complete_users)"

# Complete from a file
complete -c myapp -a "(cat ~/.myapp/commands.txt)"
```

### Conditional Completions

Use `-n` (condition) to control when completions appear:

```fish
# Only complete subcommands when no subcommand given yet
complete -c git -n "__fish_use_subcommand" -a "add" -d "Add files"
complete -c git -n "__fish_use_subcommand" -a "commit" -d "Record changes"
complete -c git -n "__fish_use_subcommand" -a "push" -d "Update remote"

# Complete branch names only after "checkout"
complete -c git -n "__fish_seen_subcommand_from checkout switch" \
    -a "(git branch --format='%(refname:short)')" -d "Branch"

# Complete files only after "add"
complete -c git -n "__fish_seen_subcommand_from add" -F
```

### Helper Functions for Conditions

Fish provides built-in helpers:

| Function                             | Purpose                                         |
| ------------------------------------ | ----------------------------------------------- |
| `__fish_use_subcommand`              | True if no subcommand given yet                 |
| `__fish_seen_subcommand_from CMD...` | True if one of the listed subcommands appears   |
| `__fish_contains_opt -s X long`      | True if the given option has been typed         |
| `__fish_complete_directories`        | Complete directory names with descriptions      |
| `__fish_complete_path`               | Complete file/directory paths with descriptions |
| `__fish_complete_suffix .EXT`        | Complete files with given extension             |
| `__fish_complete_users`              | Complete system usernames                       |
| `__fish_complete_groups`             | Complete system groups                          |
| `__fish_complete_pids`               | Complete process IDs                            |
| `__fish_print_hostnames`             | Print known hostnames                           |
| `__fish_print_interfaces`            | Print network interfaces                        |

### Complete Example: Custom Command

```fish
# completions/deploy.fish

# Disable default file completions
complete -c deploy -f

# Subcommands (only when no subcommand given)
complete -c deploy -n "__fish_use_subcommand" -a "start" -d "Start deployment"
complete -c deploy -n "__fish_use_subcommand" -a "stop" -d "Stop deployment"
complete -c deploy -n "__fish_use_subcommand" -a "status" -d "Show deployment status"
complete -c deploy -n "__fish_use_subcommand" -a "rollback" -d "Rollback to previous"

# Global options
complete -c deploy -s h -l help -d "Show help"
complete -c deploy -s v -l verbose -d "Verbose output"
complete -c deploy -l env -x -a "staging production" -d "Target environment"

# Options specific to "start" subcommand
complete -c deploy -n "__fish_seen_subcommand_from start" \
    -l tag -x -a "(git tag -l 'v*' | sort -rV | head -10)" -d "Version tag"
complete -c deploy -n "__fish_seen_subcommand_from start" \
    -l dry-run -d "Preview changes without deploying"

# Options specific to "rollback" subcommand
complete -c deploy -n "__fish_seen_subcommand_from rollback" \
    -l steps -x -a "1 2 3 5" -d "Number of versions to rollback"
```

### Wrapping Commands

Inherit completions from existing commands:

```fish
# hub inherits all git completions
complete -c hub -w git

# myls inherits ls completions
complete -c myls -w ls

# Can also use --wraps in function definition
function myls --wraps ls
    command ls --color=auto $argv
end
```

### Completion Autoloading

Place completion files in `~/.config/fish/completions/COMMAND.fish`. Fish loads them automatically when Tab is pressed for that command.

Search order for completion files:

1. `~/.config/fish/completions/` (user)
2. `/etc/fish/completions/` (system admin)
3. `~/.local/share/fish/vendor_completions.d/` (third-party)
4. `/usr/share/fish/vendor_completions.d/` (vendor)
5. `/usr/share/fish/completions/` (bundled)
6. `~/.cache/fish/generated_completions/` (auto-generated from man pages)

### Erasing Completions

```fish
# Erase all completions for a command
complete -c myapp -e

# Erase specific completion
complete -c myapp -l verbose -e

# Prevent autoloading completions (Fish 4.0+)
complete -c myapp -e
```

## Defining Functions

### Basic Function Definition

```fish
function name
    # commands
end

function greet -d "Greet a person by name"
    echo "Hello, $argv[1]!"
end
```

### Function Options

| Flag | Long Form              | Description                              |
| ---- | ---------------------- | ---------------------------------------- |
| `-d` | `--description`        | Short description (shown in completions) |
| `-a` | `--argument-names`     | Name positional arguments                |
| `-w` | `--wraps`              | Inherit completions from another command |
| `-S` | `--no-scope-shadowing` | Access caller's local variables          |
| `-V` | `--inherit-variable`   | Snapshot a variable at definition time   |
| `-e` | `--on-event`           | Register as event handler                |
| `-v` | `--on-variable`        | Trigger on variable change               |
| `-j` | `--on-job-exit`        | Trigger when job exits                   |
| `-p` | `--on-process-exit`    | Trigger when process exits               |
| `-s` | `--on-signal`          | Trigger on signal                        |

### Argument Handling

All arguments arrive in `$argv`. Name them for clarity:

```fish
function mkcd -a directory -d "Create and enter directory"
    mkdir -p $directory
    cd $directory
end

function copy_to -a source destination -d "Copy file to destination"
    cp $source $destination
end
```

Extra arguments beyond named ones remain in `$argv`:

```fish
function mycommand -a first second
    echo "First: $first"
    echo "Second: $second"
    echo "Rest: $argv[3..]"
end
```

### argparse for Robust Options

```fish
function serve -d "Start a dev server"
    argparse h/help 'p/port=!_validate_int' v/verbose -- $argv
    or return

    if set -ql _flag_help
        echo "Usage: serve [-p PORT] [-v] [DIR]"
        return 0
    end

    set -l port 8080
    if set -ql _flag_port
        set port $_flag_port
    end

    set -l dir "."
    if test (count $argv) -gt 0
        set dir $argv[1]
    end

    if set -ql _flag_verbose
        echo "Serving $dir on port $port"
    end
end
```

`argparse` sets `_flag_NAME` variables for each matched flag. Use `set -ql` (query local) to check presence.

### Function Scope

Functions create a new scope. Variables from the calling scope are NOT accessible unless:

```fish
# Method 1: --no-scope-shadowing (access ALL caller variables)
function modify_caller -S
    set local_in_caller "modified"
end

# Method 2: --inherit-variable (snapshot specific variable at definition time)
function make_closure
    set -l captured "snapshot"
    function inner -V captured
        echo $captured    # always "snapshot", even if original changes
    end
end

# Method 3: use global/universal scope explicitly
function set_global
    set -g result "from function"
end
```

### Autoloading Functions

Place each function in its own file at `~/.config/fish/functions/FUNCNAME.fish`. Fish loads it on first invocation:

```fish
# ~/.config/fish/functions/mkcd.fish
function mkcd -d "Create and enter directory"
    mkdir -p $argv[1]
    cd $argv[1]
end
```

Autoloaded functions:

- Load lazily (only when called)
- Override built-in functions of the same name
- Are the recommended way to define persistent functions

Save an interactively-defined function:

```fish
funcsave myfunction    # writes to ~/.config/fish/functions/myfunction.fish
```

Edit a function interactively:

```fish
funced myfunction      # opens in editor, reloads on save
```

### Wrapping Commands

Create aliases that inherit completions:

```fish
function ls --wraps ls -d "ls with color"
    command ls --color=auto $argv
end

# The alias command is shorthand:
alias ll "ls -la"
# equivalent to:
function ll --wraps 'ls -la' -d 'alias ll=ls -la'
    ls -la $argv
end
```

Always use `command` to call the original when wrapping, to prevent infinite recursion. Always pass `$argv` to forward arguments.

## Abbreviations

Abbreviations expand in the command line when Space or Enter is pressed. They differ from aliases: the expansion is visible and editable before execution.

### Creating Abbreviations

```fish
abbr -a gco git checkout
abbr -a gst git status
abbr -a gp git push
abbr -a gl git log --oneline --graph
```

### Position Control

```fish
# command position only (default) -- expands only as first word
abbr -a gco git checkout

# anywhere position -- expands anywhere in command line
abbr -a --position anywhere -- -C --color
abbr -a --position anywhere -- -H 'Accept: application/json'
```

### Command-Specific Abbreviations (Fish 4.0+)

Expand only when typing arguments to a specific command:

```fish
abbr --command git co checkout
abbr --command git br branch
abbr --command git ci commit
abbr --command git st status
abbr --command kubectl gp "get pods"
abbr --command=docker,podman ps "ps --format 'table {{.Names}}\t{{.Status}}'"
```

### Cursor Positioning

Place the cursor at a specific position after expansion:

```fish
# %  is the default cursor marker
abbr -a L --position anywhere --set-cursor "| less"
# Typing: cat file L<Space> becomes: cat file | less (cursor after |)

# Custom marker
abbr -a todo --set-cursor=CURSOR "# TODO: CURSOR"
```

### Function-Based Abbreviations

Call a function to generate the expansion dynamically:

```fish
function last_history_item
    echo $history[1]
end
abbr -a !! --position anywhere --function last_history_item

function multiline_git_commit
    echo "git commit -m '"(commandline -t)"'"
end
abbr -a gc --function multiline_git_commit
```

### Regex Abbreviations

Match patterns instead of literal text:

```fish
abbr -a vim_texts --regex '.+\.txt' --function edit_with_vim
# Any .txt filename typed as a command expands via the function
```

### Managing Abbreviations

```fish
abbr --list              # list abbreviation names
abbr --show              # show all with expansions (importable format)
abbr --erase gco         # remove specific abbreviation
abbr --query gco         # check if exists (exit status)
abbr --rename gco gch    # rename
```

### Where to Define Abbreviations

Define abbreviations in `config.fish` or a file in `conf.d/`:

```fish
# ~/.config/fish/conf.d/abbr.fish
abbr -a gco git checkout
abbr -a gst git status
abbr -a gp git push
```

Do NOT use universal variables for abbreviations (the old `abbr --universal` is non-functional).

## Event Handlers

Functions can register as event handlers that fire automatically.

### Named Events (--on-event)

```fish
function on_fish_start --on-event fish_prompt
    # Fires every time a prompt is about to be shown
end

function on_exit --on-event fish_exit
    echo "Goodbye!"
end

function on_postexec --on-event fish_postexec
    # Fires after every command execution
    # $argv[1] contains the command that was run
end

function on_preexec --on-event fish_preexec
    # Fires before command execution
end
```

Built-in events:

- `fish_prompt` -- before displaying prompt
- `fish_preexec` -- before executing a command
- `fish_postexec` -- after executing a command
- `fish_exit` -- when the shell exits
- `fish_cancel` -- when command line is cancelled (Ctrl+C)

Custom events via `emit`:

```fish
function handle_deploy --on-event deploy_complete
    echo "Deployment finished: $argv"
end

# Trigger the event
emit deploy_complete "v1.2.3"
```

### Variable Change Events (--on-variable)

```fish
function on_pwd_change --on-variable PWD
    echo "Changed to: $PWD"
end

function on_path_change --on-variable PATH
    echo "PATH updated"
end
```

### Signal Handlers (--on-signal)

```fish
function on_winch --on-signal WINCH
    echo "Terminal resized"
end

function on_int --on-signal INT
    echo "Caught interrupt"
end
```

### Job/Process Exit Events

```fish
# When a specific background job exits
function notify_done --on-job-exit $job_pid
    echo "Job $job_pid finished"
end

# When any job started by current command exits
function on_caller_job --on-job-exit caller
    echo "Background job completed"
end

# When a specific child process exits
function on_proc_exit --on-process-exit $pid
    echo "Process $pid exited with $argv[3]"
end
```

### Event Handler Placement

Place event handlers in `conf.d/` files so they load before events fire:

```fish
# ~/.config/fish/conf.d/events.fish
function __my_on_exit --on-event fish_exit
    # cleanup logic
end
```

Prefix internal event handler names with `__` to indicate they are implementation details.

### Fisher Plugin Events

Fisher emits lifecycle events for plugins:

```fish
function _myplugin_install --on-event myplugin_install
    echo "Plugin installed"
end

function _myplugin_update --on-event myplugin_update
    echo "Plugin updated"
end

function _myplugin_uninstall --on-event myplugin_uninstall
    echo "Plugin removed, cleaning up"
end
```

## Useful Patterns

### Checking Command Availability

```fish
if command -sq docker
    echo "Docker is installed"
end

# -s: don't print path, -q: quiet
```

### Default Variable Values

```fish
set -q MY_VAR; or set -g MY_VAR "default_value"
```

### Guard Against Empty Arguments

```fish
function mycommand
    if test (count $argv) -eq 0
        echo "Usage: mycommand FILE..."
        return 1
    end
    # proceed
end
```

### Temporary Directory Pattern

```fish
function with_tmpdir
    set -l tmpdir (mktemp -d)
    # do work in $tmpdir
    rm -rf $tmpdir
end
```

### Reading User Input

```fish
read -l -P "Enter your name: " name
echo "Hello, $name"

# With default
read -l -P "Continue? [Y/n] " -c "Y" answer

# Silent (for passwords)
read -l -s -P "Password: " password
```

### Status Code Patterns

```fish
# Chain with short-circuit
test -f file.txt; and cat file.txt; or echo "File not found"

# Capture and check
some_command
set -l cmd_status $status
if test $cmd_status -ne 0
    echo "Failed with status $cmd_status"
    return $cmd_status
end
```

### Complete Completion Script Example

A production-quality completion script for a multi-subcommand CLI tool:

```fish
# ~/.config/fish/completions/mytool.fish

# Subcommands
set -l subcommands init build deploy status config

# Disable file completions by default
complete -c mytool -f

# Global options (available with any subcommand)
complete -c mytool -s h -l help -d "Show help"
complete -c mytool -s V -l version -d "Show version"
complete -c mytool -l config -r -F -d "Path to config file"
complete -c mytool -l verbose -d "Enable verbose logging"

# Subcommand completions (only when no subcommand yet)
complete -c mytool -n "not __fish_seen_subcommand_from $subcommands" \
    -a init -d "Initialize new project"
complete -c mytool -n "not __fish_seen_subcommand_from $subcommands" \
    -a build -d "Build the project"
complete -c mytool -n "not __fish_seen_subcommand_from $subcommands" \
    -a deploy -d "Deploy to environment"
complete -c mytool -n "not __fish_seen_subcommand_from $subcommands" \
    -a status -d "Show current status"
complete -c mytool -n "not __fish_seen_subcommand_from $subcommands" \
    -a config -d "Manage configuration"

# build subcommand options
complete -c mytool -n "__fish_seen_subcommand_from build" \
    -l target -x -a "debug release" -d "Build target"
complete -c mytool -n "__fish_seen_subcommand_from build" \
    -l jobs -x -a "(seq 1 (nproc 2>/dev/null; or echo 8))" -d "Parallel jobs"

# deploy subcommand options
complete -c mytool -n "__fish_seen_subcommand_from deploy" \
    -l env -x -a "dev staging production" -d "Target environment"
complete -c mytool -n "__fish_seen_subcommand_from deploy" \
    -l dry-run -d "Preview without deploying"
complete -c mytool -n "__fish_seen_subcommand_from deploy" \
    -l tag -x -a "(git tag -l 'v*' 2>/dev/null | sort -rV)" -d "Version tag"

# config subcommand has sub-subcommands
complete -c mytool -n "__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list" \
    -a "get" -d "Get config value"
complete -c mytool -n "__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list" \
    -a "set" -d "Set config value"
complete -c mytool -n "__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list" \
    -a "list" -d "List all config"
```

### Function Best Practices

```fish
# Always use -d for discoverability
function serve -d "Start development server"
    # ...
end

# Always validate arguments
function deploy -a environment -d "Deploy to environment"
    if not contains $environment staging production
        echo "Error: environment must be 'staging' or 'production'" >&2
        return 1
    end
    # ...
end

# Use argparse for complex options rather than manual argv parsing
function build -d "Build project"
    argparse h/help t/target= j/jobs= clean -- $argv
    or return
    # ...
end

# Prefer returning status codes over printing errors for composability
function check_prereqs
    command -sq docker; or return 1
    command -sq kubectl; or return 1
    return 0
end

if not check_prereqs
    echo "Missing prerequisites" >&2
    return 1
end
```

### Abbreviation Organization

Keep abbreviations organized by category:

```fish
# conf.d/abbr.fish

# Git
abbr -a g git
abbr -a ga "git add"
abbr -a gc "git commit -v"
abbr -a gco "git checkout"
abbr -a gd "git diff"
abbr -a gl "git log --oneline --graph"
abbr -a gp "git push"
abbr -a gpl "git pull"
abbr -a gst "git status"

# Docker
abbr -a d docker
abbr -a dc "docker compose"
abbr -a dps "docker ps"
abbr -a drm "docker rm"
abbr -a drmi "docker rmi"

# Kubernetes
abbr -a k kubectl
abbr -a kgp "kubectl get pods"
abbr -a kgs "kubectl get svc"
abbr -a kgd "kubectl get deployments"
abbr -a kl "kubectl logs"
abbr -a ke "kubectl exec -it"

# Navigation
abbr -a .. "cd .."
abbr -a ... "cd ../.."
abbr -a .... "cd ../../.."
```
