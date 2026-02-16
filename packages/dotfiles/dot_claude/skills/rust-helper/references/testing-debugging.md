# Testing and Debugging Rust

Guide to testing with cargo test and nextest, background checking with bacon, debugging with lldb/gdb, profiling, sccache, and miri.

## Testing with cargo test

### Basic Usage

```bash
# Run all tests
cargo test

# Run tests matching a name pattern
cargo test test_name
cargo test tests::module_name

# Run tests in specific package
cargo test -p my-crate

# Run specific test binary
cargo test --bin my-binary
cargo test --lib               # Only library tests
cargo test --doc               # Only doc tests

# Show output from passing tests too
cargo test -- --show-output

# Run ignored tests
cargo test -- --ignored

# Run all tests including ignored
cargo test -- --include-ignored

# Run tests single-threaded
cargo test -- --test-threads=1

# List tests without running
cargo test -- --list
```

### Test Organization

```rust
// Unit tests - in the same file as the code
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic() {
        assert_eq!(add(2, 3), 5);
    }

    #[test]
    fn test_with_result() -> Result<(), Box<dyn std::error::Error>> {
        let result = parse_config("valid_config")?;
        assert_eq!(result.port, 8080);
        Ok(())
    }

    #[test]
    #[should_panic(expected = "index out of bounds")]
    fn test_panic() {
        let v = vec![1, 2, 3];
        let _ = v[99];
    }

    #[test]
    #[ignore]  // Skip by default, run with --ignored
    fn expensive_test() {
        // Long-running test
    }
}
```

### Integration Tests

Place files in `tests/` directory at the project root:

```rust
// tests/integration_test.rs
use my_crate::Config;

#[test]
fn test_full_workflow() {
    let config = Config::new("test");
    assert!(config.validate().is_ok());
}

// tests/common/mod.rs - shared test utilities
pub fn setup() -> TestContext {
    TestContext::new()
}
```

### Doc Tests

```rust
/// Adds two numbers together.
///
/// # Examples
///
/// ```
/// let result = my_crate::add(2, 3);
/// assert_eq!(result, 5);
/// ```
///
/// ```should_panic
/// my_crate::divide(1, 0);
/// ```
///
/// ```no_run
/// // Compiles but doesn't run in tests
/// my_crate::start_server();
/// ```
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
```

### Test Fixtures and Setup

```rust
use std::sync::Once;

static INIT: Once = Once::new();

fn setup() {
    INIT.call_once(|| {
        // One-time initialization
        env_logger::init();
    });
}

#[test]
fn test_with_setup() {
    setup();
    // ...
}

// Using tempfile for filesystem tests
#[test]
fn test_file_operations() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let file_path = dir.path().join("test.txt");
    std::fs::write(&file_path, "hello")?;
    assert_eq!(std::fs::read_to_string(&file_path)?, "hello");
    Ok(())  // dir is cleaned up on drop
}
```

### Async Tests

```rust
#[tokio::test]
async fn test_async_operation() {
    let result = fetch_data().await;
    assert!(result.is_ok());
}

// With multi-threaded runtime
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_concurrent() {
    let (a, b) = tokio::join!(task_a(), task_b());
    assert!(a.is_ok());
    assert!(b.is_ok());
}
```

## Testing with cargo-nextest

### Installation

```bash
cargo install cargo-nextest
```

### Basic Usage

```bash
# Run all tests
cargo nextest run

# Filter by test name
cargo nextest run test_pattern

# Filter by package
cargo nextest run -p my-crate

# Run with specific number of threads
cargo nextest run -j 4

# Run with retries (useful for flaky tests)
cargo nextest run --retries 2

# Run ignored tests
cargo nextest run --run-ignored ignored-only

# List tests
cargo nextest list

# Archive tests for running on another machine
cargo nextest archive --archive-file tests.tar.zst
cargo nextest run --archive-file tests.tar.zst
```

### Nextest Configuration

Create `.config/nextest.toml` in the project root:

```toml
[profile.default]
retries = 0
test-threads = "num-cpus"
fail-fast = true
slow-timeout = { period = "60s", terminate-after = 2 }
status-level = "pass"
final-status-level = "flaky"

[profile.ci]
retries = 2
fail-fast = false
slow-timeout = { period = "120s", terminate-after = 3 }

# Override settings per test
[[profile.default.overrides]]
filter = "test(test_slow)"
slow-timeout = { period = "120s" }
threads-required = 1
```

### Nextest Filter Expressions

```bash
# Run tests matching name
cargo nextest run -E 'test(test_parse)'

# Run tests in specific package
cargo nextest run -E 'package(my-crate)'

# Run tests in specific binary
cargo nextest run -E 'binary(my-crate::bin/my-binary)'

