---
name: fish-helper
description: |
  Fish shell scripting - functions, abbreviations, completions, and configuration
  When user works with .fish files, mentions Fish shell, fish config, Fisher plugins, or Fish scripting patterns
---

# Fish Shell Helper Agent

## What's New in Fish 4.x (2025-2026)

### Fish 4.0 (February 2025)
- **Rust rewrite**: Entire codebase ported from C++ to Rust (2,731 commits, 200+ contributors)
- **New keyboard protocol**: Human-readable bind notation (`bind ctrl-right` instead of escape sequences), xterm modifyOtherKeys and kitty keyboard protocol support
- **OSC 133 prompt marking**: Prompts and command output marked for terminal integration
- **Command-specific abbreviations**: `abbr --command git co checkout`
- **Self-installable builds**: Static binaries embed functions, man pages, and webconfig
- **History filtering**: `fish_should_add_to_history` function for selective exclusion
- **`string match --max-matches`** and **`set --no-event`** flags

### Fish 4.1 (September 2025)
- **Brace compound commands**: `{ echo 1; echo 2 }` syntax
- **Transient prompts**: `fish_transient_prompt` function for simplified prompt after execution
- **Mouse support**: OSC 133 prompt marking with kitty click events
- **`string pad --center`** option
- **Vi mode**: ctrl+a (increment) and ctrl+x (decrement)

### Fish 4.2 (November 2025)
- Multi-line autosuggestions from history
- `fish_tab_title` function for separate tab titles
- Fish assumes UTF-8 regardless of system locale

### Fish 4.3 (December 2025)
- **Universal variables replaced with global defaults** for cleaner configuration
- **Adaptive themes**: `[light]` and `[dark]` sections in theme files
- Terminal working directory reported via OSC 7

### Fish 4.4 (February 2026)
- Vi mode word motions aligned with Vim behavior (counts supported: `d3w`)
- New `catppuccin-*` color themes
- `set_color` strikethrough modifier

## Overview

Fish (Friendly Interactive SHell) is a modern interactive shell focused on user experience. It provides syntax highlighting, autosuggestions, and tab completions out of the box. Fish intentionally breaks POSIX compatibility in favor of cleaner, more discoverable syntax.

Key design principles:
- Discoverability over tradition (no hidden configuration)
- User-friendliness over backward compatibility
- Correctness (no word splitting on variables)

## Syntax Differences from Bash

### Variable Assignment
```fish
# Fish uses set, not VAR=value
set name "world"
set -gx PATH /usr/local/bin $PATH    # global + exported
set -l local_var "temporary"           # local scope
set -U EDITOR vim                      # universal (persists across sessions)
set -e var_name                        # erase variable
```

### Variable Scopes
- **Universal** (`-U`): Shared across all sessions, persisted to disk
- **Global** (`-g`): Current session only
- **Function** (`-f`): Current function
- **Local** (`-l`): Current block

### Command Substitution
```fish
# Fish uses (command) or $(command), NOT backticks
set files (ls)
echo "Current dir: $(pwd)"

# Output splits on newlines only (not whitespace like bash)
# Use quotes to prevent splitting
set content "$(cat file.txt)"
```

### No Process Substitution
```fish
# Bash: diff <(cmd1) <(cmd2)
# Fish: use psub
diff (cmd1 | psub) (cmd2 | psub)
```

### Conditionals and Loops
```fish
# if/else if/else/end (no then/fi)
if test -f /etc/os-release
    cat /etc/os-release
else if test -f /etc/issue
    cat /etc/issue
else
    echo "Unknown OS"
end

# switch/case/end (no esac, no fallthrough)
switch (uname)
case Linux
    echo "Linux"
case Darwin
    echo "macOS"
case '*'
    echo "Other"
end

# for/end (no do/done)
for file in *.txt
    echo $file
end

# while/end
while read -l line
    echo "Line: $line"
end < input.txt
```

### Lists (Arrays)
```fish
# All variables are lists. 1-indexed, negative indexing supported
set colors red green blue
echo $colors[1]        # red
echo $colors[-1]       # blue
echo $colors[2..3]     # green blue
echo (count $colors)   # 3

# PATH variables auto-split on colons
set -gx PATH /usr/local/bin /usr/bin /bin
```

