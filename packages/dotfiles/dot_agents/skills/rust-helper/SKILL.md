---
name: rust-helper
description: |
  Rust development with cargo, clippy, rustfmt, testing, and common patterns
  When user works with .rs files, mentions Rust, cargo, clippy, rustfmt, or encounters Rust compiler errors
---

# Rust Helper Agent

## What's New in Rust (2024-2026)

- **Rust 2024 Edition** (1.85, Feb 2025): Largest edition yet. Async closures `async || {}`, RPIT lifetime capture changes, `unsafe extern` blocks, `unsafe_op_in_unsafe_fn` warning by default, `gen` keyword reserved, `expr` fragment matches `const` and `_`
- **Trait Upcasting** (1.86): Coerce `&dyn Trait` to `&dyn Supertrait` directly
- **Disjoint Mutable Indexing** (1.86): `slice.get_disjoint_mut([i, j])` for multiple mutable refs
- **Let Chains** (1.88, edition 2024): `if let Some(x) = a && x > 5 { ... }`
- **Naked Functions** (1.88): `#[naked]` for functions with no compiler-generated prologue/epilogue
- **Inline ASM Jumps** (1.87): Assembly can jump to Rust code labels
- **LLD Default Linker** (1.90): `lld` is default on `x86_64-unknown-linux-gnu` for faster linking
- **C-style Variadic Functions** (1.91): Stabilized for sysv64, win64, efiapi, aapcs ABIs
- **Explicitly Inferred Const Args** (1.92): Deny-by-default never_type_fallback lints
- **Conditional ASM Lines** (1.93): Individual `asm!` statements support `cfg` attributes
- **String/Vec `into_raw_parts`** (1.93): `String::into_raw_parts()`, `Vec::into_raw_parts()`
- **Current stable**: 1.93.0 (Jan 2026)

## Overview

This skill covers Rust development using cargo, clippy, rustfmt, testing frameworks (cargo test, nextest), background checking (bacon), compilation caching (sccache), and undefined behavior detection (miri). It includes ownership/borrowing patterns, error handling, async/await, and the cargo ecosystem.

## CLI Commands

### Auto-Approved Safe Commands

```bash
# Check compilation without producing binaries
cargo check

# Run clippy lints
cargo clippy

# Format code
cargo fmt -- --check

# Run tests
cargo test

# Run nextest
cargo nextest run

# Build (debug)
cargo build

# Show documentation
cargo doc --open

# List dependencies
cargo tree

# Check for outdated deps
cargo outdated

# Expand macros
cargo expand

# Show current toolchain
rustup show

# Run bacon (background checker)
bacon
```

### Build and Run

```bash
# Debug build
cargo build

# Release build (optimized)
cargo build --release

# Build specific package in workspace
cargo build -p my-crate

# Build with specific features
cargo build --features "feature1,feature2"
cargo build --all-features
cargo build --no-default-features

# Run binary
cargo run
cargo run --release
cargo run -- --arg1 value1

# Run specific binary in multi-bin project
cargo run --bin my-binary

# Cross-compile
rustup target add aarch64-unknown-linux-gnu
cargo build --target aarch64-unknown-linux-gnu
```

### Clippy

```bash
# Run clippy
cargo clippy

# Clippy with all targets (tests, benches, examples)
cargo clippy --all-targets

# Deny warnings (useful in CI)
cargo clippy -- -D warnings

# Enable pedantic lints
cargo clippy -- -W clippy::pedantic

# Fix automatically
cargo clippy --fix

# Clippy for specific package
cargo clippy -p my-crate
```

Configure in `clippy.toml` or via attributes:

```rust
// Allow specific lint
#[allow(clippy::needless_return)]

// Project-wide in lib.rs or main.rs
#![warn(clippy::all, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]
```

### Rustfmt

```bash
# Format all files
cargo fmt

# Check formatting without changing files
cargo fmt -- --check

# Format specific file
rustfmt src/main.rs

# Show diff of formatting changes
cargo fmt -- --emit diff
```

Configure in `rustfmt.toml`:

```toml
edition = "2024"
max_width = 100
tab_spaces = 4
use_field_init_shorthand = true
```

### Toolchain Management

```bash
# Install/update stable
rustup update stable

# Install nightly
rustup toolchain install nightly

# Use nightly for current project
rustup override set nightly

# Add component
rustup component add clippy rustfmt rust-analyzer

# Add compilation target
rustup target add wasm32-unknown-unknown

# Show installed toolchains
rustup show
```

## Essential Patterns Quick Reference

### Ownership and Borrowing