# Combine filters
cargo nextest run -E 'package(core) & test(parse)'

# Exclude tests
cargo nextest run -E 'not test(slow)'

# Platform-specific
cargo nextest run -E 'platform(target) & test(unix)'
```

### Advantages Over cargo test

- Runs each test in a separate process (better isolation)
- Up to 60% faster for large test suites
- Better output formatting and progress reporting
- Built-in retry support for flaky tests
- Filter expressions for precise test selection
- Archive support for CI/CD pipelines
- Slow test detection and termination

## Bacon (Background Checker)

### Installation and Usage

```bash
cargo install bacon

# Start bacon (defaults to `cargo check`)
bacon

# Start with specific job
bacon clippy
bacon test
bacon doc
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `c` | Switch to clippy job |
| `t` | Switch to test job |
| `d` | Switch to doc job |
| `r` | Rerun current job |
| `f` | Focus on failing test |
| `w` | Toggle wrapping |
| `s` | Toggle summary mode |
| `Esc` | Back to all tests / quit focus |
| `q` | Quit bacon |

### Configuration

Create `bacon.toml` in the project root:

```toml
default_job = "check"

[jobs.check]
command = ["cargo", "check", "--all-targets", "--color", "always"]

[jobs.clippy]
command = ["cargo", "clippy", "--all-targets", "--color", "always"]

[jobs.test]
command = ["cargo", "test", "--color", "always"]
need_stdout = true

[jobs.nextest]
command = ["cargo", "nextest", "run", "--color", "always"]
need_stdout = true

[jobs.doc]
command = ["cargo", "doc", "--no-deps", "--color", "always"]

[jobs.run]
command = ["cargo", "run", "--color", "always"]
need_stdout = true
allow_warnings = true
background = true

# Watch additional directories
[jobs.check]
watch = ["src", "tests", "Cargo.toml"]
```

## Debugging with LLDB and GDB

### Setup

Compile with debug info (default in dev profile):

```bash
# Debug build (has debug symbols)
cargo build

# Release build with debug info
# Add to Cargo.toml:
# [profile.release]
# debug = true
cargo build --release
```

### LLDB (macOS default, Linux)

```bash
# Start LLDB with binary
rust-lldb target/debug/my-binary

# Or with arguments
rust-lldb -- target/debug/my-binary arg1 arg2
```

Common LLDB commands:

```
# Set breakpoints
b main                          # Break at main
b src/parser.rs:42              # Break at file:line
b my_crate::parse_config        # Break at function
br set -n parse_config -c "input.len() > 100"  # Conditional breakpoint

# Run and control
r                               # Run
n                               # Step over (next line)
s                               # Step into
finish                          # Step out (finish current function)
c                               # Continue to next breakpoint

# Inspect
p variable_name                 # Print variable
p *pointer                      # Dereference pointer
po my_vec                       # Pretty-print (calls Debug/Display)
frame variable                  # All local variables
bt                              # Backtrace
bt all                          # All thread backtraces

# Watchpoints
w set var my_variable           # Break when variable changes
w set expr -w write -- &data[0] # Watch memory address

# Thread inspection
thread list                     # List all threads
thread select 2                 # Switch to thread 2
```

### GDB (Linux preferred)

```bash
# Start GDB
rust-gdb target/debug/my-binary
```

Common GDB commands:

```
# Breakpoints
break main
break src/parser.rs:42
break parse_config if input.len() > 100

# Run and control
run
next                # Step over
step                # Step into
finish              # Step out
continue            # Continue

# Inspect
print variable
print *pointer
info locals
backtrace
info threads
thread 2

# TUI mode
tui enable          # Show source in terminal
layout src          # Source layout
layout split        # Source + assembly
```

### VS Code Debugging

Install the CodeLLDB extension. Add `.vscode/launch.json`:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "lldb",
            "request": "launch",
            "name": "Debug binary",
            "cargo": {
                "args": ["build", "--bin=my-binary"],
                "filter": {
                    "name": "my-binary",
                    "kind": "bin"
                }
            },
            "args": [],
            "cwd": "${workspaceFolder}"
        },
        {
            "type": "lldb",
            "request": "launch",
            "name": "Debug unit tests",
            "cargo": {
                "args": ["test", "--no-run", "--lib"],
                "filter": {
                    "name": "my-crate",
                    "kind": "lib"
                }
            },
            "args": ["--test-threads=1"],
            "cwd": "${workspaceFolder}"
        }
    ]
}
```

## Profiling

### CPU Profiling with flamegraph

```bash
cargo install flamegraph

# Generate flamegraph
cargo flamegraph                        # Profile default binary
cargo flamegraph --bin my-binary        # Specific binary
cargo flamegraph -- --arg1 value        # With arguments

