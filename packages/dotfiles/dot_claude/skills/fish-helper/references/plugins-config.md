# Fish Plugins and Configuration

## Fisher Plugin Manager

Fisher is the most popular plugin manager for Fish. It is pure-Fish, has zero startup overhead, and requires no configuration.

### Installation

```fish
curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher
```

### Commands

```fish
# Install a plugin from GitHub
fisher install jorgebucaran/nvm.fish

# Install specific version/branch/tag
fisher install IlanCosman/tide@v6

# Install from local directory
fisher install ~/my-plugin

# Install from GitLab
fisher install gitlab.com/user/repo

# List installed plugins
fisher list

# Update all plugins
fisher update

# Update specific plugin
fisher update jorgebucaran/fisher

# Remove a plugin
fisher remove jorgebucaran/nvm.fish

# Remove all plugins
fisher list | fisher remove
```

### fish_plugins File

Fisher records installed plugins in `$__fish_config_dir/fish_plugins` (typically `~/.config/fish/fish_plugins`). This file enables declarative plugin management:

```
# ~/.config/fish/fish_plugins
jorgebucaran/fisher
jorgebucaran/nvm.fish
IlanCosman/tide@v6
PatrickF1/fzf.fish
jethrokuan/z
```

Manually edit this file and run `fisher update` to sync -- Fisher installs new entries, removes deleted lines, and updates existing plugins.

Add `fish_plugins` to version control for reproducible setups across machines.

### Plugin Directory Structure

A Fisher plugin is a Git repository containing any combination of:

```
plugin-name/
  functions/           # Autoloaded functions
    my_function.fish
  completions/         # Command completions
    my_command.fish
  conf.d/              # Startup configuration scripts
    plugin_init.fish
  themes/              # Color themes (.theme files, Fish 3.4+)
    my_theme.theme
```

### Plugin Lifecycle Events

Plugins receive events during Fisher operations. Place handlers in `conf.d/` so they load before events fire:

```fish
# conf.d/my_plugin.fish
function _my_plugin_install --on-event my_plugin_install
    # Run after fisher install
end

function _my_plugin_update --on-event my_plugin_update
    # Run after fisher update
end

function _my_plugin_uninstall --on-event my_plugin_uninstall
    # Cleanup: remove universal variables, temp files, etc.
end
```

## Popular Plugins

### Directory Navigation

**z** (`jethrokuan/z`) -- Frecency-based directory jumping:
```fish
fisher install jethrokuan/z

z project        # jump to most frecent directory matching "project"
z -l             # list tracked directories
z -c pattern     # restrict to subdirectories of $PWD
z --clean        # remove non-existent directories from database
```

**zoxide** -- Smarter cd alternative (standalone binary with Fish integration):
```fish
# Install zoxide binary first, then initialize
zoxide init fish | source

z project        # jump to best match
zi project       # interactive selection with fzf
```

### Fuzzy Finding

**fzf.fish** (`PatrickF1/fzf.fish`) -- fzf integration with keybindings:
```fish
fisher install PatrickF1/fzf.fish

# Default keybindings:
# Ctrl+Alt+F  -- search files
# Ctrl+Alt+L  -- search git log
# Ctrl+Alt+S  -- search git status
# Ctrl+Alt+P  -- search processes
# Ctrl+R      -- search command history
```

**jethrokuan/fzf** -- Alternative fzf integration:
```fish
fisher install jethrokuan/fzf

# Ctrl+O  -- find file
# Ctrl+R  -- search history
# Alt+C   -- cd to directory
# Alt+O   -- open file in editor
# Alt+Shift+O -- open file in editor (git-tracked)
```

### Notifications

**done** (`franciscolourenco/done`) -- Notify when long commands finish:
```fish
fisher install franciscolourenco/done

# Automatically sends a notification when a command takes longer than
# $__done_min_cmd_duration (default: 5 seconds) and terminal is not focused
# Supports macOS, Linux (notify-send), and Windows (BurntToast)

set -U __done_min_cmd_duration 10000    # 10 seconds (in ms)
set -U __done_notify_sound 1            # enable sound
```

### Auto-pairing

**autopair** (`jorgebucaran/autopair.fish`) -- Auto-close brackets, quotes, etc:
```fish
fisher install jorgebucaran/autopair.fish

# Automatically pairs: () [] {} "" ''
# Skips closing char if already present
# Backspace removes both characters of an empty pair
```

**pisces** (`laughedelic/pisces`) -- Alternative auto-pairing:
```fish
fisher install laughedelic/pisces
```

### Bash Compatibility

**bax** (`jorgebucaran/bax.fish`) -- Run bash commands/scripts from Fish:
```fish
fisher install jorgebucaran/bax.fish

bax 'export FOO=bar && echo $FOO'
bax source script.sh
```

