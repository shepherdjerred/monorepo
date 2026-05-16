# CLI Design Guidelines for Developers

_Based on clig.dev with implementation focus_

## Philosophy: The 9 Core Principles

### 1. Human-First Design

**Principle**: CLIs are primarily for humans, not just machines.

**Practical Implications**:

- Show what's happening (don't hang silently)
- Confirm dangerous operations
- Provide helpful errors
- Use conversational language

**Counter to UNIX Tradition**: "Silence is golden" doesn't work for modern tools. Users expect feedback.

**Example from cargo**:

```
$ cargo build
   Compiling myapp v0.1.0
    Finished dev [unoptimized + debuginfo] target(s) in 2.34s
```

Clear indication of progress and completion.

### 2. Simple, Composable Parts

**Principle**: Standard streams, pipes, and exit codes enable composition.

**Practical Implications**:

- Output primary results to stdout
- Output logs/errors to stderr
- Exit 0 for success, non-zero for failure
- Accept stdin, write to stdout for filters

**Example from ripgrep**:

```bash
rg "pattern" | rg "filter" | wc -l
```

Composes naturally because stdout contains only matches.

### 3. Consistency Across Programs

**Principle**: Follow established conventions.

**Practical Implications**:

- Use standard flag names (-h, --help, -v, --version)
- Follow argument conventions (POSIX or GNU style)
- Ctrl-C should interrupt
- 'q' should quit TUIs

**Example from git**:
Every subcommand uses consistent flags:

```bash
git commit --verbose
git log --verbose
git diff --verbose
```

### 4. Saying Just Enough

**Principle**: Balance information density. Too little confuses, too much overwhelms.

**Guidelines**:

- Default: Show what changed
- Quiet mode (-q): Silence non-errors
- Verbose mode (-v): Show details
- Debug mode (--debug): Everything

**Example from docker**:

```
$ docker pull nginx
Using default tag: latest
latest: Pulling from library/nginx
a2abf6c4d29d: Pull complete
Status: Downloaded newer image for nginx:latest
```

Just enough to understand progress.

### 5. Ease of Discovery

**Principle**: Users shouldn't need to memorize everything.

**Practical Implications**:

- Comprehensive help text
- Examples in help
- Suggest corrections for typos
- Show next steps

**Example from git**:

```
$ git pul
git: 'pul' is not a git command. See 'git --help'.

The most similar command is
        pull
```

### 6. Conversation as the Norm

**Principle**: Design for iterative use and trial-and-error.

**Practical Implications**:

- Clear error messages that suggest fixes
- Allow undoing or --dry-run
- Preserve state when safe
- Show current state easily

**Example from git**:

```
$ git status
On branch main
Changes not staged for commit:
  modified:   file.txt

no changes added to commit
```

Always shows current state.

### 7. Robustness

**Principle**: Feel solid, not fragile. Handle errors gracefully.

**Practical Implications**:

- Validate input early
- Meaningful error messages (not stack traces)
- Handle SIGINT gracefully
- Restore terminal state on crash (TUIs)

**Example from cargo**:

```
$ cargo build
error: Could not compile `myapp` due to 2 previous errors
```

Clear, actionable error.

### 8. Empathy

**Principle**: Show you're on the user's side.

**Practical Implications**:

- Assume mistakes are honest
- Explain what went wrong
- Suggest how to fix it
- Be encouraging, not condescending

**Bad**:

```
Error: Invalid argument
```

**Good (from rustc)**:

```
error: unexpected end of file
  --> src/main.rs:5:1
   |
5  | }
   | ^ expected one of 8 possible tokens here
```

### 9. Chaos as Power

**Principle**: Terminal inconsistency enables innovation. Break rules intentionally with purpose.

**When to Break Conventions**:

- Clear usability improvement
- Document the deviation
- Provide escape hatches

**Example**: ripgrep's default behavior (auto-ignore .gitignore) breaks UNIX tradition but is more useful for developers.

---

## Arguments and Flags Implementation

### Terminology

**Arguments** (Positional Parameters):

- Order matters
- No dashes
- Example: `cp source dest`

**Flags** (Named Parameters):

- Order independent
- Start with `-` or `--`
- May have values
- Example: `ls --color=auto -l`

**Options**: Sometimes used interchangeably with flags

### Design Decision: Args vs Flags

**Use Positional Args When**:

- One or two required parameters
- Order is obvious
- Examples: `cat file.txt`, `cd /path`, `rm file1 file2`

