# Buffering Deep Dive

## Three Buffering Modes

**Unbuffered**: Every write goes directly to the destination
- Slowest (syscall overhead)
- Used for stderr by default

**Line Buffered**: Flush on newlines
- Used for stdout when writing to TTY
- Balance of performance and responsiveness

**Block Buffered**: Flush when buffer full (~8KB)
- Used for stdout when writing to pipe/file
- Most efficient for throughput

## Why Your Program Uses Different Buffering

The standard library (libc, Go runtime, Python runtime) **automatically detects** with `isatty()`:

```
if isatty(stdout):
    use_line_buffering()     # Interactive user
else:
    use_block_buffering()    # Pipe or file
```

**This is why pipes get stuck!**

## The Pipe Buffering Problem

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

### The 8KB Threshold

**Why 8KB?**: Historical constant from libc (`BUFSIZ` typically 8192)

**Problem Scenario**:
```bash
tail -f /var/log/app.log | grep ERROR | your-tool
# your-tool sees nothing until grep accumulates 8KB
```

## Solutions for Developers Building CLI Tools

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

## Testing Buffered Output

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
