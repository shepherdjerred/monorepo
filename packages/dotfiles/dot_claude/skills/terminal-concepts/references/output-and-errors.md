# Output Design, Error Handling, Signals, and Terminal State

## TTY Detection Pattern

**Core Pattern**:

```
if is_tty(stdout):
    format = HumanReadable(colors=True, progress=True)
else:
    format = MachineReadable(colors=False, progress=False)
```

**Implementation**:

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

## Color Implementation

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

## JSON and Machine-Readable Output

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

## Progress Indicators

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
Processing...
Processing...
Processing...
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

## Pager Integration

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

### POSIX and Common Exit Codes Reference

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

### Signal Reference

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
    save_state()  # If this fails, data lost

Use:
    append_operation_to_log()  # Atomic
    replay_log_on_startup()
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