```rust
// Move semantics (non-Copy types)
let s1 = String::from("hello");
let s2 = s1;  // s1 is moved, no longer usable

// Borrowing (immutable reference)
let s = String::from("hello");
let len = calculate_length(&s);  // s is borrowed, still usable

// Mutable borrowing (one at a time)
let mut s = String::from("hello");
change(&mut s);

// Slice borrowing
let s = String::from("hello world");
let hello = &s[0..5];
```

### Error Handling

```rust
// Result with ? operator
fn read_config(path: &str) -> Result<Config, Box<dyn std::error::Error>> {
    let contents = std::fs::read_to_string(path)?;
    let config: Config = serde_json::from_str(&contents)?;
    Ok(config)
}

// Option with ? in functions returning Option
fn first_even(numbers: &[i32]) -> Option<&i32> {
    numbers.iter().find(|&&n| n % 2 == 0)
}

// Pattern matching on Result/Option
match result {
    Ok(value) => println!("Got: {value}"),
    Err(e) => eprintln!("Error: {e}"),
}

// if let for single variant
if let Some(value) = optional {
    println!("Got: {value}");
}
```

### Iterators

```rust
// Chain iterator adapters
let result: Vec<i32> = items.iter()
    .filter(|x| x.is_valid())
    .map(|x| x.value * 2)
    .collect();

// Enumerate
for (i, item) in items.iter().enumerate() {
    println!("{i}: {item}");
}

// fold / reduce
let sum: i32 = numbers.iter().fold(0, |acc, &x| acc + x);

// flat_map
let words: Vec<&str> = lines.iter()
    .flat_map(|line| line.split_whitespace())
    .collect();
```

### Struct and Enum Patterns

```rust
// Struct with derive macros
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
struct Config {
    name: String,
    port: u16,
    #[serde(default)]
    verbose: bool,
}

// Enum with data
enum Command {
    Quit,
    Echo(String),
    Move { x: i32, y: i32 },
    Color(u8, u8, u8),
}

// impl block
impl Config {
    fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            port: 8080,
            verbose: false,
        }
    }
}
```

## Bacon (Background Checker)

```bash
# Start bacon (watches for changes, shows errors)
bacon

# Keyboard shortcuts inside bacon:
# c - show clippy warnings
# t - run tests
# d - open documentation
# f - focus on failing test (when test fails)
# Esc - back to all tests
```

Configure in `bacon.toml`:

```toml
[jobs.check]
command = ["cargo", "check", "--all-targets"]

[jobs.clippy]
command = ["cargo", "clippy", "--all-targets"]

[jobs.test]
command = ["cargo", "test"]

[jobs.nextest]
command = ["cargo", "nextest", "run"]
```

## sccache (Compilation Cache)

Set up sccache to speed up repeated compilations:

```bash
# Install
cargo install sccache

# Configure in ~/.cargo/config.toml
# [build]
# rustc-wrapper = "sccache"

# Or via environment variable
export RUSTC_WRAPPER=sccache

# Check stats
sccache --show-stats

# Clear cache
sccache --zero-stats
```

## Miri (Undefined Behavior Detection)

```bash
# Install miri (requires nightly)
rustup +nightly component add miri

# Run program under miri
cargo +nightly miri run

# Run tests under miri
cargo +nightly miri test

# Run specific test
cargo +nightly miri test test_name

# Set isolation (disable for tests needing system access)
MIRIFLAGS="-Zmiri-disable-isolation" cargo +nightly miri test
```

Miri detects: uninitialized memory reads, out-of-bounds access, use-after-free, data races, invalid pointer provenance, type invariant violations.

## Cargo.toml Quick Reference

```toml
[package]
name = "my-project"
version = "0.1.0"
edition = "2024"
rust-version = "1.85"

[dependencies]
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
anyhow = "1"
thiserror = "2"
clap = { version = "4", features = ["derive"] }
tracing = "0.1"

[dev-dependencies]
tokio = { version = "1", features = ["test-util"] }

[profile.release]
lto = true
codegen-units = 1
strip = true

[profile.dev]
opt-level = 0    # Fast compile
debug = true     # Full debug info

[profile.dev.package."*"]
opt-level = 2    # Optimize dependencies even in dev
```

## When to Ask for Help

Ask the user for clarification when:

- Lifetime annotations are ambiguous or complex
- Choice between async and sync is unclear
- Error handling strategy (anyhow vs thiserror vs custom) needs deciding
- Workspace structure decisions are needed
- Unsafe code review is required
- Performance vs readability tradeoffs exist

---

See `references/` for detailed guides:

- `patterns.md` - Ownership, traits, generics, lifetimes, async/await, iterators
- `cargo-ecosystem.md` - Cargo commands, workspaces, popular crates, features, build scripts
- `testing-debugging.md` - Testing with nextest, bacon, debugging with lldb, profiling, miri
