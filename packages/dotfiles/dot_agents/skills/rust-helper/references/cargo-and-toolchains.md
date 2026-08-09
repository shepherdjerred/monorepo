# Cargo and toolchains

Read this when configuring a workspace, toolchain, MSRV, dependency, Cargo config, Clippy, rustfmt, or optional Rust tool.

## Dependency resolution

Resolver 3 is the Rust 2024 default. Specify it in a virtual workspace. `rust-version` declares MSRV and affects compatible dependency selection.

Run these diagnostics in order. `cargo test --future-incompat-report` must
complete before `cargo report future-incompatibilities`: the test command
generates the report, while the report command only reads it. Cargo reports
`0 dependencies had future-incompatible warnings` when the result is clean but
does not create a report in that case, so treat that successful result as
complete and skip the reader. Any other reader failure requires investigation.
Add `--locked` to dependency-resolving commands when the project commits
`Cargo.lock`; omit it for libraries that intentionally do not commit a
lockfile. Do not create or commit a lockfile solely to run these inspections.

For a project that commits `Cargo.lock`, use:

```bash
cargo tree --locked -d
cargo tree --locked -e features
future_incompat_output="$(mktemp)"
trap 'rm -f "$future_incompat_output"' EXIT
if cargo test --locked --future-incompat-report >"$future_incompat_output" 2>&1; then
  cat "$future_incompat_output"
  if ! rg -Fq '0 dependencies had future-incompatible warnings' "$future_incompat_output"; then
    cargo report future-incompatibilities --locked
  fi
else
  cat "$future_incompat_output"
  exit 1
fi
```

For a library that intentionally does not commit `Cargo.lock`, copy the current
working tree to an isolated disposable directory and run the diagnostics there.
Do not use `git clone`: it copies `HEAD` and omits uncommitted or untracked
source and manifest changes. The disposable copy contains the temporary
`Cargo.lock`, so the source checkout remains lockfile-free:

```bash
diagnostics_dir="$(mktemp -d)"
(
  trap 'rm -rf "$diagnostics_dir"' EXIT
  rsync -a --exclude '.git' --exclude 'target' --exclude 'Cargo.lock' ./ "$diagnostics_dir/"
  cd "$diagnostics_dir"
  cargo tree -d
  cargo tree -e features
  future_incompat_output="$(mktemp)"
  trap 'rm -f "$future_incompat_output"' EXIT
  if cargo test --future-incompat-report >"$future_incompat_output" 2>&1; then
    cat "$future_incompat_output"
    if ! rg -Fq '0 dependencies had future-incompatible warnings' "$future_incompat_output"; then
      cargo report future-incompatibilities
    fi
  else
    cat "$future_incompat_output"
    exit 1
  fi
)
```

`cargo test --future-incompat-report` generates the report, and `cargo report
future-incompatibilities` then identifies dependencies that future compilers
will reject; neither command replaces the project's focused verification.

Avoid a static catalog of “best crates” and pinned example versions in a generic skill. Select libraries from maintained official documentation, MSRV compatibility, security posture, API fit, and the repository's existing ecosystem.

## Publishing

Use workspace publishing only when `cargo publish --help` lists `--workspace` as stable. For a project that commits `Cargo.lock`, pass `--locked` so dependency drift fails instead of rewriting the lockfile. Perform a dry run and review the exact package set:

```bash
cargo publish --workspace --locked --dry-run
```

On Cargo versions where `--workspace` is absent or marked unstable, inspect the workspace members with `cargo metadata --no-deps --format-version 1`, exclude packages whose manifests disable publishing, order the remaining packages by their workspace dependency relationships, and dry-run each package explicitly:

```bash
cargo publish --package <package-name> --locked --dry-run
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