**Use Flags When**:

- Optional parameters
- Many parameters
- Order shouldn't matter
- Need extensibility
- Examples: `git commit --message "msg" --amend`

**Prefer flags over args** for anything complex. They're more discoverable and extensible.

**Example from git**: Heavily flag-based for flexibility

```bash
git log --oneline --graph --all --decorate
# Order doesn't matter
git log --all --oneline --decorate --graph
```

### Standard Flag Names

Follow these conventions for consistency:

| Flag                  | Meaning                   | Example Usage     |
| --------------------- | ------------------------- | ----------------- |
| `-h`, `--help`        | Show help (only)          | `tool --help`     |
| `--version`           | Show version (only)       | `tool --version`  |
| `-v`, `--verbose`     | More output               | `tool -v`         |
| `-q`, `--quiet`       | Less output               | `tool -q`         |
| `-f`, `--force`       | Skip confirmations        | `rm -f file`      |
| `-r`, `--recursive`   | Recurse directories       | `rm -r dir`       |
| `-n`, `--dry-run`     | Preview without executing | `git clean -n`    |
| `-a`, `--all`         | Include all items         | `git add -a`      |
| `-o`, `--output FILE` | Output file               | `gcc -o program`  |
| `-i`, `--interactive` | Prompt for decisions      | `rm -i file`      |
| `--no-input`          | No interactive prompts    | `tool --no-input` |
| `-d`, `--debug`       | Debug output              | `tool -d`         |
| `--json`              | JSON output               | `tool --json`     |

**Don't Repurpose These**: Users have muscle memory for these flags.

### POSIX vs GNU Style

**POSIX Style**:

```bash
tool -a -b -c         # Short flags
tool -abc             # Bundled: same as above
tool -o file          # Flag with value (space separated)
```

**GNU Style**:

```bash
tool --long-flag      # Long flags
tool --output=file    # Equals-separated value
tool --output file    # Space-separated value
tool -a --long -b     # Mixed short and long
```

**Modern Best Practice**: Support both

- Short flags for common options
- Long flags for all options
- Allow bundling short flags (`-la` for `-l -a`)
- Support both `=` and space for values

**Example from git**:

```bash
git commit -m "msg"           # POSIX short
git commit --message="msg"    # GNU long with =
git commit --message "msg"    # GNU long with space
```

### Dangerous Operations: Confirmations

**Three Levels of Danger**:

**1. Low (Reversible)**:

- Delete a single file
- No confirmation needed (or -i flag)
- Example: `rm file.txt` (can restore from trash)

**2. Medium (Significant Impact)**:

- Delete directory, remote changes
- Interactive mode: Prompt for y/n
- Non-interactive: Require --force
- Example: `rm -r dir` (should prompt or need -f)

**3. High (Destructive/Widespread)**:

- Delete entire application, mass operations
- Require typing something non-trivial
- Example: Heroku's pattern:

```
$ heroku apps:destroy myapp
 ▸    WARNING: This will delete myapp including all add-ons.
 ▸    To proceed, type myapp or re-run this command with --confirm myapp

> myapp

Destroying myapp... done
```

**For Scripts**: Always provide `--force` or `--confirm=VALUE` to bypass prompts

```bash
tool --force                    # Bypass all confirmations
tool --confirm="dangerous"      # Confirm with specific value
```

### Order Independence

**Principle**: Users shouldn't need to remember flag order.

**Support All These**:

```bash
tool subcommand --flag value arg
tool --flag value subcommand arg
tool --flag value arg subcommand
```

**Example from git** (all equivalent):

```bash
git --no-pager log --oneline
git log --oneline --no-pager
```

**Example from docker** (noun-verb pattern):

```bash
docker container rm --force nginx
docker container rm nginx --force
```

### No Secrets in Flags

**Never**:

```bash
tool --password secret123    # Visible in ps, shell history
```

**Instead**:

```bash
# Option 1: Prompt interactively
tool --prompt-password

# Option 2: Read from file
tool --password-file ~/.secret

# Option 3: Read from stdin
cat ~/.secret | tool --password-stdin

# Option 4: Environment variable (also risky)
PASSWORD=secret123 tool
```

**Why**: `ps aux` shows all flags to all users. Shell history is often world-readable.

---

## Help and Documentation

### Help Display Requirements

**Minimal Help** (`-h` or no arguments):

