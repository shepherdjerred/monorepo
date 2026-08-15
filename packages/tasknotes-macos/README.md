# tasknotes-macos

**Facet** for macOS: a native SwiftUI client over the shared Rust core in
[`packages/tasknotes-core`](../tasknotes-core). Bundle identifier
`red.sjer.tasknotes.mac`, deployment target macOS 15.

## Architecture

Three SwiftPM library targets (`Package.swift` owns their settings; the split
is deliberate):

- `TaskNotesUniFFI` — the seam onto the machine-generated UniFFI bindings from
  `tasknotes-core/bindings/`; lint-exempt by design.
- `TaskNotesKit` — all portable logic, zero SwiftUI/AppKit imports, so the bulk
  of correctness testing runs headless. Includes `Host/` (the core's
  host-implemented traits: clock, randomness, retry scheduler, HTTP, storage)
  and `Store/` (the `@Observable` store over `FfiSyncEngine`).
- `TaskNotesMac` — SwiftUI views, scenes, and commands; `MainActor`-isolated.

The Xcode application target (`project.yml`, XcodeGen — the `.xcodeproj` is
generated and gitignored) links `TaskNotesMac` and supplies only the `@main`
entry point in `App/`, so SwiftPM and Xcode compile the same sources.

Tests: `Tests/TaskNotesKitTests` (Swift Testing, headless),
`Tests/TaskNotesMacTests` (image snapshots; the only test target that sees
SwiftUI), `UITests/` (XCUITest, run via `mac:e2e`).

## Building and testing

Requires a macOS host with Xcode, plus the Rust toolchain for the core.
Every script that compiles Swift runs `mac:preflight` first: the committed
bindings are generated source and the XCFramework they link is a gitignored
artifact, so regenerating one without rebuilding the other produces
`Undefined symbol: _uniffi_…` errors that look like someone else's broken
edit rather than a stale build.

```bash
bun run mac:build         # preflight + swift build
bun run mac:test          # preflight + swift test
bun run mac:typecheck     # preflight + swift build --build-tests
bun run mac:snapshots     # snapshot suite only (TaskNotesMacTests)
bun run lint              # SwiftLint --strict + ci/no-suppressions.sh
bun run mac:format        # swift-format in place (mac:format:check to verify)

bun run mac:generate      # xcodegen generate → TaskNotes.xcodeproj
bun run mac:app           # Debug app build (mac:app:release for Release)
bun run mac:run           # build + open the Debug app
bun run mac:smoke         # Release build + verify it launches and stays up
bun run mac:e2e           # XCUITest suite
bun run mac:verify        # generate + build + test + lint + format + app + smoke

bun run mac:release       # operator-run release lane (scripts/release.ts)
```

Only `lint` participates in the repository's Linux CI verify graph — SwiftLint
ships a static Linux binary, while every `mac:` script needs a Swift toolchain
or Xcode and is a local pre-merge step. The root lefthook `pre-commit` hook
runs the fast build/test/lint subset when `.swift` files here are staged, and
`mac:smoke` when bundle-affecting files (`project.yml`, `App/`, …) change.
`mac:verify` is the pre-PR command.

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes, including the
host-layer contract, threading rules, and release procedure.