**bass** -- Alternative bash-to-fish bridge (older, less maintained):
```fish
fisher install edc/bass
bass source script.sh
```

### Node.js Version Management

**nvm.fish** (`jorgebucaran/nvm.fish`) -- Pure-Fish Node.js version manager:
```fish
fisher install jorgebucaran/nvm.fish

nvm install 20        # install Node 20
nvm use 20            # switch to Node 20
nvm list              # list installed versions
nvm list-remote       # list available versions
set -U nvm_default_version 20  # set default
```

### Testing

**fishtape** (`jorgebucaran/fishtape`) -- TAP-based test runner:
```fish
fisher install jorgebucaran/fishtape

# test.fish
@test "math works" (math 2 + 2) = 4
@test "string works" (string upper hello) = HELLO

fishtape test.fish
```

### Other Useful Plugins

- **abbreviation-tips** (`Gazorby/fish-abbreviation-tips`) -- Reminds you of abbreviations
- **spark** (`jorgebucaran/spark.fish`) -- Sparkline generator
- **gitnow** (`joseluisq/gitnow`) -- Git workflow shortcuts
- **virtualfish** (`adambrenecki/virtualfish`) -- Python virtualenv wrapper
- **colored-man-pages** -- Colorize man pages
- **fish-async-prompt** (`acomagu/fish-async-prompt`) -- Async prompt rendering

## Configuration Patterns

### config.fish

The main configuration file at `~/.config/fish/config.fish`. Keep it lean -- use `conf.d/` for modular organization:

```fish
# ~/.config/fish/config.fish

# Only run in interactive shells
if not status is-interactive
    return
end

# Environment variables
set -gx EDITOR nvim
set -gx VISUAL nvim
set -gx PAGER less
set -gx LANG en_US.UTF-8

# PATH additions
fish_add_path ~/.local/bin
fish_add_path ~/.cargo/bin
fish_add_path ~/go/bin

# Disable greeting
set -g fish_greeting

# Abbreviations (or put in conf.d/abbr.fish)
abbr -a g git
abbr -a gco git checkout
abbr -a gst git status
abbr -a gp git push
```

### conf.d/ Directory

Files in `~/.config/fish/conf.d/` execute before `config.fish`, in alphabetical order. Use this for modular configuration:

```
conf.d/
  00-env.fish        # environment variables
  10-path.fish       # PATH configuration
  20-abbr.fish       # abbreviations
  30-aliases.fish    # function aliases
  50-tools.fish      # tool initialization (starship, zoxide, etc.)
  99-local.fish      # machine-specific overrides
```

Prefix with numbers to control execution order.

### Example conf.d Files

```fish
# conf.d/00-env.fish
set -gx EDITOR nvim
set -gx GOPATH ~/go
set -gx DOCKER_BUILDKIT 1

# conf.d/10-path.fish
fish_add_path ~/.local/bin
fish_add_path ~/.cargo/bin
fish_add_path $GOPATH/bin

# conf.d/20-abbr.fish
abbr -a g git
abbr -a k kubectl
abbr -a d docker
abbr -a dc docker compose
abbr --command git co checkout
abbr --command git br branch
abbr --command git ci "commit -v"
abbr --command kubectl gp "get pods"
abbr --command kubectl gs "get svc"

# conf.d/50-tools.fish
# Initialize Starship prompt
if command -sq starship
    starship init fish | source
end

# Initialize zoxide
if command -sq zoxide
    zoxide init fish | source
end

# Initialize direnv
if command -sq direnv
    direnv hook fish | source
end
```

### functions/ Directory

Each function lives in its own file at `~/.config/fish/functions/NAME.fish`:

```fish
# functions/mkcd.fish
function mkcd -d "Create and enter directory"
    mkdir -p $argv[1]; and cd $argv[1]
end

# functions/fish_greeting.fish
function fish_greeting
    # Empty to disable, or customize:
    echo "Welcome to "(set_color cyan)(prompt_hostname)(set_color normal)
end
```

### Universal Variables vs Config Files

Universal variables (`set -U`) persist across sessions without config files. Use them for:
- User preferences that rarely change
- Plugin configuration
- Theme settings

Prefer `config.fish` or `conf.d/` for:
- PATH modifications (use `fish_add_path` instead of raw `set -U`)
- Abbreviations (the old universal storage is deprecated)
- Configuration that should be version-controlled

Fish 4.3+ moved away from universal variables toward global defaults for cleaner configuration.

## Prompt Customization

### Built-in Prompt Functions

