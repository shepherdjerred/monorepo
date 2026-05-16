# Cargo and the Rust Ecosystem

Comprehensive reference for Cargo commands, workspace patterns, popular crates, dependency management, features, and build configuration.

## Cargo Commands Reference

### Project Management

```bash
# Create new project
cargo new my-project           # Binary
cargo new my-lib --lib         # Library
cargo init                     # Initialize in current directory
cargo init --lib               # Initialize as library

# Build
cargo build                    # Debug build
cargo build --release          # Release build (optimized)
cargo build --target x86_64-unknown-linux-musl  # Cross-compile

# Run
cargo run                      # Build and run
cargo run --release            # Run release build
cargo run -- arg1 arg2         # Pass arguments to binary
cargo run --bin specific-bin   # Run specific binary
cargo run --example my_example # Run an example

# Check (faster than build, no codegen)
cargo check                    # Check compilation
cargo check --all-targets      # Check including tests, benches, examples

# Clean
cargo clean                    # Remove target directory
cargo clean -p my-crate        # Clean specific package

# Update dependencies
cargo update                   # Update all within semver bounds
cargo update -p serde          # Update specific package
```

### Documentation

```bash
# Generate and open docs
cargo doc --open               # Build docs for project + deps
cargo doc --no-deps --open     # Just project docs
cargo doc -p my-crate --open   # Specific crate docs

# Rustdoc specific
cargo rustdoc -- --cfg docsrs  # Build with docs.rs cfg
```

### Dependency Management

```bash
# Add dependencies
cargo add serde                           # Latest version
cargo add serde@1.0.200                   # Specific version
cargo add serde --features derive         # With features
cargo add tokio --features full           # All features
cargo add my-crate --path ../my-crate     # Local path
cargo add my-crate --git https://github.com/user/repo  # Git

# Add as dev dependency
cargo add tokio --dev --features test-util

# Add as build dependency
cargo add cc --build

# Remove dependency
cargo remove serde

# View dependency tree
cargo tree                                # Full tree
cargo tree -d                             # Duplicates only
cargo tree -i serde                       # Inverse (who depends on serde)
cargo tree --depth 1                      # Top-level only
cargo tree -e features                    # Show feature flags

# Check for outdated dependencies
cargo install cargo-outdated
cargo outdated

# Audit dependencies for security
cargo install cargo-audit
cargo audit
```

### Publishing

```bash
# Package for publishing
cargo package                  # Create .crate file
cargo package --list           # List files that would be included

# Publish to crates.io
cargo publish
cargo publish --dry-run        # Check without publishing

# Yank (remove from dependency resolution, still downloadable)
cargo yank --version 1.0.0
cargo yank --version 1.0.0 --undo
```

### Workspace Publishing (Rust 1.90+)

```bash
# Publish all workspace members in dependency order
cargo publish --workspace

# Publish specific packages
cargo publish -p crate-a -p crate-b
```

## Cargo.toml Configuration

### Basic Structure

```toml
[package]
name = "my-project"
version = "0.1.0"
edition = "2024"
rust-version = "1.85"
description = "A brief description"
license = "MIT OR Apache-2.0"
repository = "https://github.com/user/repo"
keywords = ["keyword1", "keyword2"]
categories = ["category"]
exclude = ["tests/fixtures/*"]

[dependencies]
# Version requirements
serde = "1"                    # >=1.0.0, <2.0.0
serde = "=1.0.200"            # Exactly 1.0.200
serde = ">=1.0, <1.5"         # Range
serde = { version = "1", features = ["derive"] }

# Path dependency (local)
my-lib = { path = "../my-lib" }

# Git dependency
my-lib = { git = "https://github.com/user/repo", branch = "main" }
my-lib = { git = "https://github.com/user/repo", tag = "v1.0" }
my-lib = { git = "https://github.com/user/repo", rev = "abc123" }

# Optional dependency (becomes a feature)
extra-feature = { version = "1", optional = true }

[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }
tempfile = "3"
proptest = "1"

[build-dependencies]
cc = "1"
```

### Features

```toml
[features]
default = ["json"]
json = ["dep:serde_json"]           # Enable optional dep
full = ["json", "xml", "yaml"]      # Combine features
xml = ["dep:quick-xml"]
yaml = ["dep:serde_yaml"]

# Feature enables feature in dependency
async = ["tokio/full"]
```

Use features in code:

```rust
#[cfg(feature = "json")]
pub mod json {
    use serde_json;
    // ...
}

#[cfg(feature = "async")]
pub async fn fetch() { /* ... */ }
```

### Build Profiles

