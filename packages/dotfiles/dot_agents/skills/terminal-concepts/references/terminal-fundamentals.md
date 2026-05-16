# Terminal Fundamentals

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