```fish
# Left prompt (required)
function fish_prompt
    set -l last_status $status
    set -l cwd (prompt_pwd)

    if test $last_status -ne 0
        set_color red
    else
        set_color green
    end
    echo -n "$ "
    set_color normal
    echo -n "$cwd> "
end

# Right prompt (optional)
function fish_right_prompt
    set_color brblack
    echo (date +%H:%M)
    set_color normal
end

# Vi mode indicator (optional, only with vi keybindings)
function fish_mode_prompt
    switch $fish_bind_mode
        case default
            set_color red
            echo "[N] "
        case insert
            set_color green
            echo "[I] "
        case replace_one replace
            set_color yellow
            echo "[R] "
        case visual
            set_color magenta
            echo "[V] "
    end
    set_color normal
end

# Transient prompt (Fish 4.1+)
# Shown in place of fish_prompt after command execution
function fish_transient_prompt
    echo -n "$ "
end
```

### set_color

```fish
set_color red                  # named color
set_color brgreen              # bright green
set_color 0F0                  # hex color
set_color --bold red           # bold
set_color --underline          # underline
set_color --italics            # italic
set_color --dim                # dim
set_color --reverse            # reverse video
set_color -b blue              # background color
set_color normal               # reset all
```

### Useful Prompt Helpers

```fish
prompt_pwd                     # shortened $PWD (~/P/fish-helper)
prompt_pwd --full-length-dirs 2  # keep last 2 dirs full
prompt_hostname                # short hostname
fish_vcs_prompt                # git/hg/svn status
fish_git_prompt                # git-specific prompt info
```

### Git Prompt Variables

Configure `fish_git_prompt` output:

```fish
set -g __fish_git_prompt_show_informative_status 1
set -g __fish_git_prompt_showcolorhints 1
set -g __fish_git_prompt_showuntrackedfiles 1
set -g __fish_git_prompt_showdirtystate 1
set -g __fish_git_prompt_showstashstate 1
set -g __fish_git_prompt_showupstream informative
```

### Starship Integration

Starship is a popular cross-shell prompt. Initialize in Fish:

```fish
# conf.d/starship.fish
if command -sq starship
    starship init fish | source
end
```

Starship replaces `fish_prompt` and `fish_right_prompt` with its own. Configure via `~/.config/starship.toml`.

### Tide Prompt

Tide is a Fish-specific prompt framework with async rendering:

```fish
fisher install IlanCosman/tide@v6
tide configure    # interactive setup wizard
```

Features: async git info, multi-line prompt, vi mode indicator, transient prompt, and configurable segments.

## Theme Management

### Built-in Themes

```fish
fish_config theme show           # list available themes
fish_config theme choose monokai # preview and apply a theme
fish_config theme save           # save current colors
```

### Theme Variables

Key color variables:

```fish
set -U fish_color_command blue           # commands
set -U fish_color_error red              # errors
set -U fish_color_param normal           # parameters
set -U fish_color_comment brblack        # comments
set -U fish_color_autosuggestion brblack # autosuggestions
set -U fish_color_valid_path --underline # valid file paths
set -U fish_color_operator cyan          # operators
set -U fish_color_escape cyan            # escape sequences
set -U fish_color_quote yellow           # quoted strings
set -U fish_color_redirection cyan       # redirections
```

### Adaptive Themes (Fish 4.3+)

Theme files can include both light and dark sections:

```
# mytheme.theme
[light]
fish_color_command = blue
fish_color_error = red

[dark]
fish_color_command = brblue
fish_color_error = brred
```

Fish selects the appropriate section based on terminal background detection.

## Other Plugin Managers

### Oh My Fish (OMF)

Heavier framework with its own package ecosystem:

```fish
curl https://raw.githubusercontent.com/oh-my-fish/oh-my-fish/master/bin/install | fish
omf install z
omf theme bobthefish
```

### Fundle

Config-file-based manager inspired by Vim's Vundle:

```fish
# config.fish
fundle plugin 'jethrokuan/z'
fundle plugin 'edc/bass'
fundle init
```

Fisher is generally preferred for its simplicity and zero-overhead approach.

## Tips

### Conditional Tool Initialization

Only initialize tools when they are installed:

```fish
command -sq tool; and tool init fish | source
```

### Performance

- Prefer autoloaded functions over defining everything in `config.fish`
- Use `fish_add_path` instead of manually prepending to `$PATH` in config
- Fisher has zero startup overhead; OMF adds measurable startup time
- Use `fish --profile /tmp/profile.log` to identify slow startup scripts
- Lazy-load heavy initializations using autoloaded functions

### Migrating from Bash

1. Convert `export VAR=val` to `set -gx VAR val`
2. Convert `$(cmd)` to `(cmd)` (both forms work in Fish, but `(cmd)` is idiomatic)
3. Replace `[[` with `test` or `[`
4. Replace `${var:-default}` with `set -q var; or set var default`
5. Replace `${var%pattern}` with `string replace` or `string match`
6. Replace functions: `foo() { ... }` with `function foo ... end`
7. Replace `if/then/fi` with `if/end`
8. Replace `for x in ...; do ... done` with `for x in ...; ... end`
9. Source bash scripts using `bax` or `bass` plugins when conversion is impractical
