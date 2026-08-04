---
name: rust-helper
description: Current Rust and Cargo development guidance for workspaces, editions, MSRV, testing, Clippy, rustfmt, unsafe code, debugging, and toolchains. Use when writing or reviewing Rust, Cargo manifests, Rust CI, edition migrations, or unsafe boundaries.
---

# Rust Helper

Use Rust's type system to express invariants, keep unsafe boundaries small and documented, and run the repository's real Cargo workflow. Separate the stable toolchain from optional ecosystem tools.

## Current baseline

Verified against Rust 1.97.1 on 2026-08-03:

```bash
rustc --version
cargo --version
rustup show active-toolchain
```

Rust 1.97.1 is a patch release with a compiler miscompilation fix. Since Rust 1.93, relevant additions include Cargo TOML 1.1 and config inclusion, `array_windows`, `cfg_select!`, match if-let guards, `assert_matches!`, Cargo registry security fixes, symbol mangling v0 by default, and cache-friendly Cargo warning controls.

Rust 2024 stabilized in Rust 1.85. A package's `rust-version` is its minimum supported Rust version, not the current stable release; do not mechanically update MSRV to 1.97.1.

Read [references/releases.md](references/releases.md) for the 36-page research ledger and release constraints. Read [references/cargo-and-toolchains.md](references/cargo-and-toolchains.md) for workspaces, dependencies, toolchains, Clippy, rustfmt, and optional tools. Read [references/testing-and-debugging.md](references/testing-and-debugging.md) for tests, doctests, Nextest, Miri, profiling, and debugging. Read [references/safety-and-patterns.md](references/safety-and-patterns.md) for unsafe-code obligations and corrected implementation patterns.

## Built-in and optional tools

Built into or distributed as Rust toolchain components:

- `cargo`, `rustc`, and `rustdoc`
- `rustfmt`, Clippy, and rust-analyzer when the component is available for the selected toolchain
- Miri, generally through a compatible nightly toolchain

Optional external tools include cargo-nextest, Bacon, cargo-outdated, cargo-expand, and sccache. Check installation explicitly when the repository requires one; do not silently skip it or present it as a built-in Cargo command.

## Focused verification

Adapt features and targets to the project, but keep each result meaningful:

```bash
cargo check --workspace --all-targets --all-features
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
cargo test --workspace --doc
```

`cargo fmt -- --emit diff` is not supported by current stable rustfmt. `cargo fmt --all -- --check` prints differences and exits non-zero.

Pin the toolchain before making all warnings fatal in reproducible CI. On Rust 1.97+, `CARGO_BUILD_WARNINGS=deny cargo check` denies build warnings without invalidating the build cache.

## Toolchain and MSRV

Commit `rust-toolchain.toml` when the project requires a reproducible compiler and components:

```toml
[toolchain]
channel = "1.97.1"
components = ["clippy", "rustfmt"]
profile = "minimal"
```

Use `cargo +nightly` for a one-off nightly command. Avoid a hidden directory-local rustup override for a project requirement.

Declare the real MSRV in each package:

```toml
[package]
edition = "2024"
rust-version = "1.85"
```

With `rust-version`, `cargo add` selects the newest dependency compatible with that MSRV. It does not blindly choose the latest published version.

## Workspaces

Rust 2024 uses resolver 3. A virtual workspace has no package edition from which to infer it, so specify it explicitly:

```toml
[workspace]
resolver = "3"
members = ["crates/core", "crates/cli", "crates/server"]

[workspace.package]
edition = "2024"
rust-version = "1.85"
```

Workspace members share one lockfile and target directory. Profiles and `[patch]` belong at the workspace root.

## Edition migration

`cargo fix` edits source based on machine-applicable diagnostics and only sees enabled features and selected targets. Commit or otherwise preserve the current state first, then run the migration through every meaningful feature and target combination.

```bash
cargo fix --edition --workspace --all-features
cargo check --workspace --all-targets --all-features
```

After changing each package's edition, rerun formatting, Clippy, tests, and doctests. Rust 2024 warns by default when unsafe operations inside an `unsafe fn` are not enclosed in an explicit `unsafe` block.

## Errors and assertions

Propagate errors when a test or helper can return `Result`. Assert the actual value or invariant; `assert!(result.is_ok())` discards useful failure context.

```rust
#[tokio::test]
async fn fetches_non_empty_body() -> Result<(), reqwest::Error> {
    let body = fetch_data("https://example.com").await?;
    assert!(!body.is_empty());
    Ok(())
}
```

Check cleanup and writer errors when they can change the outcome. Do not ignore `Read`, `Write`, database close, trace write, or process exit errors.

## Ownership and borrowing

Prefer borrowing when a function need not own a value. The beginner rule “one mutable borrow at a time” is incomplete: Rust permits simultaneous mutable borrows when the compiler or an API proves they are disjoint. Do not contort code around a simplified slogan; model the actual aliasing invariant.

For text, remember that string indexes are byte offsets. Never slice an arbitrary byte range that may split UTF-8 or exceed the string length:

```rust
fn preview(summary: &str) -> String {
    let prefix: String = summary.chars().take(20).collect();
    format!("{prefix}...")
}
```

## Unsafe code

Unsafe permits a small set of operations; it does not disable Rust's other checks. Every unsafe boundary transfers a proof obligation to the author:

- minimize the unsafe region,
- use an explicit `unsafe {}` block even inside `unsafe fn`,
- document caller obligations in a `# Safety` section,
- add a `// SAFETY:` explanation at each block,
- test the invariant with focused tests and, where useful, Miri, property tests, or fuzzing.

A clean Miri run checks only the executions observed and does not prove soundness. Miri's aliasing models are experimental, and its isolation is not a security sandbox. Disabling isolation exposes real host APIs.

## Lints and formatting

Use the repository's selected lint groups. Do not enable all of `clippy::pedantic` as a universal default. When a lint is deliberately inapplicable, keep any allowance narrow and explain the invariant. Clippy configuration is explicitly unstable, so verify options against the selected toolchain.

Rustdoc runs Rust code blocks as tests by default. Keep `cargo test --doc` even when cargo-nextest is used, because Nextest does not run doctests.

## Review checklist

- Verify the rustc, Cargo, rustup, and component versions in use.
- Keep MSRV separate from current stable.
- Use resolver 3 explicitly for virtual Rust 2024 workspaces.
- Run formatting, Clippy, tests, and doctests through the actual workspace.
- Treat `cargo fix` and dependency updates as mutations requiring review.
- Distinguish built-in commands from optional tools.
- Propagate meaningful errors and use strong assertions.
- Keep unsafe small, explicit, documented, and tested.
- Treat Miri findings as evidence of a bug and clean runs as bounded evidence only.
- Measure cache, linker, retry, and performance claims on the actual workload.