# On macOS, may need:
cargo flamegraph --root
# Or use dtrace permissions:
sudo cargo flamegraph
```

### Binary Size Analysis

```bash
cargo install cargo-bloat

# Show largest functions
cargo bloat --release

# Show largest crates
cargo bloat --release --crates

# Show top N
cargo bloat --release -n 20
```

### Compile Time Analysis

```bash
# Show time spent in each compilation step
cargo build --timings

# Output HTML report
cargo build --timings=html
```

## sccache (Shared Compilation Cache)

### Setup

```bash
# Install
cargo install sccache

# Configure globally in ~/.cargo/config.toml
[build]
rustc-wrapper = "sccache"

# Or set environment variable
export RUSTC_WRAPPER=sccache
```

### Usage

```bash
# Check cache statistics
sccache --show-stats

# Reset statistics
sccache --zero-stats

# Stop the sccache server
sccache --stop-server

# Start with specific cache size
SCCACHE_CACHE_SIZE="10G" sccache --start-server
```

### Remote Cache Backends

```bash
# S3 backend
export SCCACHE_BUCKET=my-sccache-bucket
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...

# Redis backend
export SCCACHE_REDIS=redis://localhost:6379

# Local disk (default)
export SCCACHE_DIR=/path/to/cache
export SCCACHE_CACHE_SIZE=10G
```

## Miri (Undefined Behavior Detection)

### Setup and Usage

```bash
# Install miri (nightly only)
rustup +nightly component add miri

# Run program under miri
cargo +nightly miri run

# Run tests under miri
cargo +nightly miri test

# Run specific test
cargo +nightly miri test test_name

# Run with specific flags
MIRIFLAGS="-Zmiri-disable-isolation" cargo +nightly miri test
MIRIFLAGS="-Zmiri-symbolic-alignment-check" cargo +nightly miri test
```

### What Miri Detects

- Out-of-bounds memory accesses
- Use-after-free
- Use of uninitialized data
- Invalid use of primitives (e.g., bool that is not 0 or 1)
- Violation of aliasing rules (Stacked Borrows / Tree Borrows)
- Data races in concurrent code
- Memory leaks
- Invalid pointer arithmetic / provenance violations
- Deadlocks

### Common Miri Flags

| Flag | Purpose |
|------|---------|
| `-Zmiri-disable-isolation` | Allow system calls (file I/O, env vars) |
| `-Zmiri-symbolic-alignment-check` | Stricter alignment checking |
| `-Zmiri-tree-borrows` | Use Tree Borrows model (experimental) |
| `-Zmiri-seed=N` | Set random seed for reproducibility |
| `-Zmiri-ignore-leaks` | Do not report memory leaks |

### Miri Limitations

- Cannot run code that calls into C libraries (FFI)
- Significantly slower than normal execution (10-100x)
- Requires nightly toolchain
- Does not detect all forms of undefined behavior
- Cannot check hardware-specific behavior

### When to Use Miri

Run miri on code that:
- Uses `unsafe` blocks
- Performs raw pointer manipulation
- Implements data structures with manual memory management
- Uses transmute or other low-level operations
- Implements concurrent algorithms with atomics

## Benchmarking

### Criterion

```rust
// benches/my_benchmark.rs
use criterion::{criterion_group, criterion_main, Criterion, black_box};

fn fibonacci(n: u64) -> u64 {
    match n {
        0 => 1,
        1 => 1,
        n => fibonacci(n - 1) + fibonacci(n - 2),
    }
}

fn criterion_benchmark(c: &mut Criterion) {
    c.bench_function("fib 20", |b| b.iter(|| fibonacci(black_box(20))));

    // Benchmark group for comparison
    let mut group = c.benchmark_group("fibonacci");
    for size in [10, 15, 20].iter() {
        group.bench_with_input(
            format!("fib_{size}"),
            size,
            |b, &size| b.iter(|| fibonacci(black_box(size))),
        );
    }
    group.finish();
}

criterion_group!(benches, criterion_benchmark);
criterion_main!(benches);
```

```toml
# Cargo.toml
[[bench]]
name = "my_benchmark"
harness = false

[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }
```

```bash
# Run benchmarks
cargo bench

# Run specific benchmark
cargo bench -- fibonacci

# Compare against baseline
cargo bench -- --save-baseline before
# Make changes...
cargo bench -- --baseline before
```

## CI/CD Patterns

### GitHub Actions Example

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2

      - name: Check
        run: cargo check --workspace --all-targets

      - name: Clippy
        run: cargo clippy --workspace --all-targets -- -D warnings

      - name: Format
        run: cargo fmt -- --check

      - name: Test
        run: cargo nextest run --workspace

      - name: Doc tests
        run: cargo test --doc

  miri:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@nightly
        with:
          components: miri
      - name: Miri
        run: cargo +nightly miri test
```
