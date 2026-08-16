# tasknotes-core

The shared Rust core for TaskNotes clients: domain model, sync, store,
recurrence, and NLP logic. The native macOS app
([`packages/tasknotes-macos`](../tasknotes-macos)) runs on it today; iOS and a
possible Windows client are meant to share it.

## Layout

```text
crates/tasknotes-core/      Pure core — no FFI, no I/O, no platform APIs
crates/tasknotes-core-ffi/  UniFFI scaffolding and nothing else
bindings/                   Committed, generated Swift bindings (see bindings/README.md)
xtask/                      cargo xtask: bindings + XCFramework tooling
```

## Iron rules

1. **The core is pure and sans-I/O.** `crates/tasknotes-core` has no clock, no
   filesystem, no network. HTTP and storage arrive as host-implemented traits.
2. **`bindings/` is committed on purpose.** UniFFI `Record` field order is the
   ABI; reordering two same-typed fields leaves every API checksum and the C
   header byte-identical. `cargo xtask check-bindings` (regenerate + `git diff
--exit-code`) is the only mechanical guard against that silent
   data-corruption class. Never regenerate without committing the diff. See
   [bindings/README.md](bindings/README.md).
3. **[`@tasknotes/fixtures`](../tasknotes-fixtures) is the oracle, not test
   data.** The same JSON scenarios and recurrence corpus are executed by both
   the TypeScript and Rust implementations
   (`crates/tasknotes-core/tests/sync.rs`, `recurrence_corpus.rs`); that is
   what keeps them from drifting. A fixture that disagrees with an
   implementation is a finding, never a file to edit.

## Commands

The package is a Turbo shim over cargo, so it participates in the workspace
task graph. Directly or via `bunx turbo run <task> --filter=tasknotes-core`:

```bash
bun run build       # cargo build --workspace --all-targets
bun run test        # cargo test --workspace
bun run typecheck   # cargo check --workspace --all-targets --all-features
bun run lint        # fmt + clippy -D warnings + no-suppressions + check-bindings + cargo deny
bun run bindings    # cargo xtask generate-bindings
```

xtask directly (the `xtask` alias is defined in `.cargo/config.toml`):

```bash
cargo xtask generate-bindings   # regenerate Swift bindings in place
cargo xtask check-bindings      # regenerate + git diff --exit-code
cargo xtask build-xcframework   # build artifacts/TaskNotesCoreFFI.xcframework
cargo xtask verify-swift        # compile and run Swift against the artifacts
```

`generate-bindings` and `check-bindings` need only cargo; the XCFramework
targets require a macOS host with Xcode.

Lint policy (no `#[allow]`, no unwrap/panic behind the FFI, deny `as` casts,
deterministic iteration) is encoded in `Cargo.toml` workspace lints,
`clippy.toml`, and `deny.toml` — the comments there are the rationale.
