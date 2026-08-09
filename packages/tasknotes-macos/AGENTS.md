# packages/tasknotes-macos

The native macOS TaskNotes client, over the shared Rust core in
`packages/tasknotes-core`. Phase 7 of
`packages/docs/plans/2026-08-08_tasknotes-native-macos-app.md`, which is the
canonical spec — read it before changing anything structural here.

Bundle identifier: **`red.sjer.tasknotes.mac`**. Deployment target: **macOS 15**.

## Layout

```text
App/                     @main entry point, entitlements, generated Info.plist
Sources/TaskNotesUniFFI/ re-export of the generated bindings — lint-exempt
Sources/TaskNotesKit/    portable logic — no SwiftUI, no AppKit
Sources/TaskNotesMac/    SwiftUI views, scenes, commands — MainActor
Tests/TaskNotesKitTests/ Swift Testing
ci/no-suppressions.sh    the three gates SwiftLint cannot enforce
project.yml              XcodeGen spec; the .xcodeproj is generated + gitignored
Package.swift            SwiftPM manifest; owns every library target's settings
```

## Prerequisites

```bash
brew install xcodegen swiftlint         # not in .mise.toml: macOS-local tools
cd ../tasknotes-core && cargo xtask build-xcframework
```

The XCFramework is a gitignored build artifact of the Rust side. A clean
checkout has the committed Swift bindings but not the static archive, so that
`cargo xtask` run is required once before the Swift package will link.

## Commands

```bash
bun run lint          # SwiftLint --strict + ci/no-suppressions.sh  (runs in CI)
bun run mac:generate  # xcodegen generate
bun run mac:build     # swift build
bun run mac:test      # swift test
bun run mac:format    # xcrun swift-format, in place
bun run mac:analyze   # SwiftLint analyzer rules (needs a full compiler log)
bun run mac:run       # xcodebuild + launch the .app
bun run mac:verify    # the full local pre-merge gate
```

`bun run mac:verify` is the pre-merge gate for this package. **Run it, and
actually launch the app.** A shell that compiles but was never run is not
verified — every UI regression found here so far (a deep link opening a second
window, for one) was invisible to the compiler and to the tests.

## What runs where, and why

`lint` is the only task in the repository's Linux verify graph. SwiftLint ships
a static Linux binary — the CI image already installs it for the iOS app — so
the semantic gate runs on every PR. Everything else needs a Swift toolchain or
Xcode, which the Linux image does not have and should not grow. This follows the
existing iOS precedent: Buildkite owns what runs on Linux, Xcode Cloud owns
release builds, and anything needing a Mac is a local pre-merge gate, exactly
like `bun run e2e` in `packages/tasks-for-obsidian`.

Consequence to design around: **push correctness below the SwiftUI line.** The
`TaskNotesKit`-has-no-UI-imports rule is load-bearing rather than tidy, and
`ci/no-suppressions.sh` enforces it.

## Rules that are not negotiable here

- **Generated code is exempt; authored code is maximal.** `TaskNotesUniFFI` gets
  only `.swiftLanguageMode(.v6)` and `.defaultIsolation(nil)`. Do not add the
  other gates to it, and do not post-process generated code to satisfy a lint —
  the measurements behind that are in `Package.swift`. `.defaultIsolation(nil)`
  looks unused; it is required by uniffi-rs#2818.
- **No `unsafeFlags`, ever.** It would make the package unusable as a versioned
  dependency, and iOS is meant to consume it later. Everything needed has a
  first-class API in tools-version 6.2.
- **No suppressions.** No `swiftlint:disable`, no `swift-format-ignore`, no
  `baseline:`. If a rule is wrong, change it in `.swiftlint.yml` where the
  decision is reviewable. `ci/no-suppressions.sh` greps for both, because
  `// swiftlint:disable all` can switch off the SwiftLint rule that bans them.
- **SwiftLint owns semantics; `swift-format` owns whitespace.** Do not enable
  layout rules. Two rules are disabled with the evidence attached; that is the
  procedure if a third starts fighting the formatter.
- **`default:` in a switch is banned** (`@unknown default:` is not). It is the
  highest-leverage rule here: the compiler allows it and it then silently
  absorbs every enum case added later.

## Things that will bite

- The core exports a record named `Task`, which collides with
  `_Concurrency.Task`. Authored code uses the `CoreTask` alias from
  `TaskNotesUniFFI`.
- UniFFI error cases keep Rust's PascalCase (`CoreError.Invariant`) while plain
  enums get lowerCamelCase (`TaskStatus.inProgress`). Upstream; do not "fix" it.
- `.accessibilityIdentifier()` on a container pushes the identifier onto child
  text elements and leaves the container unidentified. Call
  `.accessibilityElement(children: .combine)` first. Worst on list rows.
