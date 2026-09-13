---
name: terminal-concepts
description: |
  Comprehensive guide for building CLI and TUI applications - terminal internals, design principles, and battle-tested patterns
  When building CLI/TUI apps, implementing argument parsing, handling terminal input/output, escape codes, buffering, signals, or asking about terminal development concepts
---

# Terminal Concepts for Developers

## Overview

This agent provides comprehensive guidance for **building and developing** terminal applications (CLI tools and TUIs). Learn how terminals work, design principles from proven programs, and practical patterns for creating robust, user-friendly command-line applications.

**Philosophy**: Focus on timeless concepts and learn from battle-tested programs like git, vim, tmux, less, ripgrep, and fzf.

**Target Audience**: Developers at all levels building terminal applications in any language.

## What Developers Need to Know

Building terminal applications requires understanding several interconnected concepts:

1. **Terminal Fundamentals**: How TTYs, PTYs, streams, and buffering work
2. **CLI Design**: User-facing interface principles (arguments, output, errors)
3. **TUI Architecture**: Interactive full-screen applications
4. **Common Pitfalls**: Issues developers face and how to avoid them

## Learning from Proven Programs

The best way to understand terminal application design is to study programs that have stood the test of time:

- **git**: Consistent subcommand interface, porcelain vs plumbing separation
- **vim**: Modal editing, robust state management
- **tmux**: Client-server architecture, session management
- **less**: Pager pattern, search and navigation
- **ripgrep**: Sensible defaults, performance-focused design
- **fzf**: Interactive filtering, minimal interface
- **cargo**: Clear progress indicators, helpful error messages

Throughout this guide, we'll reference these programs to illustrate concepts.

---

# Part 1: Terminal Fundamentals for Developers

## Understanding the Terminal Stack

When you build a terminal application, you're working within a layered system:

```
┌─────────────────────────────────┐
│   Terminal Emulator             │ ← User sees (renders text, sends input)
│   (iTerm2, Alacritty, etc.)     │
└─────────────────────────────────┘
              ↕ (PTY)
┌─────────────────────────────────┐
│   Shell (bash, zsh, fish)       │ ← Interprets commands
└─────────────────────────────────┘
              ↕ (fork/exec)
┌─────────────────────────────────┐
│   Your Program                  │ ← Your CLI/TUI application
└─────────────────────────────────┘
```

### TTYs and PTYs

**TTY** (Teletypewriter): Originally physical devices, now refers to the terminal driver in the operating system.

**PTY** (Pseudo-Terminal): A pair of virtual devices that emulate a TTY:

- **Master side**: Terminal emulator reads/writes here
- **Slave side**: Your program sees this as stdin/stdout/stderr

**Why This Matters for Developers**:

- Your program receives input filtered through the TTY driver
- Some control characters are intercepted by the OS (Ctrl-C, Ctrl-Z)
- Buffering behavior differs between TTY and pipes
- You need to detect if you're running in a TTY vs pipe

### Terminal Modes: Cooked vs Raw

**Cooked Mode** (Canonical Mode):

- Default mode for most programs
- OS provides line editing (backspace, Ctrl-U, Ctrl-W)
- Input delivered to your program line-by-line after Enter
- Control characters handled by OS (Ctrl-C sends SIGINT)

**Raw Mode**:

- Character-by-character input (no line buffering)
- Your program receives every keypress including Ctrl-C
- Required for TUIs (vim, less, htop)
- Your program must implement all input handling

**When to Use Each**:

- **Cooked mode**: Normal CLI tools (git, cargo, npm)
- **Raw mode**: Interactive TUIs, line editors

### Standard Streams and File Descriptors

Every process has three standard streams:

| Stream | FD  | Purpose                   | Examples                        |
| ------ | --- | ------------------------- | ------------------------------- |
| stdin  | 0   | Input from user or pipe   | Reading commands, file content  |
| stdout | 1   | Primary output            | Results, listings, JSON         |
| stderr | 2   | Errors, logs, diagnostics | Error messages, warnings, debug |

**Critical Design Principle**: Separate stdout and stderr properly.

**Why This Matters**:

```bash
# User wants to pipe your output
your-tool | jq .         # Only works if output goes to stdout

# User wants to capture errors
your-tool 2> errors.log  # Only works if errors go to stderr
```

**Examples from Proven Programs**:

- **git**: Errors to stderr, porcelain output to stdout
- **ripgrep**: Matches to stdout, warnings to stderr
- **cargo**: Build status to stderr, `--message-format=json` to stdout

### Detecting TTY vs Pipe

Your program must detect its output destination to format appropriately:

**Concept** (language-agnostic):

```
if isatty(stdout):
    # Human is watching - use colors, progress bars
    enable_colors()
    show_progress()
else:
    # Piped to another program - plain output
    disable_colors()
    no_progress()
```

**Real-world examples**:

- `ls --color=auto`: Colors only for TTY
- `git status`: Full output for TTY, shorter for pipes
- `ripgrep`: Colors and summaries for TTY, plain matches for pipes

**C Implementation**:

```c
#include <unistd.h>

if (isatty(STDOUT_FILENO)) {
    // stdout is a TTY
}
```

**Rust Implementation**:

```rust
use std::io::IsTerminal;

if std::io::stdout().is_terminal() {
    // stdout is a TTY
}
```

**Python Implementation**:

```python
import sys

if sys.stdout.isatty():
    # stdout is a TTY
```

**Go Implementation**:

```go
import "golang.org/x/term"

if term.IsTerminal(int(os.Stdout.Fd())) {
    // stdout is a TTY
}
```

---

## ASCII Control Characters

### The 33 Control Characters

Control characters are created by holding Ctrl and pressing a key. There are 33 total:

- Ctrl-A through Ctrl-Z (26 characters)
- Plus 7 more: Ctrl-@, Ctrl-[, Ctrl-\, Ctrl-], Ctrl-^, Ctrl-\_, Ctrl-?

### Three Categories

**1. OS-Handled (Terminal Driver Intercepts)**:

| Key     | ASCII | Name | Function                      |
| ------- | ----- | ---- | ----------------------------- |
| Ctrl-C  | 3     | ETX  | Sends SIGINT (interrupt)      |
| Ctrl-D  | 4     | EOT  | EOF when line is empty        |
| Ctrl-Z  | 26    | SUB  | Sends SIGTSTP (suspend)       |
| Ctrl-S  | 19    | XOFF | Freezes output (flow control) |
| Ctrl-Q  | 17    | XON  | Resumes output                |
| Ctrl-\  | 28    | FS   | Sends SIGQUIT                 |

**2. Keyboard Literals**:

| Key       | ASCII | Name | Usage                     |
| --------- | ----- | ---- | ------------------------- |
| Enter     | 13    | CR   | Line terminator           |
| Tab       | 9     | HT   | Tab character             |
| Backspace | 127   | DEL  | Delete previous character |
| Ctrl-H    | 8     | BS   | Often same as backspace   |

**3. Application-Specific** (Your Program Can Define):

| Key      | Common Usage                         |
| -------- | ------------------------------------ |
| Ctrl-A   | Move to line start (readline, emacs) |
| Ctrl-E   | Move to line end                     |
| Ctrl-W   | Delete word backwards                |
| Ctrl-U   | Delete line                          |
| Ctrl-K   | Kill to end of line                  |
| Ctrl-R   | Reverse search (shells)              |
| Ctrl-L   | Clear screen                         |
| Ctrl-P/N | Previous/Next (history navigation)   |

### What Developers Can and Cannot Intercept

**In Cooked Mode**:

- OS handles: Ctrl-C, Ctrl-D, Ctrl-Z, Ctrl-S, Ctrl-Q
- You see: Ctrl-A, Ctrl-E, Ctrl-W (already processed by line editing)

**In Raw Mode** (TUIs):

- You can intercept almost everything including Ctrl-C
- **Exception**: Ctrl-Z often still suspends (OS-level)
- You must handle all line editing yourself

**Best Practice**: Respect user expectations. Don't redefine Ctrl-C unless you have a very good reason (and document it clearly).

### Limited Modifier Combinations

Unlike GUI applications, terminals have severe limitations:

- **Only 33 Ctrl combinations** total
- Ctrl-Shift-X **doesn't exist** as a distinct character
- Ctrl-[number] combinations limited
- Alt/Meta combinations inconsistent across terminals

**Implication**: Design keyboard shortcuts carefully. You have far fewer options than GUI apps.

---

## Escape Codes and Standards

