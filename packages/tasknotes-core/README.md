# tasknotes-core

The shared Rust workspace for TaskNotes clients: domain model, sync, store,
recurrence, NLP, lossless vault documents, and Obsidian Sync encryption.
The macOS and Windows clients consume its native bindings. Standalone vault
operations use the `tasknotes-vault` API independently of the existing server
client.

## Layout

```text
crates/tasknotes-core/      Pure core — no FFI, no I/O, no platform APIs
crates/tasknotes-vault/     Vault paths, settings, mappings, conditional Markdown edits
crates/obsidian-sync/       Reference-tested Obsidian Sync encryption primitives
crates/tasknotes-core-ffi/  UniFFI scaffolding and nothing else
bindings/                   Committed, generated Swift, C#, and Kotlin bindings
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
bun run test        # pinned upstream-default check + cargo test --workspace
bun run typecheck   # cargo check --workspace --all-targets --all-features
bun run lint        # fmt + clippy -D warnings + no-suppressions + check-bindings + cargo deny
bun run bindings    # cargo xtask generate-bindings
```

xtask directly (the `xtask` alias is defined in `.cargo/config.toml`):

```bash
cargo xtask generate-bindings   # regenerate Swift, C#, and Kotlin together
cargo xtask check-bindings      # regenerate + git diff --exit-code
cargo xtask build-xcframework   # build artifacts/TaskNotesCoreFFI.xcframework
cargo xtask verify-swift        # compile and run Swift against the artifacts
```

`generate-bindings` and `check-bindings` need only cargo; the XCFramework
targets require a macOS host with Xcode.

## Vault API

`TaskDocument::parse` validates UTF-8 Markdown and mapping frontmatter. Its
`plan` method returns replacement bytes plus SHA-256 revisions. Unknown keys,
comments, body text, BOMs, and line endings remain in the document; a semantic
check rejects edits that change properties outside the requested plan.
Body replacement is explicit. Invalid YAML, duplicate keys, unsafe logical
paths, and duplicate property edits return typed errors.

Writes are plans, not filesystem mutations. A host must journal the plan,
compare freshly read bytes with `expected_revision`, and atomically replace
the target while holding its writer coordination mechanism. The hash check
alone does not prevent a race between checking and replacing a local file.
Folder adapters also enforce platform filename and symlink boundaries.

`TaskNotesConfiguration::resolve` selects one whole provider in this order:
`.obsidian/plugins/tasknotes/data.json`, then `tasknotes.yaml`, then explicitly
approved standard settings. Settings from lower providers are not merged.
A present invalid selected provider fails; it never silently falls through.
Standard model defaults are pinned to `@tasknotes/model@0.3.0-rc.9` and checked
by `ci/vault-reference.ts`. This package is a development oracle; apps do not
execute it.

Plugin settings support custom field names, status values and cycle rules,
priority values, task identification, title storage, and creation status and
priority. Portable YAML supports `mapping`, `status`, `defaults`, single
`task_detection.method`, and `title.storage`. Additional policies remain
available in configuration metadata; those policies are not executed by this
layer. Multi-method portable detection returns an unsupported configuration
error. This API does not yet claim full TaskNotes specification conformance.

Native hosts access `FfiVaultDocument`, `FfiVaultConfiguration`, and
`VaultDocumentWrite` through their host boundary. JSON properties and edits
carry configurable and unknown fields without introducing a second native
schema. These exports do not start a local HTTP server.

## Sync encryption reference

`obsidian-sync` implements encryption versions 0, 2, and 3: NFKC-normalized
scrypt key derivation, version-specific key proofs, deterministic encrypted
paths, and authenticated file content frames. Key material is zeroized and
debug output is redacted. Content encryption requires a fresh secure random
12-byte nonce from the host for every invocation.

Offline tests compare exact bytes with vectors generated by the pinned
official headless client, using public synthetic inputs only. The explicit
maintenance command `bun ci/obsidian-reference.ts` verifies the source hash,
extracts only its cryptographic reference functions, and regenerates the
vectors. Ordinary tests use committed vectors without downloading or running
the official client. See the [fixture provenance](../tasknotes-fixtures/vault/README.md).

Encryption compatibility does not establish end-to-end Sync compatibility.
This crate does not yet authenticate accounts, connect WebSockets, maintain
replicas, transfer files, merge conflicts, or persist a synchronization cursor.

Lint policy (no `#[allow]`, no unwrap/panic behind the FFI, deny `as` casts,
deterministic iteration) is encoded in `Cargo.toml` workspace lints,
`clippy.toml`, and `deny.toml` — the comments there are the rationale.