```
USAGE:
    tool [OPTIONS] <FILE>

A brief one-line description of what this tool does.

OPTIONS:
    -h, --help       Print help information
    -v, --version    Print version
    -o, --output     Output file (default: stdout)

EXAMPLES:
    tool input.txt              Process input.txt
    tool -o out.txt in.txt      Write to out.txt

For more information, run: tool --help
```

**Full Help** (`--help`):

```
tool 1.2.3

A comprehensive description of what this tool does and why
you might want to use it.

USAGE:
    tool [FLAGS] [OPTIONS] <INPUT> [OUTPUT]

ARGS:
    <INPUT>     Input file to process
    [OUTPUT]    Output file (default: stdout)

FLAGS:
    -h, --help       Print help information
    -V, --version    Print version information
    -v, --verbose    Verbose output
    -q, --quiet      Suppress non-error output
    -f, --force      Overwrite existing files

OPTIONS:
    -o, --output <FILE>    Write output to FILE
    -c, --config <FILE>    Use configuration from FILE

EXAMPLES:
    # Basic usage
    tool input.txt

    # Write to file
    tool input.txt output.txt

    # With options
    tool -v --config my.conf input.txt

    # Pipe input
    cat input.txt | tool > output.txt

ENVIRONMENT:
    TOOL_CONFIG    Default configuration file path

For bug reports and feature requests:
https://github.com/user/tool/issues
```

### Examples-First Approach

**Principle**: Show examples before describing flags.

**Why**: Users learn faster from examples than from parameter descriptions.

**Learning from git**:

```
$ git help commit
NAME
    git-commit - Record changes to the repository

SYNOPSIS
    git commit [-a | --interactive | --patch] ...

DESCRIPTION
    Create a new commit containing the current contents of the index...

EXAMPLES
    Record your own changes
        $ git commit -a

    Commit with a detailed message
        $ git commit -m "Initial commit" -m "More details"
```

Examples section shows common patterns.

### Dynamic Help Generation

Generate help from the same source as argument parsing:

**Benefits**:

- Always stays in sync
- No duplicate maintenance
- Consistent formatting

**Concept** (language-agnostic):

```
define_cli():
    add_flag("output", short="o", help="Output file")
    add_flag("verbose", short="v", help="Verbose output")
    generate_help_from_definitions()
```

Most argument parsing libraries do this automatically.

### Man Pages

**When to Provide**:

- Professional tools
- System-wide installation
- Complex functionality

**Man Page Structure**:

```
NAME
    tool - one-line description

SYNOPSIS
    tool [OPTIONS] FILES...

DESCRIPTION
    Detailed description

OPTIONS
    Detailed flag descriptions

EXAMPLES
    Usage examples

SEE ALSO
    Related commands

BUGS
    Bug tracker URL
```

**Generation Tools**:

- `help2man`: Auto-generate from --help output
- `ronn`: Markdown to man page
- `scdoc`: Simple man page format
- `asciidoc`: Comprehensive documentation system

**Example from git**: Extensive man pages for every subcommand

```bash
man git-commit
man git-rebase
```

---

## Interactivity Implementation

### Confirmation Prompts

**Simple Yes/No**:

```
$ tool delete-all
Really delete all data? [y/N]: _
```

**Implementation Concept**:

```
if is_tty(stdin) and not no_input_flag:
    response = prompt("Really delete all data? [y/N]: ")
    if response.lower() != 'y':
        exit(0)
elif force_flag:
    # Proceed without confirmation
else:
    error("Cannot confirm in non-interactive mode. Use --force.")
    exit(1)
```

**Type-to-Confirm Pattern** (for dangerous operations):

```
$ heroku apps:destroy myapp
Type the app name to confirm: _
```

### Password Input (No Echo)

**Requirement**: Don't display password as user types

**C Implementation**:

```c
#include <termios.h>
#include <unistd.h>

void disable_echo() {
    struct termios tty;
    tcgetattr(STDIN_FILENO, &tty);
    tty.c_lflag &= ~ECHO;
    tcsetattr(STDIN_FILENO, TCSANOW, &tty);
}

void enable_echo() {
    struct termios tty;
    tcgetattr(STDIN_FILENO, &tty);
    tty.c_lflag |= ECHO;
    tcsetattr(STDIN_FILENO, TCSANOW, &tty);
}
```

**Python**:

```python
import getpass
password = getpass.getpass("Password: ")
```

**Rust**:

```rust
use rpassword::read_password;
println!("Password: ");
let password = read_password().unwrap();
```

### --no-input Flag

