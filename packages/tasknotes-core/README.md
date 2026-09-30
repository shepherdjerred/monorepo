# tasknotes-core

The shared Rust core for TaskNotes clients: domain model, sync, store,
recurrence, and NLP logic. The native macOS app
([`packages/tasknotes-macos`](../tasknotes-macos)) runs on it today; iOS and a
possible Windows client are meant to share it.

## Layout

```text
crates/tasknotes-core/      Pure core — no FFI, no I/O, no platform APIs
crates/tasknotes-core-ffi/  UniFFI scaffolding and nothing else
bindings/                   Committed, generated Swift and C# bindings (see bindings/README.md)
tools/uniffi-bindgen-cs/    Pinned C# generator retarget for the UniFFI ABI
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

`generate-bindings` and `check-bindings` need only cargo. The XCFramework and
the Swift smoke test need a macOS host with Xcode. The five Apple static
libraries (macOS arm64 and x86_64, iOS arm64, and both iOS Simulator
architectures) also compile on Linux inside
`ghcr.io/shepherdjerred/macos-cross-compiler:15.0`:

```bash
docker run --platform linux/amd64 --rm \
  -v "$PWD":/src -w /src \
  ghcr.io/shepherdjerred/macos-cross-compiler:15.0@sha256:fb61376ae4288abb57ea477ae55e8b9df280c46bb622d9bb50c4755b6ebbf44f \
  packages/tasknotes-core/ci/apple-cross.sh
```

Run that from the repository root. It installs the Rust pin from `.mise.toml`
inside the image, builds `tasknotes-core-ffi` as a static archive for each
target, and `lipo`s the universal macOS and iOS Simulator slices. It does not
run `xcodebuild` or produce the XCFramework; the image has no iPhoneOS SDK, so
the iOS dynamic library is still linked on the Mac.

Lint policy (no `#[allow]`, no unwrap/panic behind the FFI, deny `as` casts,
deterministic iteration) is encoded in `Cargo.toml` workspace lints,
`clippy.toml`, and `deny.toml` — the comments there are the rationale.
