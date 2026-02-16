# TUI Development Guide

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

| Key | Function | Origin |
|-----|----------|--------|
| Ctrl-A | Start of line | Emacs |
| Ctrl-E | End of line | Emacs |
| Ctrl-B | Back one character | Emacs |
| Ctrl-F | Forward one character | Emacs |
| Ctrl-P | Previous line/history | Emacs |
| Ctrl-N | Next line/history | Emacs |
| Ctrl-K | Kill to end of line | Emacs |
| Ctrl-U | Kill entire line | UNIX |
| Ctrl-W | Delete word backward | UNIX |
| Ctrl-D | Delete character forward (or EOF) | UNIX |
| Ctrl-H | Delete character backward | UNIX |

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
Normal Mode -> (i) -> Insert Mode
           | (v)           ^ (ESC)
     Visual Mode <-<-<-<-<-<-<-
           | (:)
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
Terminal 1 -> tmux client ->
                          -> tmux server -> sessions -> windows -> panes
Terminal 2 -> tmux client ->
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
ESC[A  -> Up
ESC[B  -> Down
ESC[C  -> Right
ESC[D  -> Left
ESC[H  -> Home
ESC[F  -> End
ESC[5~ -> Page Up
ESC[6~ -> Page Down
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
+----------------+----------+
|                |          |
|   Main Area    | Sidebar  |
|                |          |
+----------------+----------+
|      Status Bar           |
+---------------------------+
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
+- Header(height=1)
+- Body(flex=1)
|  +- Main(flex=3)
|  +- Sidebar(flex=1)
+- Footer(height=1)
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
Worker threads -> Channel -> Writer thread -> stdout
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