### What Are Escape Codes?

Escape codes are invisible character sequences that control terminals. They start with ESC (ASCII 27, written as `\x1b`, `\033`, or `\e`).

**Two types**:

1. **Input codes**: Generated by keypresses (arrow keys, function keys)
2. **Output codes**: Your program uses to control display (colors, cursor movement)

### Output Escape Code Standards

#### ECMA-48 Foundation

The base standard defining escape code formats:

**CSI (Control Sequence Introducer)**: `ESC [` followed by parameters

```
ESC[2J        # Clear screen
ESC[H         # Move cursor to home
ESC[1;31m     # Red foreground color
```

**OSC (Operating System Command)**: `ESC ]` followed by parameters

```
ESC]0;Title\x07    # Set window title
ESC]52;c;base64\x07   # Clipboard access (OSC 52)
```

#### XTerm Extensions

XTerm added features beyond ECMA-48:

- Mouse reporting (click, drag, scroll)
- Clipboard access via OSC 52
- Extended color modes (256 colors, RGB)

**These aren't formally standardized** but are widely supported because xterm is so influential.

#### Terminfo Database

A database mapping terminal types to their capabilities:

```bash
echo $TERM              # xterm-256color, screen-256color, etc.
infocmp $TERM           # Dump terminal capabilities
tput bold               # Output "bold" escape sequence for $TERM
```

**Terminfo Approach**:

1. Query terminfo for escape sequences
2. Adapts to different terminals automatically
3. Complex to use, slower

**Hardcoded Approach**:

1. Use common escape sequences directly
2. Test across major terminals
3. Simpler, faster, good enough for most

**Most modern programs use the hardcoded approach** for the subset of widely-supported sequences.

### Practical Compatibility Strategies

**Strategy 1**: Stick to well-supported sequences