```toml
# Development profile (cargo build)
[profile.dev]
opt-level = 0          # No optimization
debug = true           # Full debug info
debug-assertions = true
overflow-checks = true
incremental = true
codegen-units = 256    # Faster compile, slower code

# Release profile (cargo build --release)
[profile.release]
opt-level = 3          # Maximum optimization
debug = false          # No debug info
lto = true             # Link-time optimization (slower build, faster binary)
codegen-units = 1      # Slower compile, faster code
strip = true           # Strip symbols
panic = "abort"        # Smaller binary, no unwinding

# Optimize deps in dev mode (faster runtime, same compile speed for your code)
[profile.dev.package."*"]
opt-level = 2

# Custom profile
[profile.profiling]
inherits = "release"
debug = true           # Debug info for profiling tools
strip = false
```

### Target-Specific Configuration

```toml
# Platform-specific dependencies
[target.'cfg(unix)'.dependencies]
nix = "0.29"

[target.'cfg(windows)'.dependencies]
windows = "0.58"

[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2"
```

## Workspace Patterns

### Basic Workspace

```toml
# Root Cargo.toml
[workspace]
members = [
    "crates/core",
    "crates/cli",
    "crates/server",
]
resolver = "2"

# Shared dependencies
[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
anyhow = "1"
tracing = "0.1"

# Shared package metadata
[workspace.package]
edition = "2024"
rust-version = "1.85"
license = "MIT"
repository = "https://github.com/user/repo"
```

### Member Cargo.toml

```toml
[package]
name = "my-cli"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true

[dependencies]
# Inherit from workspace
serde.workspace = true
tokio.workspace = true
anyhow.workspace = true

# Additional crate-specific deps
clap = { version = "4", features = ["derive"] }

# Depend on sibling crate
my-core = { path = "../core" }
```

### Workspace Commands

```bash
# Build all members
cargo build --workspace

# Test all members
cargo test --workspace

# Run clippy on all members
cargo clippy --workspace --all-targets

# Build specific member
cargo build -p my-cli

# Run specific member's tests
cargo test -p my-core

# Check all members
cargo check --workspace
```

## Popular Crates Reference

### Serialization

| Crate        | Purpose                 | Usage                               |
| ------------ | ----------------------- | ----------------------------------- |
| `serde`      | Serialization framework | `#[derive(Serialize, Deserialize)]` |
| `serde_json` | JSON support            | `serde_json::to_string(&val)?`      |
| `serde_yaml` | YAML support            | `serde_yaml::from_str(s)?`          |
| `toml`       | TOML support            | `toml::from_str(s)?`                |
| `bincode`    | Binary encoding         | Fast, compact binary format         |
| `csv`        | CSV parsing             | Streaming CSV read/write            |

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct Config {
    name: String,
    port: u16,
    #[serde(default)]
    debug: bool,
    #[serde(rename = "api_key")]
    key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}
```

### Async Runtime and Networking

| Crate     | Purpose                           |
| --------- | --------------------------------- |
| `tokio`   | Async runtime (de facto standard) |
| `reqwest` | HTTP client (async-first)         |
| `axum`    | Web framework (tokio ecosystem)   |
| `tonic`   | gRPC framework                    |
| `tower`   | Service abstraction / middleware  |
| `hyper`   | Low-level HTTP                    |

```rust
// Axum web server example
use axum::{routing::get, Router, Json};

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/", get(root))
        .route("/users", get(list_users));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn root() -> &'static str {
    "Hello, World!"
}

async fn list_users() -> Json<Vec<User>> {
    Json(vec![User { name: "Alice".into() }])
}
```

### CLI Tools

| Crate       | Purpose                              |
| ----------- | ------------------------------------ |
| `clap`      | Argument parsing (derive or builder) |
| `dialoguer` | Interactive prompts                  |
| `indicatif` | Progress bars                        |
| `console`   | Terminal colors and formatting       |
| `colored`   | Simple terminal coloring             |

```rust
use clap::Parser;

/// A simple CLI tool
#[derive(Parser, Debug)]
#[command(version, about)]
struct Args {
    /// Name of the person to greet
    #[arg(short, long)]
    name: String,

    /// Number of times to greet
    #[arg(short, long, default_value_t = 1)]
    count: u8,

    /// Enable verbose output
    #[arg(short, long)]
    verbose: bool,
}

