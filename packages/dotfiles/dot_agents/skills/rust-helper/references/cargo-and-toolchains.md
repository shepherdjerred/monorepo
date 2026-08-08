# Cargo and toolchains

Read this when configuring a workspace, toolchain, MSRV, dependency, Cargo config, Clippy, rustfmt, or optional Rust tool.

## Dependency resolution

Resolver 3 is the Rust 2024 default. Specify it in a virtual workspace. `rust-version` declares MSRV and affects compatible dependency selection.

Use these diagnostics before changing dependency constraints:

```bash
cargo tree -d
cargo tree -e features
cargo report future-incompatibilities
```

`cargo report future-incompatibilities` identifies dependencies that future compilers will reject. It does not replace current tests.

Avoid a static catalog of “best crates” and pinned example versions in a generic skill. Select libraries from maintained official documentation, MSRV compatibility, security posture, API fit, and the repository's existing ecosystem.

## Publishing

Current Cargo supports workspace publishing. Perform a dry run and review the exact package set:

```bash
cargo publish --workspace --dry-run
```

Publishing is an external mutation; do not remove `--dry-run` without explicit authorization and release ownership.

## Configuration

Cargo configuration tables may appear only once per file. Merge build settings:

```toml
[build]
rustc-wrapper = "sccache"
jobs = 8
target-dir = "target"
target = "x86_64-unknown-linux-gnu"
```

This is a structural example, not a universal recommendation. sccache value depends on inputs and CI architecture. Incremental compilation is often disabled in CI; measure the combination instead of setting both globally.

## rustup precedence

Toolchain selection precedence includes an explicit `+toolchain`, `RUSTUP_TOOLCHAIN`, directory or toolchain-file overrides, and the default toolchain. Prefer committed `rust-toolchain.toml` for project requirements and explicit `cargo +nightly` for one-off commands.

Component availability varies by toolchain. Fail clearly when a required component such as Clippy or rustfmt is absent.

## Clippy

`clippy::all` is the default group. Add other lint groups because the repository wants them, not because a generic checklist says to enable every pedantic lint. Pin the toolchain before turning all warnings into errors.

Clippy officially permits narrowly scoped allowances where a lint is intentionally wrong for an invariant. This repository discourages suppressions, so require a documented reason and the smallest possible scope.

`clippy.toml` and `.clippy.toml` are unstable configuration surfaces. Verify keys on every toolchain upgrade.

## rustfmt

Use stable, supported checks:

```bash
cargo fmt --all -- --check
```

Rustfmt's own version does not numerically track rustc. Consult the versioned configuration reference before adding an option, especially during the rustfmt 2.0 transition.

## Optional tools

- cargo-nextest: process-per-test runner; does not run doctests.
- Bacon: background checker configured through project files; avoid duplicate TOML tables.
- cargo-outdated: third-party dependency report.
- cargo-expand: expansion inspection; often requires nightly-compatible internals.
- sccache: compiler cache whose benefit depends on workload and environment.
- Miri: usually a nightly component for interpreter-based undefined-behavior detection.

Check each tool's installed version and project configuration. Never silently skip a required check.

## Primary documentation

- [Cargo workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html)
- [Dependency resolution](https://doc.rust-lang.org/cargo/reference/resolver.html)
- [Rust version](https://doc.rust-lang.org/cargo/reference/rust-version.html)
- [Future incompatibility reports](https://doc.rust-lang.org/cargo/reference/future-incompat-report.html)
- [cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html)
- [cargo fix](https://doc.rust-lang.org/cargo/commands/cargo-fix.html)
- [Clippy usage](https://doc.rust-lang.org/clippy/usage.html)
- [Clippy configuration](https://doc.rust-lang.org/clippy/configuration.html)
- [rustfmt](https://rust-lang.github.io/rustfmt/)
- [rustup overrides](https://rust-lang.github.io/rustup/overrides.html)
- [rustup components](https://rust-lang.github.io/rustup/concepts/components.html)