- 16 ANSI colors (ESC[30-37m, ESC[40-47m)
- Basic cursor movement (ESC[H, ESC[A/B/C/D)
- Clear screen/line (ESC[2J, ESC[K)

**Strategy 2**: Test on major terminal emulators

- iTerm2, Alacritty (macOS)
- GNOME Terminal, Konsole (Linux)
- Windows Terminal (Windows)
- tmux and screen (multiplexers)

**Strategy 3**: Provide fallbacks

```
if supports_256_colors():
    use_256_color_palette()
elif supports_16_colors():
    use_basic_colors()
else:
    no_colors()
```

**Examples from Proven Programs**:

- **less**: Queries terminfo, falls back to hardcoded
- **vim**: Extensive terminfo support with fallbacks
- **ripgrep**: Hardcoded ANSI, works everywhere

### When to Use Libraries vs Raw Escape Codes

**Use Libraries When**:

- Building complex TUIs (ncurses, crossterm, etc.)
- Need mouse support
- Want automatic capability detection
- Cross-platform support (Windows Console API)

**Use Raw Escape Codes When**:

- Simple color output
- Progress bars
- Cursor positioning for simple UIs
- You want minimal dependencies

---

## Buffering Deep Dive

### Three Buffering Modes

**Unbuffered**: Every write goes directly to the destination

- Slowest (syscall overhead)
- Used for stderr by default

**Line Buffered**: Flush on newlines

- Used for stdout when writing to TTY
- Balance of performance and responsiveness

**Block Buffered**: Flush when buffer full (~8KB)

- Used for stdout when writing to pipe/file
- Most efficient for throughput

### Why Your Program Uses Different Buffering

The standard library (libc, Go runtime, Python runtime) **automatically detects** with `isatty()`:

```
if isatty(stdout):
    use_line_buffering()     # Interactive user
else:
    use_block_buffering()    # Pipe or file
```

**This is why pipes get stuck!**

### The Pipe Buffering Problem

```bash
tail -f log.txt | grep ERROR
# Hangs! grep is waiting for 8KB before flushing
```

**Why**:

1. `grep` sees stdout is a pipe (not TTY)
2. Uses block buffering (8KB threshold)
3. Waits to accumulate data
4. Never reaches threshold with sparse matches
5. Appears frozen

### Solutions for Developers Building CLI Tools

**Solution 1**: Add `--line-buffered` flag

**C Implementation**:

```c
#include <stdio.h>

if (line_buffered_flag) {
    setvbuf(stdout, NULL, _IOLBF, 0);
}

// Or manually flush:
printf("output\n");
fflush(stdout);
```

**Rust Implementation**:

```rust
use std::io::{self, Write};

fn main() {
    let stdout = io::stdout();
    let mut handle = stdout.lock();

    writeln!(handle, "output").unwrap();
    handle.flush().unwrap();  // Manual flush
}
```

**Python Implementation**:

```python
import sys

# Enable line buffering
sys.stdout.reconfigure(line_buffering=True)

# Or manual flush
print("output", flush=True)

# Or environment variable
# PYTHONUNBUFFERED=1 python script.py
```

**Go Implementation**:

```go
import (
    "bufio"
    "os"
)

writer := bufio.NewWriter(os.Stdout)
writer.WriteString("output\n")
writer.Flush()  // Manual flush
```

**Solution 2**: Always flush after important output

**Best Practices**:

- Flush after progress updates
- Flush after each line of JSON in streaming mode
- Flush before long computations
- Provide `--line-buffered` for tools that filter streams

**Examples from Proven Programs**:

- `grep --line-buffered`: Solves pipe buffering
- `sed -u`: Unbuffered mode
- `awk`: Has no built-in flag (common complaint)

### Testing Buffered Output

**In CI/CD**:

```bash
# Force line buffering
stdbuf -oL your-tool | other-tool

# Or use unbuffer (expect package)
unbuffer your-tool | other-tool
```

**In Tests**:

- Mock the TTY with PTY libraries
- Test both TTY and non-TTY paths
- Verify flushing behavior

---

## Input Escape Sequences

### Arrow Keys and Function Keys

When users press special keys, terminals send multi-character escape sequences:

| Key       | Sequence             | Notes              |
| --------- | -------------------- | ------------------ |
| Up        | `ESC[A`              | CSI sequence       |
| Down      | `ESC[B`              |                    |
| Right     | `ESC[C`              |                    |
| Left      | `ESC[D`              |                    |
| Home      | `ESC[H` or `ESC[1~`  | Varies by terminal |
| End       | `ESC[F` or `ESC[4~`  |                    |
| Page Up   | `ESC[5~`             |                    |
| Page Down | `ESC[6~`             |                    |
| F1        | `ESC OP` or `ESC[[A` | Highly variable    |
| F12       | `ESC[24~`            |                    |

### Distinguishing ESC Key from Escape Sequences

**The Problem**: ESC character can mean:

1. User pressed ESC key (standalone)
2. Start of escape sequence (ESC[A for up arrow)

**Solution**: Timeout-based parsing

```
Read character:
    If ESC:
        Wait ~50ms for next character:
            If timeout: User pressed ESC
            Else: Start of sequence, continue reading
```

**Proven Programs**:

- **vim**: Uses 1 second timeout (customizable with `ttimeoutlen`)
- **less**: Uses short timeout
- **readline**: Configurable timeout

### Mouse Events

Modern terminals can send mouse events (clicks, drags, scrolls):

```
ESC[<0;10;5M    # Mouse button press at column 10, row 5
```

**Enable mouse reporting**:

```
ESC[?1000h      # Send button press/release
ESC[?1002h      # Send button press/release/drag
ESC[?1006h      # SGR mouse mode (better format)
```

**Disable when exiting**:

```
ESC[?1000l
```

**Used by**: vim, tmux, less, htop

---

# Part 2: CLI Design Guidelines for Developers

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

## Output Design for Developers

### TTY Detection Pattern

**Core Pattern**:

```
if is_tty(stdout):
    format = HumanReadable(colors=True, progress=True)
else:
    format = MachineReadable(colors=False, progress=False)
```

**Implementation** (shown earlier, repeated for context):

- Use `isatty()` system call
- Check file descriptor 1 (stdout)
- Make decision at startup

**Override Flags**:

```bash
tool --color=always    # Force colors even in pipe
tool --color=never     # No colors even in TTY
tool --color=auto      # Default (detect TTY)
```

**Example from ls**:

```bash
ls --color=auto    # Default on many systems
```

### Color Implementation

**Respect NO_COLOR Environment Variable**:

```
if getenv("NO_COLOR"):
    disable_all_colors()
elif not is_tty(stdout):
    disable_all_colors()
elif color_flag == "never":
    disable_all_colors()
else:
    enable_colors()
```

**16 ANSI Colors (Safest)**:

| Code  | Color         | Code    | Color              |
| ----- | ------------- | ------- | ------------------ |
| 30    | Black         | 40      | Black background   |
| 31    | Red           | 41      | Red background     |
| 32    | Green         | 42      | Green background   |
| 33    | Yellow        | 43      | Yellow background  |
| 34    | Blue          | 44      | Blue background    |
| 35    | Magenta       | 45      | Magenta background |
| 36    | Cyan          | 46      | Cyan background    |
| 37    | White         | 47      | White background   |
| 90-97 | Bright colors | 100-107 | Bright backgrounds |

**Usage**:

```
ESC[31m red text ESC[0m     # Red foreground
ESC[1;31m bold red ESC[0m   # Bold red
ESC[0m                      # Reset all attributes
```

**Example Code (Rust)**:

```rust
fn print_colored(text: &str, color: u8) {
    if atty::is(atty::Stream::Stdout) && std::env::var("NO_COLOR").is_err() {
        println!("\x1b[{}m{}\x1b[0m", color, text);
    } else {
        println!("{}", text);
    }
}
```

**Learning from ripgrep**:

- Automatic color detection
- Respects NO_COLOR
- Highlights matches in red by default
- Disables in pipes

### JSON and Machine-Readable Output

**Pattern**: Provide `--json` flag for structured output

**Design**:

```bash
# Human-readable (default for TTY)
$ tool list
Found 3 items:
  - Item 1 (active)
  - Item 2 (inactive)
  - Item 3 (active)

# Machine-readable
$ tool list --json
[{"name":"Item 1","status":"active"},{"name":"Item 2","status":"inactive"}]
```

**Guidelines**:

- One JSON object per line for streaming (JSONL/ndjson)
- Valid JSON even on errors
- Include error information in JSON

**Example (streaming)**:

```bash
$ tool process --json
{"type":"start","count":100}
{"type":"progress","done":50,"total":100}
{"type":"complete","duration":1.5}
```

**Learning from cargo**:

```bash
cargo build --message-format=json
```

Outputs JSON for tooling integration.

### Progress Indicators

**When to Show**:

- TTY output only
- Long-running operations (>1 second)
- User needs feedback

**When to Hide**:

- Piped output
- `--quiet` flag
- CI/CD environments (use `CI` env var)

**Types**:

**Spinner** (indeterminate):

```
⠋ Processing...
⠙ Processing...
⠹ Processing...
```

**Progress Bar** (determinate):

```
[=========>          ] 45% (450/1000)
```

**Example Code (Concept)**:

```
if is_tty(stderr) and not quiet_mode:
    progress = ProgressBar(total=100)
    for item in items:
        process(item)
        progress.increment()
```

**Learning from cargo**:

```
    Updating crates.io index
  Downloaded 2 crates (50.3 KB) in 0.38s
   Compiling serde v1.0.152
   Compiling toml v0.5.11
    Finished dev [unoptimized + debuginfo] target(s) in 3.42s
```

Clear progress with meaningful stages.

### Pager Integration

**When to Use Pager**:

- Output longer than terminal height
- User might want to scroll/search
- Examples: git log, man, --help output

**How to Detect**:

```
if is_tty(stdout) and output_lines > terminal_height:
    pipe_to_pager()
```

**Respect PAGER Environment Variable**:

```
pager = getenv("PAGER") or "less"
```

**Common Pager Options for less**:

```
LESS="-FIRX"
  F: Quit if output fits on screen
  I: Case-insensitive search
  R: Allow ANSI color codes
  X: Don't clear screen on exit
```

**Example from git**:

```bash
git log    # Automatically pages long output
```

**Disable When Needed**:

```bash
git --no-pager log    # Don't page
```

---

## Error Handling Implementation

### User-Focused Error Messages

**Bad**:

```
Error: FileNotFoundError: [Errno 2] No such file or directory: 'config.toml'
  at read_config (tool.py:42)
  at main (tool.py:120)
```

**Good**:

```
Error: Could not find configuration file 'config.toml'

Try creating one with: tool init
Or specify a different location: tool --config path/to/config.toml
```

**Principles**:

- Say what went wrong (not code-level details)
- Suggest how to fix it
- No stack traces unless --debug

**Implementation Pattern**:

```
catch FileNotFoundError as e:
    if debug_mode:
        print_stack_trace(e)
    else:
        print("Error: Could not find file '{}'".format(e.filename))
        print("Try: ...")
```

### Error Message Hierarchy

**Write to stderr**: All errors and warnings

**Structure**:

```
ERROR: Critical failure, operation cannot complete
WARNING: Something's wrong, but continuing
INFO: Notable state change (when verbose)
DEBUG: Detailed diagnostics (when --debug)
```

**Color Coding** (if TTY):

```
ERROR: red
WARNING: yellow
INFO: blue/cyan
DEBUG: gray/dim
```

**End with Critical Info**: Terminal scrolls, last line is most visible

**Example from rustc**:

```
error: aborting due to 2 previous errors

For more information about this error, try `rustc --explain E0425`.
```

Summary and next steps at the end.

### Exit Codes

**POSIX Conventions**:

- `0`: Success
- `1`: General error
- `2`: Misuse (invalid arguments)
- `126`: Command found but not executable
- `127`: Command not found
- `128+N`: Killed by signal N (e.g., 130 for Ctrl-C)

**Design Your Own** for specific errors:

```
0: Success
1: General error
2: Invalid arguments
10: File not found
11: Permission denied
12: Network error
```

**Document them**:

```
EXIT CODES:
    0   Success
    1   General error
    2   Invalid arguments
    10  File not found
```

**Why They Matter**: Scripts check exit codes

```bash
if tool process file.txt; then
    echo "Success"
else
    echo "Failed with code $?"
fi
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

# Part 3: Building TUIs - Developer's Guide

## Core Patterns Developers Must Implement

### Terminal Rules for TUIs

**Rule 1**: 'q' quits the program

- **Examples**: less, htop, man
- **Exception**: Text editors where 'q' has other meaning

**Rule 2**: Ctrl-D quits REPLs

- **Examples**: python, irb, node, psql
- **Mimics**: OS-level EOF behavior

**Rule 3**: Ctrl-C should exit or interrupt

- In raw mode, you receive Ctrl-C as character 3
- Either exit immediately or cancel current operation
- **Don't**: Ignore it completely

**Rule 4**: ESC cancels or goes back

- Close dialog, return to previous screen
- **Not**: As primary input (conflicts with escape sequences)

**Rule 5**: Ctrl-L redraws screen

- Useful when terminal gets corrupted
- **Implementation**: Resend entire screen

### Readline Keybindings

Users expect these to work in line editors:

| Key    | Function                          | Origin |
| ------ | --------------------------------- | ------ |
| Ctrl-A | Start of line                     | Emacs  |
| Ctrl-E | End of line                       | Emacs  |
| Ctrl-B | Back one character                | Emacs  |
| Ctrl-F | Forward one character             | Emacs  |
| Ctrl-P | Previous line/history             | Emacs  |
| Ctrl-N | Next line/history                 | Emacs  |
| Ctrl-K | Kill to end of line               | Emacs  |
| Ctrl-U | Kill entire line                  | UNIX   |
| Ctrl-W | Delete word backward              | UNIX   |
| Ctrl-D | Delete character forward (or EOF) | UNIX   |
| Ctrl-H | Delete character backward         | UNIX   |

**When to Implement**: Any time you have line editing (command input, search box)

**When to Skip**: Full-screen editors (vim, emacs use their own bindings)

### Color Constraints

**Recommendation**: Stick to 16 ANSI base colors

**Why**:

- Works on all terminals
- Respects user's color scheme
- Avoids unreadable combinations

**Bad**:

```
# Hardcoded RGB colors
\x1b[38;2;255;100;50m  # May be unreadable on some backgrounds
```

**Good**:

```
# Base 16 ANSI colors
\x1b[31m    # Red (user's terminal defines exact shade)
\x1b[32m    # Green
```

**Learning from vim**: Theme files use named colors ("Red", "Blue") that adapt to terminal color scheme.

---

## TUI Architecture Patterns from Proven Programs

### vim: Modal Editing Architecture

**Key Concepts**:

**Modes as State Machine**:

```
Normal Mode → (i) → Insert Mode
           ↓ (v)           ↑ (ESC)
     Visual Mode ←←←←←←←←←←←
           ↓ (:)
     Command Mode
```

**Separation of Concerns**:

- **Normal mode**: Navigation and commands
- **Insert mode**: Text input
- **Visual mode**: Selection
- **Command mode**: Ex commands

**Why It Works**:

- Clear mental model
- Composable commands (d3w = delete 3 words)
- Efficient keyboard-only navigation

**Lessons for TUI Developers**:

- State machines clarify complex interactions
- Modal interfaces reduce key combination needs
- Visual feedback for mode (status line)

### tmux: Client-Server Architecture

**Key Concepts**:

**Server Persistence**:

```
Terminal 1 → tmux client →
                          → tmux server → sessions → windows → panes
Terminal 2 → tmux client →
```

**Benefits**:

- Sessions survive terminal disconnect
- Multiple clients can attach
- Server manages all state

**Command Prefix (Ctrl-B)**:

- Escapes command mode
- Avoid conflicting with application keys
- User customizable

**Lessons for TUI Developers**:

- Client-server separation enables persistence
- Prefix keys solve key binding conflicts
- Named sessions provide organization

### less: Pager Pattern

**Key Concepts**:

**Lazy Loading**:

- Don't load entire file into memory
- Seek to positions on demand
- Efficient for huge files

**Search and Navigation**:

- `/` to search forward
- `?` to search backward
- `n` / `N` for next/previous match
- `g` / `G` for start/end

**Stateless Display**:

- Each redraw is independent
- No complex state tracking

**Lessons for TUI Developers**:

- Lazy loading enables handling large data
- Consistent search pattern across tools
- Simple state is more robust

### htop: Real-Time Updates

**Key Concepts**:

**Event Loop with Timeout**:

```
loop:
    timeout_event = poll_input(timeout=1000ms)
    if timeout_event or no_input:
        refresh_display()
    elif key_pressed:
        handle_input(key)
```

**Efficient Redrawing**:

- Only update changed regions
- Diff previous state
- Minimize escape sequences

**Interactive Filtering**:

- Type to filter live
- Immediate visual feedback
- No enter key needed

**Lessons for TUI Developers**:

- Periodic refreshes for real-time data
- Incremental search is discoverable
- Visual feedback for all actions

### zellij: Layout System

**Key Concepts**:

**Layout Definitions**:

- Declarative layout files
- Nested panes and tabs
- Serializable state

**Plugin Architecture (WASM)**:

- Sandboxed extensions
- Language-agnostic
- Safe execution

**Lessons for TUI Developers**:

- Declarative layouts easier than imperative
- Serialization enables session saving
- Plugin systems enable extensibility

---

## Input Handling Implementation

### Switching to Raw Mode

**What Raw Mode Does**:

- Disable line buffering (character-by-character input)
- Disable echo (characters not printed automatically)
- Disable special character processing (Ctrl-C doesn't send SIGINT)

**C Implementation**:

```c
#include <termios.h>
#include <unistd.h>

struct termios orig_termios;

void enable_raw_mode() {
    tcgetattr(STDIN_FILENO, &orig_termios);

    struct termios raw = orig_termios;
    raw.c_lflag &= ~(ECHO | ICANON | ISIG | IEXTEN);
    raw.c_iflag &= ~(IXON | ICRNL | BRKINT | INPCK | ISTRIP);
    raw.c_oflag &= ~(OPOST);
    raw.c_cflag |= (CS8);

    tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw);
}

void disable_raw_mode() {
    tcsetattr(STDIN_FILENO, TCSAFLUSH, &orig_termios);
}
```

**Rust Implementation**:

```rust
use termios::{Termios, TCSAFLUSH, ECHO, ICANON, tcsetattr};

fn enable_raw_mode() -> std::io::Result<Termios> {
    let stdin = 0;
    let mut termios = Termios::from_fd(stdin)?;
    let orig = termios.clone();

    termios.c_lflag &= !(ICANON | ECHO);
    tcsetattr(stdin, TCSAFLUSH, &termios)?;

    Ok(orig)
}
```

**Python Implementation**:

```python
import tty
import sys

def enable_raw_mode():
    tty.setraw(sys.stdin.fileno())
```

**Critical**: Always restore original mode before exit!

### Event Loop Patterns

**Blocking Event Loop** (simple):

```
loop:
    key = read_key()      # Blocks until keypress
    handle_key(key)
    redraw_if_needed()
```

**Non-Blocking with Timeout** (for real-time updates):

```
loop:
    key = read_key_with_timeout(100ms)
    if key:
        handle_key(key)
    else:
        update_realtime_data()
    redraw()
```

**Select-Based** (Unix):

```c
#include <sys/select.h>

fd_set readfds;
struct timeval timeout = {.tv_sec = 0, .tv_usec = 100000};

while (running) {
    FD_ZERO(&readfds);
    FD_SET(STDIN_FILENO, &readfds);

    int ret = select(STDIN_FILENO + 1, &readfds, NULL, NULL, &timeout);
    if (ret > 0) {
        char c = read_char();
        handle_input(c);
    } else {
        // Timeout - update display
        update_realtime_data();
    }
    redraw();
}
```

### Parsing Arrow Keys and Function Keys

**Reading Escape Sequences**:

```
read char:
    if char == ESC:
        start_sequence = [ESC]
        read next char with timeout:
            if timeout:
                return ESC key
            if next == '[':
                read until letter:
                    return parse_csi_sequence()
```

**Common Sequences**:

```
ESC[A  → Up
ESC[B  → Down
ESC[C  → Right
ESC[D  → Left
ESC[H  → Home
ESC[F  → End
ESC[5~ → Page Up
ESC[6~ → Page Down
```

**Example Implementation** (Concept):

```
function read_key():
    c = read_char()
    if c != ESC:
        return c

    c = read_char_with_timeout(50ms)
    if timeout:
        return KEY_ESC

    if c == '[':
        c = read_char()
        match c:
            'A': return KEY_UP
            'B': return KEY_DOWN
            'C': return KEY_RIGHT
            'D': return KEY_LEFT
            ...
```

### Mouse Support

**Enable Mouse Reporting**:

```
# Button press and release
printf "\x1b[?1000h"

# Button press, release, and drag
printf "\x1b[?1002h"

# SGR mouse mode (better format, works beyond column 223)
printf "\x1b[?1006h"
```

**Disable Mouse Reporting**:

```
printf "\x1b[?1000l\x1b[?1002l\x1b[?1006l"
```

**Parse Mouse Events**:

```
SGR format: ESC[<button;col;row[M|m]
    M = press
    m = release

button values:
    0 = left
    1 = middle
    2 = right
    64 = scroll up
    65 = scroll down
```

### Handling Resize Events (SIGWINCH)

**Signal Handler**:

```c
#include <signal.h>
#include <sys/ioctl.h>

volatile sig_atomic_t resized = 0;

void handle_sigwinch(int sig) {
    resized = 1;
}

int main() {
    signal(SIGWINCH, handle_sigwinch);

    while (running) {
        if (resized) {
            struct winsize ws;
            ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws);
            terminal_width = ws.ws_col;
            terminal_height = ws.ws_row;
            redraw_all();
            resized = 0;
        }
        // ... event loop
    }
}
```

---

## Rendering Strategies

### Alternate Screen Buffer

**What It Does**:

- Saves current terminal content
- Provides blank screen for your TUI
- Restores previous content on exit

**Enable**:

```
printf "\x1b[?1049h"   # Switch to alternate screen
printf "\x1b[2J"       # Clear screen
printf "\x1b[H"        # Move cursor to home
```

**Disable**:

```
printf "\x1b[?1049l"   # Switch back to main screen
```

**When to Use**:

- Full-screen TUIs (vim, less, htop)
- User expects to return to previous terminal state

**When Not to Use**:

- Persistent output desired (build progress, test results)
- User might want to scroll back

**Learning from less**:

- Uses alternate screen by default
- `-X` flag disables it (leaves output on screen after quit)

### Double Buffering

**Problem**: Visible flicker when redrawing

**Solution**: Build output in memory, write all at once

**Implementation Concept**:

```
# Bad (flickers)
for row in screen:
    print(row)

# Good (double buffered)
buffer = []
for row in screen:
    buffer.append(row)
output = "\n".join(buffer)
print(output)
```

**Advanced**: Diff-based rendering

```
previous_screen = current_screen
current_screen = build_new_screen()

diff = compute_diff(previous_screen, current_screen)
apply_diff(diff)  # Only update changed cells
```

### Efficient Cursor Movement

**Minimize Escape Sequences**:

**Bad** (many small writes):

```
for each_change:
    printf "\x1b[%d;%dH%c"  # Move and write one char
```

**Good** (batch adjacent changes):

```
collect changes into runs:
    printf "\x1b[%d;%dH%s"  # Move once, write string
```

**Relative vs Absolute Movement**:

```
# Absolute (always works)
ESC[5;10H   # Move to row 5, col 10

# Relative (shorter when moving nearby)
ESC[3A      # Move up 3 rows
ESC[5C      # Move right 5 columns
```

### Layout Management

**Fixed Layout**:

```
┌────────────────┬──────────┐
│                │          │
│   Main Area    │ Sidebar  │
│                │          │
├────────────────┴──────────┤
│      Status Bar           │
└───────────────────────────┘
```

**Responsive Layout** (adapt to terminal size):

```
if width < 80:
    single_column_layout()
else:
    two_column_layout()

if height < 24:
    hide_status_bar()
```

**Widget Tree**:

```
Container(vertical)
├─ Header(height=1)
├─ Body(flex=1)
│  ├─ Main(flex=3)
│  └─ Sidebar(flex=1)
└─ Footer(height=1)
```

**Calculate Sizes**:

```
available_height = terminal_height - header - footer
main_width = (available_width * 3) // 4
sidebar_width = available_width - main_width
```

---

## Advanced TUI Topics

### Focus Management

**Concept**: Only one widget receives keyboard input

**Implementation**:

```
class FocusManager:
    widgets = [widget1, widget2, widget3]
    focused_index = 0

    def handle_key(key):
        if key == TAB:
            focused_index = (focused_index + 1) % len(widgets)
        else:
            widgets[focused_index].handle_key(key)
```

**Visual Indication**:

- Highlighted border
- Different color
- Cursor position

**Example from htop**: Arrow keys change focused process

### Modal Dialogs

**Pattern**: Overlay on top of main screen

**Implementation**:

```
render_main_screen()
if dialog_open:
    render_dialog_overlay()
    handle_dialog_input()
else:
    handle_main_input()
```

**Drawing Overlay**:

```
# Save screen state
saved_screen = current_screen

# Draw dialog
draw_rectangle(center, size)
draw_shadow()
draw_dialog_content()

# On close
restore(saved_screen)
```

### Tables and Lists with Scrolling

**Virtual Scrolling**:

```
visible_rows = terminal_height - header - footer
viewport_start = scroll_offset
viewport_end = scroll_offset + visible_rows

for i in range(viewport_start, viewport_end):
    render_row(data[i])
```

**Scrolling Logic**:

```
if cursor > viewport_end:
    scroll_offset += (cursor - viewport_end)
elif cursor < viewport_start:
    scroll_offset -= (viewport_start - cursor)
```

**Learning from less**:

- Smooth scrolling
- Search highlights
- Line numbers

---

# Part 4: Common Development Pitfalls & Solutions

## Buffering Issues (Deep Dive)

_(Expanded from earlier)_

### The 8KB Threshold

**Why 8KB?**: Historical constant from libc (`BUFSIZ` typically 8192)

**Problem Scenario**:

```bash
tail -f /var/log/app.log | grep ERROR | your-tool
# your-tool sees nothing until grep accumulates 8KB
```

### Testing for Buffering Issues

**Test Script**:

```bash
#!/bin/bash
# test-buffering.sh

# Simulate slow input
for i in {1..10}; do
    echo "Line $i"
    sleep 1
done | your-tool

# If tool waits until end, it's block-buffered
# If tool shows each line immediately, it's line-buffered
```

### Line-Buffered Flag Implementation

**Add flag to your tool**:

```
--line-buffered    Flush output after each line
```

**C Implementation**:

```c
if (line_buffered) {
    setvbuf(stdout, NULL, _IOLBF, 0);
}

// Or manual after each line:
printf("%s\n", line);
if (line_buffered || isatty(STDOUT_FILENO)) {
    fflush(stdout);
}
```

---

## Color and Styling Issues

### Detecting Color Support

**Check Multiple Factors**:

```
function should_use_color():
    # Check NO_COLOR (user preference)
    if getenv("NO_COLOR"):
        return false

    # Check if stdout is TTY
    if not isatty(stdout):
        return false

    # Check TERM variable
    term = getenv("TERM")
    if term in ["dumb", "unknown"]:
        return false

    # Check explicit flag
    if color_flag == "never":
        return false
    if color_flag == "always":
        return true

    # Default: yes for TTY, no for pipe
    return true
```

### 16 Color vs 256 Color vs RGB

**16 Colors** (safest):

```
ESC[31m    # Red
ESC[32m    # Green
ESC[33m    # Yellow
ESC[34m    # Blue
```

**256 Colors**:

```
ESC[38;5;COLOR_NUMBERm    # Foreground
ESC[48;5;COLOR_NUMBERm    # Background
# COLOR_NUMBER: 0-255
```

**RGB (TrueColor)**:

```
ESC[38;2;R;G;Bm    # Foreground
ESC[48;2;R;G;Bm    # Background
```

**Detection**:

```
# Check for 256-color support
if "256color" in getenv("TERM"):
    use_256_colors()

# Check for RGB support
if getenv("COLORTERM") in ["truecolor", "24bit"]:
    use_rgb_colors()
```

### Unreadable Color Combinations

**Problem**: Hardcoded colors invisible on some backgrounds

**Solution**: Use semantic colors

```
# Bad
\x1b[38;2;30;30;30m    # Dark gray (invisible on dark terminal)

# Good
\x1b[31m               # Red (user's terminal defines the shade)
```

**Best Practice**: Let users customize theme, or stick to 16 colors

---

## Signal Handling

### SIGINT (Ctrl-C) Implementation

**Requirements**:

- Exit gracefully
- Clean up resources
- Don't leave terminal in broken state

**C Implementation**:

```c
#include <signal.h>

volatile sig_atomic_t interrupted = 0;

void sigint_handler(int sig) {
    interrupted = 1;
}

int main() {
    signal(SIGINT, sigint_handler);

    while (!interrupted) {
        // ... work
    }

    // Cleanup
    cleanup();
    exit(130);  // 128 + SIGINT (2)
}
```

**Rust Implementation**:

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

let interrupted = Arc::new(AtomicBool::new(false));
let r = interrupted.clone();

ctrlc::set_handler(move || {
    r.store(true, Ordering::SeqCst);
}).expect("Error setting Ctrl-C handler");

while !interrupted.load(Ordering::SeqCst) {
    // ... work
}
```

### Multi-Ctrl-C Pattern

**Pattern**: First Ctrl-C = graceful, second Ctrl-C = immediate

**Implementation**:

```
sigint_count = 0

on_sigint:
    sigint_count++

    if sigint_count == 1:
        print("Shutting down gracefully... (Ctrl-C again to force)")
        start_graceful_shutdown()
    elif sigint_count >= 2:
        print("Forcing immediate exit")
        _exit(1)  # Skip cleanup
```

**Learning from Docker Compose**:

```
$ docker-compose down
Stopping container1 ...
^CGracefully stopping... (press Ctrl+C again to force)
^CForcing shutdown
```

### SIGWINCH (Terminal Resize)

**Requirement**: Redraw when terminal size changes

**Implementation**:

```c
#include <signal.h>
#include <sys/ioctl.h>

volatile sig_atomic_t winch_received = 0;

void sigwinch_handler(int sig) {
    winch_received = 1;
}

void get_terminal_size(int *width, int *height) {
    struct winsize ws;
    ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws);
    *width = ws.ws_col;
    *height = ws.ws_row;
}

int main() {
    signal(SIGWINCH, sigwinch_handler);

    while (1) {
        if (winch_received) {
            winch_received = 0;
            get_terminal_size(&width, &height);
            redraw_everything();
        }
        // ...
    }
}
```

---

## Terminal State Management

### Saving and Restoring State

**Problem**: If your TUI crashes, terminal is left in broken state

**Solution**: Save state on entry, restore on exit

**Implementation**:

```c
#include <termios.h>

struct termios orig_termios;
int orig_cursor_visible;

void setup_terminal() {
    // Save original state
    tcgetattr(STDIN_FILENO, &orig_termios);

    // Enter raw mode
    // ...

    // Hide cursor
    printf("\x1b[?25l");

    // Enter alternate screen
    printf("\x1b[?1049h");
}

void restore_terminal() {
    // Show cursor
    printf("\x1b[?25h");

    // Exit alternate screen
    printf("\x1b[?1049l");

    // Restore original terminal state
    tcsetattr(STDIN_FILENO, TCSAFLUSH, &orig_termios);

    // Flush output
    fflush(stdout);
}

void cleanup_and_exit(int code) {
    restore_terminal();
    exit(code);
}
```

**Register Cleanup**:

```c
#include <stdlib.h>

int main() {
    atexit(restore_terminal);

    // Or handle signals
    signal(SIGINT, cleanup_signal_handler);
    signal(SIGTERM, cleanup_signal_handler);

    setup_terminal();
    // ... run TUI
}
```

### Crash-Only Design

**Principle**: Minimize cleanup requirements

**Implementation**:

- Don't require cleanup on exit
- Use atomic operations
- Write state to disk continuously
- Can restart from any point

**Example**: Transaction logs

```
Instead of:
    load_state()
    modify_state()
    save_state()  # ← If this fails, data lost

Use:
    append_operation_to_log()  # ← Atomic
    replay_log_on_startup()
```

---

## Input Parsing Pitfalls

### Unicode Handling

**Problem**: Multi-byte UTF-8 characters

**Example**: `日本語` is 9 bytes but 3 characters

**Solutions**:

- Use UTF-8 aware string length functions
- Be careful with substring operations
- Terminal width != byte count != character count

**Width Calculation**:

```
# ASCII 'A': 1 byte, 1 character, 1 cell width
# 日: 3 bytes, 1 character, 2 cell width (CJK)
# 👍: 4 bytes, 1 character, 2 cell width (emoji)
```

**Libraries**:

- C: libunistring, ICU
- Rust: unicode-width crate
- Python: wcwidth library

### Distinguishing ESC from Escape Sequences

_(Covered earlier, reiterated for pitfalls)_

**Problem**: `ESC` key vs `ESC[A` (up arrow)

**Solution**: Timeout-based parsing (50-100ms)

**Pitfall**: Timeout too short = arrow keys broken on slow connections

**Pitfall**: Timeout too long = ESC key feels sluggish

---

## Output Corruption

### Interleaved Output from Threads

**Problem**:

```
Thread 1: print("Processing item 1")
Thread 2: print("Processing item 2")
Output:   ProceProcessing item 2
          ssing item 1
```

**Solution 1**: Mutex around output

```rust
use std::sync::Mutex;
use std::io::{self, Write};

lazy_static! {
    static ref STDOUT: Mutex<io::Stdout> = Mutex::new(io::stdout());
}

fn print_safe(msg: &str) {
    let mut handle = STDOUT.lock().unwrap();
    writeln!(handle, "{}", msg).unwrap();
}
```

**Solution 2**: Channel to single writer thread

```
Worker threads → Channel → Writer thread → stdout
```

### Progress Bars with Concurrent Output

**Problem**: Log messages corrupt progress bar

**Solution**: Clear line, print message, redraw progress

```
function log_message(msg):
    clear_current_line()
    print(msg)
    redraw_progress_bar()
```

**Better**: Use library that handles this (e.g., indicatif for Rust)

---

## Cross-Platform Issues

### Windows Console vs Unix Terminal

**Differences**:

- Windows traditionally didn't support ANSI escape codes
- Different line endings (CRLF vs LF)
- Different path separators (\ vs /)
- Different PTY implementation

**Windows 10+ Improvements**:

- ANSI escape codes now supported
- Must enable with virtual terminal mode:

```c
#include <windows.h>

void enable_ansi_on_windows() {
    HANDLE hOut = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD dwMode = 0;
    GetConsoleMode(hOut, &dwMode);
    dwMode |= ENABLE_VIRTUAL_TERMINAL_PROCESSING;
    SetConsoleMode(hOut, dwMode);
}
```

**Cross-Platform Abstraction**:

```rust
#[cfg(windows)]
fn setup_terminal() {
    enable_virtual_terminal_processing();
}

#[cfg(unix)]
fn setup_terminal() {
    enable_raw_mode();
}
```

---

## Performance Pitfalls

### Excessive Terminal Writes

**Problem**: Writing to terminal is slow (syscall overhead)

**Bad**:

```rust
for i in 0..1000 {
    println!("{}", i);  // 1000 write syscalls
}
```

**Good**:

```rust
let mut buf = String::new();
for i in 0..1000 {
    buf.push_str(&format!("{}\n", i));
}
print!("{}", buf);  // 1 write syscall
```

### Inefficient Escape Sequences

**Bad**: Redundant sequences

```
ESC[31m R ESC[0m ESC[31m E ESC[0m ESC[31m D ESC[0m
# 15 bytes * 3 = 45 bytes
```

**Good**: Batch coloring

```
ESC[31m RED ESC[0m
# 15 bytes total
```

### Rendering Too Frequently

**Problem**: Redrawing 60 FPS when user only types 1 char/sec

**Solution**: Event-driven updates

```
on_input:
    update_state()
    redraw()

on_timer:
    if has_realtime_data():
        update_data()
        redraw()
```

**Rate Limiting**:

```
last_draw = now()

on_need_redraw:
    if now() - last_draw > 16ms:  # ~60 FPS max
        redraw()
        last_draw = now()
```

---

# Part 5: Development Techniques & Patterns

## Testing Terminal Applications

### Mocking TTY in Tests

**Problem**: Tests don't run in a real TTY

**Solutions**:

**1. PTY (Pseudo-Terminal)**:

**Python with pexpect**:

```python
import pexpect

def test_interactive_prompt():
    child = pexpect.spawn('your-tool')
    child.expect('Enter name:')
    child.sendline('Alice')
    child.expect('Hello, Alice!')
    child.expect(pexpect.EOF)
```

**Rust with pty crate**:

```rust
#[test]
fn test_tty_detection() {
    let pty = pty::fork().unwrap();
    if pty.is_parent() {
        // Parent process - verify child detected TTY
    } else {
        // Child process - runs in PTY
        assert!(atty::is(atty::Stream::Stdout));
    }
}
```

**2. Mock isatty Function**:

```c
// In tests
#define isatty(fd) mock_isatty(fd)
int mock_isatty(int fd) {
    return test_wants_tty ? 1 : 0;
}
```

### Snapshot Testing for Output

**Concept**: Record output, compare on future runs

**Tool**: insta (Rust), jest (JavaScript), pytest (Python)

**Example (Rust with insta)**:

```rust
#[test]
fn test_help_output() {
    let output = run_command("your-tool --help");
    insta::assert_snapshot!(output);
}
```

**First run**: Saves output to snapshot file
**Future runs**: Compares against snapshot
**On change**: Review diff, accept or reject

### Testing Interactive Prompts

**Using expect (traditional Unix tool)**:

```tcl
spawn your-tool
expect "Enter password:"
send "secret123\r"
expect "Login successful"
```

**CI/CD Testing**:

```bash
# Ensure --no-input works
your-tool --no-input --config test.conf

# Should exit with error if interaction required
if your-tool --no-input; then
    echo "FAIL: Should require --force"
    exit 1
fi
```

---

## Development Tools

### Terminal Recording

**asciinema**: Record and share terminal sessions

```bash
# Record
asciinema rec demo.cast

# Play back
asciinema play demo.cast

# Embed in README
asciinema upload demo.cast
```

**VHS** (by Charm): Script terminal recordings

```bash
# demo.tape
Type "your-tool --help"
Enter
Sleep 2s
Screenshot demo.png
```

### Escape Sequence Debugging

**Technique**: Pipe output to `cat -v`

```bash
your-tool | cat -v
# Shows: Hello ^[[31mworld^[[0m
#        (reveals ANSI codes)
```

**Technique**: Use `hexdump`

```bash
your-tool | hexdump -C
```

**Technique**: Enable terminal debugging

```bash
# iTerm2: Session > Log > Start Logging
# Captures all raw input/output
```

### expect for Testing

**Install**:

```bash
# macOS
brew install expect

# Linux
apt-get install expect
```

**Example Test**:

```tcl
#!/usr/bin/expect

spawn your-tool interactive

expect "Enter name:"
send "Alice\r"

expect "Enter age:"
send "30\r"

expect {
    "Success" { exit 0 }
    timeout { exit 1 }
    eof { exit 1 }
}
```

---

## Build and Distribution

### Single Binary Philosophy

**Benefits**:

- Easy installation (just download)
- No dependency hell
- No version conflicts
- Works in containers

**Implementation**:

- Statically link dependencies (Rust, Go do this by default)
- Embed assets at compile time
- Cross-compile for multiple platforms

**Rust Example**:

```toml
# Cargo.toml
[profile.release]
strip = true
lto = true
codegen-units = 1
panic = 'abort'
```

### Cross-Compilation

**Rust**:

```bash
# Install target
rustup target add x86_64-unknown-linux-musl

# Build
cargo build --release --target x86_64-unknown-linux-musl
```

**Go**:

```bash
GOOS=linux GOARCH=amd64 go build
GOOS=darwin GOARCH=arm64 go build
GOOS=windows GOARCH=amd64 go build
```

### Size Optimization

**Techniques**:

- Strip debug symbols
- Enable LTO (Link-Time Optimization)
- Use release mode
- Compress with UPX (controversial)

**Rust**:

```toml
[profile.release]
strip = true
lto = true
opt-level = "z"  # Optimize for size
```

---

## Documentation

### Man Page Structure

**Sections**:

```
NAME
    tool - one-line description

SYNOPSIS
    tool [OPTIONS] FILE...

DESCRIPTION
    Detailed description of what the tool does and how to use it.
    Multiple paragraphs explaining functionality.

OPTIONS
    -h, --help
        Print help information

    -v, --verbose
        Enable verbose output

EXAMPLES
    Basic usage:
        $ tool input.txt

    With options:
        $ tool -v input.txt output.txt

ENVIRONMENT
    TOOL_CONFIG
        Configuration file path

EXIT STATUS
    0   Success
    1   General error
    2   Invalid arguments

SEE ALSO
    related-tool(1), another-tool(1)

BUGS
    Report bugs to: https://github.com/user/tool/issues

AUTHOR
    Written by Your Name.
```

### Learning from git's Help System

**Hierarchical Help**:

```bash
git                  # Lists common commands
git help             # Same as above
git help commit      # Detailed help for subcommand
git commit --help    # Same as above (opens man page)
git commit -h        # Quick reference
```

**Porcelain vs Plumbing**:

- **Porcelain**: User-facing commands (commit, push, pull)
- **Plumbing**: Low-level tools (hash-object, update-index)

**Design Pattern**: Separate user-friendly interface from internal tools

---

# Part 6: Practical Implementation Patterns

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
print("✓ Done!")
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

## Configuration Management

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
# ← If crash here, partial file written

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

---

# Part 7: Technical Reference for Developers

## Argument Parsing Concepts

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

## Terminal Capabilities

### Terminfo Concepts

**Purpose**: Database of terminal capabilities

**Structure**:

```
Terminal Type (from $TERM)
  ├─ Boolean Capabilities (am, xenl, etc.)
  ├─ Numeric Capabilities (cols, lines, colors)
  └─ String Capabilities (cup, clear, bold, etc.)
```

**Querying Terminfo**:

```bash
# Show all capabilities for current terminal
infocmp

# Show specific capability
tput bold        # Output escape sequence for bold
tput colors      # Output number of colors
tput cols        # Output terminal width
```

**Using in Code** (C):

```c
#include <term.h>
#include <curses.h>

setupterm(NULL, STDOUT_FILENO, NULL);

char *clear_screen = tigetstr("clear");
char *bold = tigetstr("bold");

printf("%s", clear_screen);  // Clear screen
printf("%sHello%s", bold, tparm(tigetstr("sgr0")));  // Bold text
```

### Capability Detection Patterns

**Pattern 1**: Try and fallback

```
try:
    output(complex_escape_sequence)
    query_terminal_response()
    if response == expected:
        terminal_supports_feature = true
timeout:
    terminal_supports_feature = false
```

**Pattern 2**: Check $TERM

```
if "256color" in $TERM:
    use_256_colors = true

if $TERM in ["dumb", "unknown"]:
    disable_all_formatting = true
```

**Pattern 3**: Check $COLORTERM

```
if $COLORTERM in ["truecolor", "24bit"]:
    use_rgb_colors = true
```

---

## Environment Variables Reference

### Standard Variables

| Variable       | Purpose                           | How to Use                            |
| -------------- | --------------------------------- | ------------------------------------- |
| NO_COLOR       | Disable colors (user preference)  | If set (any value), disable colors    |
| FORCE_COLOR    | Force colors (override detection) | If set, enable colors even in pipes   |
| CLICOLOR       | Enable colors (0=no, 1=yes)       | BSD convention                        |
| CLICOLOR_FORCE | Force colors (0=no, 1=yes)        | BSD convention                        |
| TERM           | Terminal type identifier          | "xterm-256color", "screen", "dumb"    |
| COLORTERM      | Color capability                  | "truecolor", "24bit" for RGB          |
| COLUMNS        | Terminal width                    | Number of columns                     |
| LINES          | Terminal height                   | Number of rows                        |
| EDITOR         | User's text editor                | "vim", "nano", "code"                 |
| VISUAL         | Visual editor (preferred)         | Same as EDITOR but for visual editors |
| PAGER          | Paging program                    | "less", "more"                        |
| SHELL          | User's shell                      | "/bin/bash", "/bin/zsh"               |
| HOME           | User's home directory             | "/home/username"                      |
| USER           | Current username                  | "alice"                               |
| TMPDIR         | Temporary directory               | "/tmp" or "/var/tmp"                  |
| PATH           | Executable search paths           | ":/usr/bin:/usr/local/bin:..."        |
| LANG           | Locale                            | "en_US.UTF-8"                         |
| LC_ALL         | Locale override                   | Overrides all LC\_\* variables        |
| TZ             | Timezone                          | "America/New_York"                    |
| CI             | Running in CI environment         | "true" (GitHub Actions, GitLab CI)    |
| DEBUG          | Enable debug output               | "1" or "true"                         |

### Naming Your Own Variables

**Convention**: ALL_CAPS with tool name prefix

**Examples**:

```
MYTOOL_CONFIG=/path/to/config
MYTOOL_LOG_LEVEL=debug
MYTOOL_API_KEY=secret
MYTOOL_CACHE_DIR=/tmp/cache
```

**Security**: Never put secrets in environment variables!

- Visible in `ps e` to all users
- Passed to all subprocesses
- Often logged

---

## Exit Codes

### POSIX and Common Codes

| Code  | Meaning                | Usage                           |
| ----- | ---------------------- | ------------------------------- |
| 0     | Success                | Everything worked               |
| 1     | General error          | Unspecified failure             |
| 2     | Misuse                 | Invalid arguments or usage      |
| 64-78 | Various                | /usr/include/sysexits.h         |
| 126   | Cannot execute         | Permission or exec format error |
| 127   | Command not found      | Shell couldn't find the command |
| 128   | Invalid exit code      | Exit code out of range          |
| 128+N | Killed by signal N     | 130 = killed by SIGINT (Ctrl-C) |
| 130   | Terminated by Ctrl-C   | Specifically SIGINT             |
| 255   | Exit code out of range | Return values capped at 255     |

### Designing Exit Codes

**Strategy**: Define meaningful codes for your application

**Example**:

```
0   - Success
1   - General error
2   - Invalid command-line arguments
10  - File not found
11  - Permission denied
12  - Network error
13  - Timeout
20  - Configuration error
30  - Build failed
31  - Tests failed
```

**Document Them**:

```
EXIT STATUS:
    0   Success
    1   General error
    2   Invalid arguments
    10  File not found
    11  Permission denied
```

---

## ANSI Escape Sequences

### CSI Sequences (Control Sequence Introducer)

**Format**: `ESC [ <parameters> <command>`

**Cursor Movement**:

```
ESC[H        # Move to home (1,1)
ESC[<r>;<c>H # Move to row r, column c
ESC[<n>A     # Move up n lines
ESC[<n>B     # Move down n lines
ESC[<n>C     # Move right n columns
ESC[<n>D     # Move left n columns
ESC[<n>E     # Move to beginning of line n lines down
ESC[<n>F     # Move to beginning of line n lines up
ESC[<n>G     # Move to column n
ESC[6n       # Query cursor position (response: ESC[<r>;<c>R)
```

**Erasing**:

```
ESC[J        # Clear from cursor to end of screen
ESC[1J       # Clear from cursor to beginning of screen
ESC[2J       # Clear entire screen
ESC[K        # Clear from cursor to end of line
ESC[1K       # Clear from cursor to beginning of line
ESC[2K       # Clear entire line
```

**Scrolling**:

```
ESC[<n>S     # Scroll up n lines
ESC[<n>T     # Scroll down n lines
```

**SGR (Select Graphic Rendition)** - Colors and Styles:

```
ESC[0m       # Reset all attributes
ESC[1m       # Bold
ESC[2m       # Dim
ESC[3m       # Italic
ESC[4m       # Underline
ESC[5m       # Blinking
ESC[7m       # Reverse video
ESC[8m       # Hidden
ESC[9m       # Strikethrough

# Foreground colors (30-37, 90-97)
ESC[30m      # Black
ESC[31m      # Red
ESC[32m      # Green
ESC[33m      # Yellow
ESC[34m      # Blue
ESC[35m      # Magenta
ESC[36m      # Cyan
ESC[37m      # White
ESC[90-97m   # Bright colors

# Background colors (40-47, 100-107)
ESC[40m      # Black background
ESC[41m      # Red background
...

# 256 colors
ESC[38;5;<n>m   # Foreground (n = 0-255)
ESC[48;5;<n>m   # Background

# RGB colors
ESC[38;2;<r>;<g>;<b>m   # Foreground
ESC[48;2;<r>;<g>;<b>m   # Background
```

### OSC Sequences (Operating System Command)

**Format**: `ESC ] <command> ; <parameters> BEL` or `ESC ] <command> ; <parameters> ESC \`

**Common Uses**:

```
ESC]0;Title\x07          # Set window title
ESC]1;Icon Name\x07      # Set icon name
ESC]2;Window Title\x07   # Set window title (same as 0)

# OSC 52 - Clipboard
ESC]52;c;<base64>\x07    # Copy to clipboard
ESC]52;c;?\x07           # Query clipboard
```

### Private Sequences

**Format**: `ESC [ ? <n> h` (set) or `ESC [ ? <n> l` (reset)

**Common Uses**:

```
ESC[?25h     # Show cursor
ESC[?25l     # Hide cursor
ESC[?1049h   # Use alternate screen buffer
ESC[?1049l   # Use main screen buffer
ESC[?1000h   # Enable mouse button tracking
ESC[?1002h   # Enable mouse button and drag tracking
ESC[?1006h   # Enable SGR mouse mode
```

---

## Signal Reference

### Common Signals

| Signal   | Number | Default Action | Purpose                        |
| -------- | ------ | -------------- | ------------------------------ |
| SIGHUP   | 1      | Terminate      | Hangup (terminal disconnected) |
| SIGINT   | 2      | Terminate      | Interrupt (Ctrl-C)             |
| SIGQUIT  | 3      | Core dump      | Quit (Ctrl-\)                  |
| SIGKILL  | 9      | Terminate      | Kill (cannot be caught)        |
| SIGTERM  | 15     | Terminate      | Termination (polite kill)      |
| SIGSTOP  | 19     | Stop           | Stop (cannot be caught)        |
| SIGTSTP  | 20     | Stop           | Stop (Ctrl-Z)                  |
| SIGCONT  | 18     | Continue       | Continue after stop            |
| SIGWINCH | 28     | Ignore         | Window size change             |

### Handling Signals

**C Implementation**:

```c
#include <signal.h>

void sigint_handler(int sig) {
    // Cleanup
    cleanup();
    exit(128 + sig);
}

int main() {
    signal(SIGINT, sigint_handler);
    signal(SIGTERM, sigint_handler);

    // ... run program
}
```

### Platform Differences

**Signal Numbers Vary**:

- SIGWINCH is 28 on Linux, 23 on BSD/macOS
- Use constants (SIGWINCH) not numbers

**Windows**:

- Very limited signal support
- Ctrl-C sends SIGINT
- No SIGWINCH, SIGHUP, etc.

---

# Part 8: Best Practices Summary

## Top 10 Design Principles

1. **Detect TTY, Format Appropriately**
   - Colors and progress for humans
   - Plain output for pipes
   - Provide `--color` override

2. **Separate stdout and stderr**
   - Results to stdout
   - Errors and diagnostics to stderr
   - Enables composability

3. **Handle Buffering Correctly**
   - Add `--line-buffered` flag
   - Flush after important output
   - Test with pipes

4. **Use Standard Flag Names**
   - `-h`/`--help`, `--version`, `-v`/`--verbose`, `-q`/`--quiet`
   - Users have muscle memory

5. **Provide Excellent Error Messages**
   - Say what went wrong
   - Suggest how to fix it
   - No stack traces by default

6. **Exit with Meaningful Codes**
   - 0 for success
   - Non-zero for errors
   - Document specific codes

7. **Handle Signals Gracefully**
   - Ctrl-C should always work
   - Clean up terminal state
   - Save progress when possible

8. **Support Non-Interactive Mode**
   - `--no-input` flag
   - `--force` for confirmations
   - Critical for CI/CD

9. **Respect User Environment**
   - NO_COLOR, EDITOR, PAGER
   - XDG Base Directory
   - Standard conventions

10. **Test with Real Terminals**
    - Different emulators
    - Different sizes
    - Pipes and redirects

---

## Common Mistakes to Avoid

❌ **Ignoring isatty()** - Always check before colors/progress
❌ **Stack traces for users** - Hide by default, show with --debug
❌ **Secrets in flags** - Use files or prompts instead
❌ **Hanging without feedback** - Show progress or spinner
❌ **Forgetting to flush** - Buffering causes pipes to hang
❌ **Hardcoding RGB colors** - Use 16 ANSI colors for compatibility
❌ **Ignoring SIGINT** - Users expect Ctrl-C to work
❌ **Not restoring terminal state** - Crashes leave broken terminal
❌ **Inconsistent flag names** - Follow standards
❌ **Poor help text** - Include examples

---

## Quick Reference Checklist

**Before releasing your CLI tool**:

- [ ] `-h` shows brief help
- [ ] `--help` shows detailed help
- [ ] `--version` shows version
- [ ] Colors only when TTY (respect NO_COLOR)
- [ ] Progress indicators only when TTY
- [ ] `--no-input` flag works in CI
- [ ] `--json` flag for machine output
- [ ] Exit 0 on success, non-zero on failure
- [ ] Errors go to stderr
- [ ] Results go to stdout
- [ ] Ctrl-C exits gracefully
- [ ] Works in pipes (`tool | grep`, `tool | jq`)
- [ ] Line buffering option for streaming
- [ ] Man page or web docs
- [ ] Examples in help text
- [ ] Clear error messages
- [ ] Single binary (no dependencies)
- [ ] Cross-platform (or clearly document limitations)
- [ ] Tested on major terminals

---

## When to Break the Rules

**Valid reasons**:

- Clear usability improvement
- Domain-specific requirements
- Technical limitations
- Explicitly documented

**Examples**:

- **ripgrep**: Ignores .gitignore by default (breaks UNIX tradition, but better for developers)
- **bat**: Uses full RGB colors (breaks compatibility guideline, but beautiful output is core feature)
- **fzf**: Uses entire screen even for one item (breaks minimalism, but interactive selection is core feature)

**How to break rules**:

1. Document the deviation
2. Provide escape hatch (flag to disable)
3. Have clear rationale
4. Get user feedback

---

# Part 9: When to Ask for Help

Ask the user for clarification or direction when:

## Complex TUI State Management

- Designing widget trees with deep nesting
- Managing focus across multiple panels
- Implementing undo/redo for TUI applications
- Handling modal dialogs with complex interactions

## Platform-Specific Terminal Behavior

- Windows Console API integration
- Handling terminal quirks on specific platforms
- Supporting legacy terminal types
- Cross-platform PTY allocation

## Performance Optimization

- Rendering bottlenecks in large TUIs
- Optimizing large file processing
- Reducing memory usage for streaming data
- Profiling terminal write performance

## Custom Escape Sequence Needs

- Implementing features beyond standard sequences
- Detecting terminal capabilities at runtime
- Falling back when features unsupported
- Working with non-standard terminals

## Testing Strategies

- Mocking complex terminal interactions
- Testing TUI applications in CI
- Snapshot testing for terminal output
- Integration testing with PTYs

## Architecture Decisions

- Choosing between CLI and TUI interfaces
- Client-server architecture for terminal apps
- Plugin systems for CLI tools
- Configuration format selection

## Security Considerations

- Handling sensitive input (passwords, API keys)
- Preventing command injection
- Secure clipboard access
- Sandboxing subprocesses

## Accessibility

- Screen reader compatibility
- High contrast modes
- Keyboard-only navigation
- Alternative text for visual elements

## Advanced Topics

- Building language servers (LSP)
- REPL implementation
- Terminal multiplexer design
- Remote terminal protocols