fn main() {
    let args = Args::parse();
    for _ in 0..args.count {
        println!("Hello {}!", args.name);
    }
}
```

### Database

| Crate      | Purpose                                   |
| ---------- | ----------------------------------------- |
| `sqlx`     | Async SQL (compile-time checked queries)  |
| `sea-orm`  | ORM built on sqlx                         |
| `diesel`   | Sync ORM with compile-time query checking |
| `rusqlite` | SQLite bindings                           |

### Error Handling

| Crate       | Purpose                                | Use When              |
| ----------- | -------------------------------------- | --------------------- |
| `thiserror` | Derive custom error types              | Library code          |
| `anyhow`    | Flexible error aggregation             | Application code      |
| `eyre`      | Enhanced error reporting (like anyhow) | Alternative to anyhow |
| `miette`    | Fancy diagnostic errors                | CLI tools             |

### Logging and Tracing

| Crate                | Purpose                          |
| -------------------- | -------------------------------- |
| `tracing`            | Structured, async-aware logging  |
| `tracing-subscriber` | Configure tracing output         |
| `log`                | Simple logging facade            |
| `env_logger`         | Configure log via `RUST_LOG` env |

```rust
use tracing::{info, warn, error, instrument};
use tracing_subscriber;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    info!("Starting application");
}

#[instrument(skip(password))]
async fn login(username: &str, password: &str) -> Result<User, Error> {
    info!(username, "Login attempt");
    // ...
}
```

### Testing and Development

| Crate        | Purpose                   |
| ------------ | ------------------------- |
| `criterion`  | Benchmarking framework    |
| `proptest`   | Property-based testing    |
| `mockall`    | Mock generation           |
| `wiremock`   | HTTP mocking              |
| `tempfile`   | Temporary files for tests |
| `insta`      | Snapshot testing          |
| `assert_cmd` | CLI integration testing   |
| `predicates` | Assertion helpers         |

### Other Essential Crates

| Crate       | Purpose                                 |
| ----------- | --------------------------------------- |
| `regex`     | Regular expressions                     |
| `chrono`    | Date and time                           |
| `uuid`      | UUID generation                         |
| `rand`      | Random number generation                |
| `rayon`     | Data parallelism (parallel iterators)   |
| `crossbeam` | Concurrent data structures              |
| `dashmap`   | Concurrent HashMap                      |
| `bytes`     | Efficient byte buffer                   |
| `once_cell` | Lazy initialization (now partly in std) |
| `itertools` | Extended iterator methods               |
| `strum`     | Enum string conversions                 |

## Build Scripts

### build.rs

```rust
// build.rs - runs before compilation
fn main() {
    // Tell cargo to rerun if this file changes
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/proto/service.proto");

    // Set environment variable accessible via env!()
    println!("cargo:rustc-env=BUILD_TIME={}", chrono::Utc::now());

    // Enable cfg flag
    println!("cargo:rustc-cfg=has_feature_x");

    // Link native library
    println!("cargo:rustc-link-lib=sqlite3");

    // Compile protobuf
    tonic_build::compile_protos("src/proto/service.proto").unwrap();
}
```

### Accessing Build Script Output

```rust
// In your Rust code
const BUILD_TIME: &str = env!("BUILD_TIME");

#[cfg(has_feature_x)]
fn feature_x() { /* ... */ }
```

## Cargo Configuration

### .cargo/config.toml

```toml
# Build configuration
[build]
rustc-wrapper = "sccache"      # Use sccache
jobs = 8                        # Parallel jobs
target-dir = "target"           # Custom target dir

# Default target
[build]
target = "x86_64-unknown-linux-gnu"

# Linker configuration
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=lld"]

# macOS specific
[target.aarch64-apple-darwin]
rustflags = ["-C", "link-arg=-fuse-ld=/usr/local/bin/zld"]

# Aliases
[alias]
t = "test"
c = "check"
cl = "clippy --all-targets"
b = "build"
r = "run"
```

## Environment Variables

| Variable            | Purpose                                 |
| ------------------- | --------------------------------------- |
| `CARGO_HOME`        | Cargo installation directory (~/.cargo) |
| `RUSTC_WRAPPER`     | Compiler wrapper (e.g., sccache)        |
| `RUST_LOG`          | Log level for env_logger/tracing        |
| `RUST_BACKTRACE`    | Enable backtraces (`1` or `full`)       |
| `RUSTFLAGS`         | Additional compiler flags               |
| `CARGO_TARGET_DIR`  | Override target directory               |
| `CARGO_INCREMENTAL` | Enable/disable incremental compilation  |

```bash
# Common development environment
export RUST_LOG=debug
export RUST_BACKTRACE=1
export RUSTC_WRAPPER=sccache
export CARGO_INCREMENTAL=1
```

## Cargo Install (Developer Tools)

```bash
# Essential tools
cargo install cargo-nextest     # Better test runner
cargo install cargo-watch       # Watch and rebuild
cargo install cargo-outdated    # Check outdated deps
cargo install cargo-audit       # Security audit
cargo install cargo-expand      # Expand macros
cargo install cargo-flamegraph  # CPU profiling
cargo install cargo-bloat       # Binary size analysis
cargo install cargo-deny        # Lint dependencies
cargo install bacon             # Background checker
cargo install sccache           # Compilation cache
```