### String Manipulation
```fish
# Use the string builtin (no ${var%pattern} parameter expansion)
string length "hello"                    # 5
string upper "hello"                     # HELLO
string replace "old" "new" "old text"    # new text
string split "," "a,b,c"                 # a\nb\nc
string match -r '(\d+)' "file42.txt"    # 42
string trim "  hello  "                  # hello
string sub -s 2 -l 3 "hello"            # ell
```

### Arithmetic
```fish
# Use math builtin (no $(( )) or let)
math 2 + 2                # 4
math "10 / 3"             # 3.333333 (floating point by default)
math "sqrt(16)"           # 4
set result (math "$x * 2")
```

### Special Variables
| Bash | Fish |
|------|------|
| `$?` | `$status` |
| `$@`, `$*` | `$argv` |
| `$$` | `$fish_pid` |
| `$#` | `(count $argv)` |
| `$!` | `$last_pid` |
| `$0` | `(status filename)` |

### Other Key Differences
- No heredocs: use `printf '%s\n' "line1" "line2"` or multi-line strings
- No `[[`: use `test` or `[` only
- No subshells: use `begin; end` for grouping, `set -l` for scoping
- No `export`: use `set -gx`
- No `source ~/.bashrc`: use `source ~/.config/fish/config.fish`
- Globs that match nothing cause command failure (not literal pass-through)
- `?` glob deprecated; use `*` or disable with `qmark-noglob`
- No word splitting on variable expansion (a feature, not a bug)

## Functions Quick Reference

```fish
# Define a function
function greet -d "Greet someone"
    echo "Hello, $argv[1]!"
end

# Function with argument names
function mkcd -a dir -d "Create and enter directory"
    mkdir -p $dir && cd $dir
end

# Function wrapping a command (inherit completions)
function ls --wraps ls -d "ls with color"
    command ls --color=auto $argv
end

# Event handlers
function on_pwd_change --on-variable PWD
    echo "Changed to $PWD"
end

function on_exit --on-event fish_exit
    echo "Goodbye!"
end

# Save function to autoload file
funcsave greet   # saves to ~/.config/fish/functions/greet.fish
```

## Abbreviations Quick Reference

```fish
# Simple abbreviation
abbr -a gco git checkout
abbr -a gst git status

# Position: expand anywhere (not just as command)
abbr -a --position anywhere -- -C --color

# Command-specific (Fish 4.0+)
abbr --command git co checkout
abbr --command git br branch

# With cursor positioning
abbr -a L --position anywhere --set-cursor "| less"

# Function-based expansion
abbr -a !! --position anywhere --function last_history_item

# Regex-based
abbr -a dotenv --regex '\.env.*' --function edit_with_caution
```

## Completions Quick Reference

```fish
# Basic completion for a command
complete -c mycommand -s h -l help -d "Show help"
complete -c mycommand -s v -l verbose -d "Verbose output"

# Require a parameter
complete -c mycommand -s o -l output -r -d "Output file" -F

# Exclusive (require param, no files)
complete -c mycommand -s f -l format -x -a "json yaml toml" -d "Output format"

# Conditional completions
complete -c git -n "__fish_use_subcommand" -a checkout -d "Switch branches"
complete -c git -n "__fish_seen_subcommand_from checkout" -a "(git branch --format='%(refname:short)')" -d "Branch"

# Disable file completions globally
complete -c mycommand -f

# Wrap another command's completions
complete -c hub -w git
```

## Configuration Structure

```
~/.config/fish/
  config.fish              # Main config (runs on every shell start)
  conf.d/                  # Modular config snippets (sourced alphabetically)
    abbr.fish
    path.fish
    env.fish
  functions/               # Autoloaded functions (one per file)
    fish_prompt.fish
    fish_right_prompt.fish
    mkcd.fish
  completions/             # Custom completions (one per command)
    mycommand.fish
  themes/                  # Color themes (.theme files)
  fish_plugins             # Fisher plugin list
  fish_variables           # Universal variables (auto-managed, do not edit)
```

### Startup Order
1. Files in `conf.d/` directories (system, then user) in alphabetical order
2. `config.fish`
3. Functions autoloaded on first call

### Prompt Functions
- `fish_prompt` -- left prompt
- `fish_right_prompt` -- right prompt
- `fish_mode_prompt` -- vi mode indicator
- `fish_transient_prompt` -- simplified prompt shown after command execution (Fish 4.1+)
- `fish_greeting` -- message shown on shell start (set to empty to disable)

