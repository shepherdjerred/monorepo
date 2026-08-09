# `bindings/` — the committed Swift bindings

Machine-generated. Never hand-edit anything under `Sources/` or `ffi/`; run
`cargo xtask generate-bindings` and commit the result.

```text
bindings/
├── Package.swift                          authored — the SwiftPM manifest
├── Sources/TaskNotesCore/TaskNotesCore.swift   generated — the Swift API
├── ffi/TaskNotesCoreFFI.h                 generated — the C header
├── ffi/module.modulemap                   generated — the clang module
└── artifacts/TaskNotesCoreFFI.xcframework  built, gitignored
```

## Why these files are committed

`cargo xtask check-bindings` regenerates them and runs `git diff --exit-code`.
That is gate 7 of the plan, and it is the **only** mechanical guard against one
specific silent data-corruption bug.

UniFFI writes `Record` fields _positionally_ into the FFI buffer. Swapping two
same-typed fields of a record is therefore an ABI break — Rust keeps writing
field A where Swift now reads field B. Measured during the Phase 6 spike:
swapping two same-typed fields left **all 16 API checksums identical and the
generated C header byte-identical**. `uniffiCheckApiChecksums()` does not detect
it. No Rust lint detects it. No Swift lint detects it. Only this diff does.

So: if a `check-bindings` failure shows only a reordering of fields inside a
generated `struct`, that is not churn to rubber-stamp. It is the gate firing.

## Commands

```bash
cargo xtask generate-bindings        # regenerate, in place
cargo xtask check-bindings           # regenerate + git diff --exit-code  (gate 7)
cargo xtask build-xcframework        # + lipo + xcodebuild → artifacts/
cargo xtask verify-swift             # + compile and run Swift against it
```

`generate-bindings` and `check-bindings` need only cargo and run on **Linux**;
UniFFI reads its metadata out of the built library's symbol table, and that
metadata is host-independent. `build-xcframework` and `verify-swift` need
`lipo`, `xcodebuild`, and a Swift toolchain, so they are macOS-only.

## Build settings on this package

`TaskNotesCore` carries exactly two Swift settings, and both are load-bearing:

| Setting                   | Why                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.swiftLanguageMode(.v6)` | the repository baseline                                                                                                                                                                                                                                                              |
| `.defaultIsolation(nil)`  | **required.** [uniffi-rs#2818](https://github.com/mozilla/uniffi-rs/issues/2818) makes generated bindings uncompilable under `MainActor` default isolation as soon as a callback interface has a **throwing** method — which is exactly the sans-I/O shape this core is built around |

It deliberately does **not** get `.strictMemorySafety()`, `ExistentialAny`,
`InternalImportsByDefault`, or `.treatAllWarnings(as: .error)`. Measured, not
assumed (Phase 6 spike, Swift 6.4 / Xcode 27): those produce 37, 19, 65, and 0
errors respectively on generated code, and the 37 are **not** post-processable —
116 of the underlying warnings are "expression uses unsafe constructs" on
arbitrary expressions and the flag is module-wide with no file-level opt-out.

This costs nothing, and that is also measured: a consumer target keeps
`.strictMemorySafety()` _and_ `.treatAllWarnings(as: .error)` and builds clean
while calling into this module. Unsafety does not leak across the module
boundary. `cargo xtask verify-swift` builds its smoke target with both settings
on, so that property is re-checked on every run rather than trusted.

## Two upstream quirks to expect, not fix

- **Error cases keep Rust's `PascalCase`.** `CoreError.Invariant(message:)`,
  `CoreError.NotFound(message:)` — while plain enums get lowerCamelCase
  (`TaskStatus.inProgress`). That inconsistency is upstream. Since this target
  is lint-exempt it will never fail a build, but it will look odd at call sites
  in authored Swift.
- **The validated newtypes are `typealias`es to `String`.** `TaskId`,
  `ProjectName`, `ContextName`, `TagName`, `TaskTitle`, and `ExtraFields` all
  cross as strings. The invariant lives in Rust: passing `"Tasks/a.txt"` as a
  `TaskId` throws `CoreError.Invariant` at the boundary rather than corrupting
  state inland. `ExtraFields` is a JSON object string, because UniFFI has no
  `Any` type.

## Consuming this package

For development, depend on it by path:

```swift
.package(path: "../tasknotes-core/bindings")
```

The `TaskNotesCore` product is `type: .dynamic`, so the static Rust archive is
linked once into a single dylib rather than into every consuming target.

For release, the `binaryTarget` switches from `path:` to `url:` + `checksum:`.
That is a Phase 7 packaging decision and is deliberately not made here.