**Critical for CI/CD**: Never hang waiting for input

**Implementation**:

```
if no_input_flag:
    # Never prompt
    # Use defaults or fail with error
    if required_confirmation:
        error("Cannot prompt in --no-input mode. Use --force.")
        exit(1)
```

**Example**:

```bash
# Interactive (prompts for confirmation)
tool deploy

# CI/CD (fails without --force)
tool deploy --no-input --force
```

---

## Configuration Management

### Configuration Sources and Precedence

**Load Order (highest to lowest priority)**:

1. Command-line flags
2. Environment variables
3. Local config file (./.toolrc)
4. User config file (~/.config/tool/config)
5. System config file (/etc/tool/config)
6. Built-in defaults

**Implementation Pattern**:

```
config = load_defaults()
config.update(load_system_config())
config.update(load_user_config())
config.update(load_local_config())
config.update(load_environment())
config.update(load_flags())
```

### XDG Base Directory Specification

**Standard Paths**:

```
$XDG_CONFIG_HOME/tool/config    # User config (default: ~/.config/)
$XDG_DATA_HOME/tool/data        # User data (default: ~/.local/share/)
$XDG_CACHE_HOME/tool/cache      # Cache (default: ~/.cache/)
```

**Fallbacks**:

```
config_dir = getenv("XDG_CONFIG_HOME") or join(getenv("HOME"), ".config")
config_file = join(config_dir, "tool", "config.toml")
```

**Why**: Reduces dotfile clutter in home directory

**Example from git**:

```
~/.gitconfig               # Traditional
~/.config/git/config       # XDG (takes precedence)
```

### Environment Variables to Respect

**Standard Variables**:

| Variable | Purpose                            | Example Usage           |
| -------- | ---------------------------------- | ----------------------- |
| NO_COLOR | Disable all colors                 | Check before colorizing |
| EDITOR   | User's preferred editor            | `tool edit` opens this  |
| VISUAL   | Visual editor (prefer over EDITOR) | Same as EDITOR          |
| PAGER    | Paging program                     | Use for long output     |
| HOME     | User's home directory              | For config paths        |
| TMPDIR   | Temporary directory                | For temp files          |
| TERM     | Terminal type                      | For escape sequences    |
| COLUMNS  | Terminal width                     | For formatting          |
| LINES    | Terminal height                    | For paging decisions    |
| CI       | Running in CI environment          | Disable progress bars   |
| DEBUG    | Enable debug mode                  | Show verbose output     |

**Your Own Variables**:

```
TOOL_CONFIG=/path/to/config
TOOL_API_KEY=secret123
TOOL_LOG_LEVEL=debug
```

**Naming Convention**: ALL_CAPS, prefix with tool name

---

## Argument Parsing Deep Dive

### Getopt Patterns

**Short Options**: `-a -b -c`
**Long Options**: `--all --verbose --config=file`
**Bundling**: `-abc` = `-a -b -c`
**Values**: `-o file` or `-ofile` or `--output file` or `--output=file`
**End of Options**: `--` stops parsing, rest are arguments

**POSIX Conventions**:

- Short options: single dash, single letter
- Option arguments: separated by space or directly attached
- No permutation (options must come before arguments)

**GNU Conventions** (extensions):

- Long options: double dash, full word
- Option arguments: `=` or space
- Permutation (options can be anywhere)
- `--` to stop parsing

### Subcommand Dispatch Pattern

**Learning from git**:

```
git <global-options> <command> <command-options>

Examples:
git --no-pager log --oneline
git -C /path/to/repo status
```

**Implementation Pattern**:

```
parse phase 1: global options
identify subcommand
parse phase 2: subcommand options

dispatch:
    match subcommand:
        "build": build_command(opts)
        "test": test_command(opts)
        "deploy": deploy_command(opts)
```

### Learning from docker's Command Structure

**Pattern**: `docker <object> <action> <options>`

```bash
docker container create
docker container start
docker container stop
docker container rm

docker image build
docker image push
docker image pull
```

**Benefits**:

- Clear grouping
- Consistent interface
- Discoverability

### POSIX getopt

**Format**:

```c
int getopt(int argc, char *argv[], const char *optstring);

Example optstring: "ab:c::"
  a    - flag without argument
  b:   - flag with required argument
  c::  - flag with optional argument
```

### GNU getopt_long

**Format**:

```c
struct option {
    const char *name;    // Long name
    int has_arg;         // no_argument, required_argument, optional_argument
    int *flag;           // NULL or pointer to int
    int val;             // Value to return (or store in *flag)
};

int getopt_long(int argc, char *argv[],
                const char *optstring,
                const struct option *longopts,
                int *longindex);
```

**Example**:

```c
struct option long_options[] = {
    {"help",    no_argument,       0, 'h'},
    {"verbose", no_argument,       0, 'v'},
    {"output",  required_argument, 0, 'o'},
    {0, 0, 0, 0}
};

while ((c = getopt_long(argc, argv, "hvo:", long_options, NULL)) != -1) {
    switch (c) {
        case 'h': print_help(); break;
        case 'v': verbose = 1; break;
        case 'o': output_file = optarg; break;
    }
}
```

### Option Bundling

**Rule**: `-abc` = `-a -b -c` for flags without arguments

**Implementation**: Most libraries handle automatically

**Limitation**: Can't bundle options with arguments

```bash
# OK
ls -la

# Not OK (ambiguous)
tool -abc file    # Is 'c' a flag or does 'b' take 'c' as argument?
```

### Double Dash Convention

**Rule**: `--` stops option parsing

**Usage**:

```bash
# Pass filename that starts with dash
tool -- -weird-filename.txt

# Pass flags to subcommand
tool --verbose -- subcommand --its-own-flag
```

**Implementation**:

```
for arg in args:
    if arg == "--":
        stop_parsing_options = true
        continue

    if stop_parsing_options or not arg.startswith("-"):
        positional_args.append(arg)
    else:
        parse_option(arg)
```

---

## Complete CLI Application Structure

### Project Layout

**Rust**:

```
my-tool/
├── Cargo.toml
├── src/
│   ├── main.rs           # Entry point, argument parsing
│   ├── cli.rs            # CLI definitions
│   ├── commands/         # Subcommand implementations
│   │   ├── mod.rs
│   │   ├── build.rs
│   │   └── deploy.rs
│   ├── lib.rs            # Library code (reusable)
│   ├── error.rs          # Error types
│   └── config.rs         # Configuration
└── tests/
    └── integration_test.rs
```

**Python**:

```
my-tool/
├── pyproject.toml
├── src/
│   └── mytool/
│       ├── __init__.py
│       ├── __main__.py   # Entry point
│       ├── cli.py        # Argument parsing
│       ├── commands/     # Subcommands
│       │   ├── __init__.py
│       │   ├── build.py
│       │   └── deploy.py
│       └── lib.py        # Core logic
└── tests/
    └── test_cli.py
```

### Entry Point Design

**Concept**:

```
main():
    parse_arguments()
    load_config()
    setup_logging()
    dispatch_to_subcommand()
    handle_errors()
    exit_with_code()
```

**Implementation Pattern**:

```rust
fn main() {
    let result = run();

    match result {
        Ok(()) => std::process::exit(0),
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_args()?;
    let config = load_config(&args)?;

    match args.subcommand {
        Subcommand::Build(opts) => commands::build(opts, &config),
        Subcommand::Deploy(opts) => commands::deploy(opts, &config),
    }
}
```

---

## Progress & Feedback

### Spinner Implementation (Core Algorithm)

**Frames**:

```
frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
# Or: ["-", "\\", "|", "/"]
```

**Implementation**:

```
frame_index = 0

while working:
    clear_line()
    print(frames[frame_index % len(frames)] + " Processing...")
    frame_index++
    sleep(100ms)

clear_line()
print("Done!")
```

**ANSI Codes**:

```
\r         # Carriage return (go to start of line)
ESC[K      # Clear from cursor to end of line
ESC[?25l   # Hide cursor
ESC[?25h   # Show cursor
```

### Progress Bar Implementation (Core Algorithm)

**Concept**:

```
[=========>          ] 45% (450/1000) 2.5MB/s ETA 5s
```

**Implementation**:

```
width = 20
filled = int(width * (done / total))
bar = "=" * filled + ">" + " " * (width - filled - 1)

percentage = int(100 * done / total)
text = f"[{bar}] {percentage}% ({done}/{total})"

print(f"\r{text}", end="", flush=True)
```

**With Rate and ETA**:

```
elapsed = time_now - start_time
rate = done / elapsed
remaining = total - done
eta = remaining / rate

text += f" {format_bytes(rate)}/s ETA {format_duration(eta)}"
```

### Learning from cargo's Progress Patterns

**Stages**:

```
    Updating crates.io index
   Compiling serde v1.0.152 (1/10)
   Compiling tokio v1.25.0 (2/10)
    Finished dev [unoptimized] target(s) in 3.42s
```

**Patterns**:

- Right-aligned verbs (uniform column)
- Package names and versions
- Progress count (2/10)
- Summary with timing

---

## Configuration Management (Implementation)

### Loading Order Implementation

**Pattern** (highest to lowest priority):

```
1. Command-line flags (--config, --output)
2. Environment variables (TOOL_OUTPUT, TOOL_CONFIG)
3. Local config file (./.toolrc)
4. User config file (~/.config/tool/config.toml)
5. System config file (/etc/tool/config.toml)
6. Built-in defaults
```

**Implementation**:

```rust
fn load_config() -> Config {
    let mut config = Config::defaults();

    if let Some(path) = find_system_config() {
        config.merge(load_file(path)?);
    }

    if let Some(path) = find_user_config() {
        config.merge(load_file(path)?);
    }

    if let Some(path) = find_local_config() {
        config.merge(load_file(path)?);
    }

    config.merge(load_env_vars());
    config.merge(parse_cli_flags());

    config
}
```

### XDG Base Directory Implementation

```rust
use std::path::PathBuf;
use std::env;

fn get_config_dir() -> PathBuf {
    env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = env::var("HOME").expect("HOME not set");
            PathBuf::from(home).join(".config")
        })
        .join("mytool")
}

fn get_data_dir() -> PathBuf {
    env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = env::var("HOME").expect("HOME not set");
            PathBuf::from(home).join(".local/share")
        })
        .join("mytool")
}

fn get_cache_dir() -> PathBuf {
    env::var("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = env::var("HOME").expect("HOME not set");
            PathBuf::from(home).join(".cache")
        })
        .join("mytool")
}
```

---

## Interactive Features

### Confirmation Prompt Pattern

**Yes/No**:

```
Really delete all files? [y/N]:
```

**Implementation**:

```
if is_tty(stdin):
    print("Really delete all files? [y/N]: ", flush=True)
    response = read_line()
    if response.lower() != 'y':
        exit(0)
elif force_flag:
    # Proceed
    pass
else:
    error("Cannot confirm in non-interactive mode. Use --force.")
    exit(1)
```

### Menu Selection (Arrow Key Navigation)

**Pattern**:

```
Select an option:
> Option 1
  Option 2
  Option 3

(Use arrow keys, Enter to select, q to quit)
```

**Implementation Concept**:

```
selected = 0
options = ["Option 1", "Option 2", "Option 3"]

enable_raw_mode()

loop:
    clear_screen()
    print_menu(options, selected)

    key = read_key()
    match key:
        UP_ARROW:
            selected = (selected - 1) % len(options)
        DOWN_ARROW:
            selected = (selected + 1) % len(options)
        ENTER:
            return options[selected]
        'q':
            exit(0)

disable_raw_mode()
```

### Learning from git's Interactive Rebase

**Pattern**: Full-screen editor for multi-item selection

```
pick a1b2c3d First commit
pick d4e5f6g Second commit
pick h7i8j9k Third commit

# Commands:
# p, pick = use commit
# r, reword = use commit, but edit message
# e, edit = use commit, but stop for amending
# s, squash = use commit, but meld into previous
# d, drop = remove commit
```

**Design Lessons**:

- Use $EDITOR for complex interactions
- Provide help comments inline
- Clear, mnemonic commands

---

## Crash-Only Design

### Atomic Operations

**Pattern**: Operations that are fully complete or fully not done

**Example**: File writes

```
# Bad (non-atomic)
open(file, 'w')
write(data)
close()
# If crash here, partial file written

# Good (atomic)
write(file + ".tmp", data)
rename(file + ".tmp", file)  # Atomic operation
```

### Resume-able Operations

**Pattern**: Save progress, allow restart

**Example**: Download with resume

```
State file: .download_state.json
{
  "url": "...",
  "total_bytes": 10000000,
  "downloaded_bytes": 5000000,
  "chunks": ["chunk1", "chunk2"]
}

On start:
    if state_file exists:
        resume from state
    else:
        start fresh

On progress:
    update state file

On completion:
    remove state file
```

### Transaction Logs

**Pattern**: Write-ahead log (WAL)

**Example**:

```
Before operation:
    append to log: "DELETE file.txt"

Perform operation:
    delete(file.txt)

After success:
    append to log: "COMMITTED"

On crash recovery:
    replay_log()
```