## Key Bindings

```fish
# Emacs mode (default)
fish_default_key_bindings

# Vi mode
fish_vi_key_bindings

# Custom bindings
bind ctrl-r 'commandline -f history-pager'
bind \t complete
bind ctrl-e 'edit_command_buffer'

# Vi mode insert-mode binding
bind --mode insert ctrl-c 'commandline -r ""'
```

### Default Key Bindings (Emacs Mode)
- Tab: complete, Shift+Tab: search completions
- Ctrl+R: history pager
- Ctrl+C: cancel/interrupt
- Ctrl+L: clear screen
- Ctrl+U: delete to beginning of line
- Ctrl+K: delete to end of line
- Ctrl+W: delete previous path component
- Ctrl+Z: undo, Alt+/: redo
- Alt+E: edit in $EDITOR
- Alt+H: show man page for current command
- Right arrow / Ctrl+F: accept autosuggestion
- Alt+Right / Alt+F: accept next word of autosuggestion

## Common Builtins

### read -- User Input

```fish
read -l -P "Name: " name
read -l -s -P "Password: " password    # silent input
read -l -P "Continue? [Y/n] " -c "Y" answer
read -l -n 1 char                       # single character
read -la lines < file.txt              # read file into list

# Read from pipe
echo "hello world" | read -l first rest
echo $first    # hello
echo $rest     # world
```

### status -- Shell State

```fish
status is-interactive        # true in interactive shell
status is-login              # true in login shell
status is-command-substitution  # true inside $(...)
status filename              # current script path
status function              # current function name
status line-number           # current line number
status current-command       # name of currently running command
status features              # list enabled features
status test-feature qmark-noglob  # check feature flag
```

### contains -- List Membership

```fish
if contains "blue" $colors
    echo "Found blue"
end

set idx (contains -i "green" $colors)  # get index
```

### type / command -- Command Resolution

```fish
type --short ls              # alias, builtin, function, or file
type --path ls               # file path of command
command -sq docker           # check if command exists (silent, quiet)
builtin -n                   # list all builtins
functions                    # list all defined functions
functions --names            # names only
functions myfunction         # print source of function
```

### source -- Execute Fish Scripts

```fish
source file.fish
source (command which env_setup.fish)

# Source with arguments
source script.fish arg1 arg2   # $argv available in script
```

### emit -- Custom Events

```fish
emit my_custom_event "arg1" "arg2"

function handle_event --on-event my_custom_event
    echo "Event received: $argv"
end
```

## Common Patterns

### Guard for Interactive Shell

```fish
# At top of config.fish
if not status is-interactive
    return
end
```

### Conditional PATH Setup

```fish
# Only add to PATH if directory exists
for dir in ~/.local/bin ~/.cargo/bin ~/go/bin
    test -d $dir; and fish_add_path $dir
end
```

### Wrapper Function Pattern

```fish
function git --wraps git -d "Git with default options"
    command git -c color.ui=always $argv
end
```

### Retry Pattern

```fish
function retry -a max_attempts cmd
    set -l attempt 1
    while test $attempt -le $max_attempts
        eval $cmd; and return 0
        set attempt (math $attempt + 1)
        sleep 1
    end
    return 1
end
```

### Temporary Environment Variables

```fish
# Fish has no VAR=value command syntax. Use env or begin/end block:
env PGPASSWORD=secret psql -U user db

# Or scope with begin/end
begin
    set -lx NODE_ENV production
    npm start
end
```

## Debugging

```fish
# Trace execution
set fish_trace 1
some_command
set fish_trace 0

# Profile script performance
fish --profile profile.log -c 'source script.fish'

# Check if interactive/login
status is-interactive
status is-login

# Print function source
functions myfunction
type myfunction

# Debug completions
complete -C "mycommand "    # show what would complete

# List all key bindings
bind                        # show all active bindings
bind --mode insert          # vi insert mode bindings
```

## Reference Files

For detailed reference material, see:
- `references/fish-syntax.md` -- Variables, control flow, strings, lists, pipes, math
- `references/completions-functions.md` -- Writing completions, functions, abbreviations, event handlers
- `references/plugins-config.md` -- Fisher, popular plugins, config patterns, prompt customization
