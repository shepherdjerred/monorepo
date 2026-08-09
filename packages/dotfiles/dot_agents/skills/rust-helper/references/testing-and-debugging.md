# Rust testing and debugging

Read this when writing tests, configuring Nextest or Bacon, running doctests, using Miri, or diagnosing runtime behavior.

## Cargo and libtest arguments

Arguments before `--` belong to Cargo. Arguments after it go to the test binary/libtest:

```bash
cargo test --workspace --all-features -- --nocapture
```

Tests may return a type implementing `Termination`; a panic or non-zero termination fails the test. Prefer concrete assertions or `Result` propagation over `assert!(result.is_ok())`.

## Doctests

Rustdoc executes Rust code blocks as tests by default. Nextest does not run doctests, so retain:

```bash
cargo test --workspace --doc
```

Mark examples `no_run`, `compile_fail`, or `ignore` only when that behavior is part of the documentation contract, not to hide a broken example.

## Nextest

Nextest runs tests in separate processes and provides filtering, archives, and reporting. It is optional and has no universal speed percentage.

Keep retries at zero by default. A retry can mask a flake; enable it narrowly only with explicit reporting and a remediation owner. Do not present retrying as the normal CI profile.

## Bacon

TOML tables cannot be duplicated. A valid focused job combines its fields:

```toml
[jobs.check]
command = ["cargo", "check", "--all-targets", "--color", "always"]
watch = ["src", "tests", "Cargo.toml"]
```

Treat Bacon as a local feedback tool, not evidence that the repository's final CI graph passed.

## Miri

Miri detects certain undefined behavior in executed paths. It cannot prove a library sound, and its Stacked Borrows and Tree Borrows models remain experimental.

Miri isolation is deterministic behavior control, not a security sandbox. `-Zmiri-disable-isolation` exposes real host APIs and changes semantics; use it only with a understood test requirement.

Most FFI and platform APIs are unsupported, though Miri emulates a limited subset. Do not state that all C calls are impossible, and do not promise a fixed slowdown range.

## Edition and unsafe tests

Run `cargo fix --edition` across relevant feature and target combinations because it only observes selected code. For unsafe code, combine focused invariant tests with Miri and, where appropriate, fuzz or property testing.

## Debuggers

Use the platform debugger through rust-analyzer or direct LLDB/GDB integration. LLDB's `po` command is Objective-C-oriented and is not a reliable generic Rust Debug/Display renderer.

## Primary documentation

- [cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html)
- [rustc tests](https://doc.rust-lang.org/rustc/tests/index.html)
- [Rustdoc documentation tests](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html)
- [Miri README](https://github.com/rust-lang/miri/blob/master/README.md)
- [Advanced edition migrations](https://doc.rust-lang.org/edition-guide/editions/advanced-migrations.html)
