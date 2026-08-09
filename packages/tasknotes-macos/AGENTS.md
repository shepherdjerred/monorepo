# packages/tasknotes-macos

The native macOS TaskNotes client, over the shared Rust core in
`packages/tasknotes-core`. Phase 7 of
`packages/docs/plans/2026-08-08_tasknotes-native-macos-app.md`, which is the
canonical spec — read it before changing anything structural here.

Bundle identifier: **`red.sjer.tasknotes.mac`**. Deployment target: **macOS 15**.

## Layout

```text
App/                          @main entry point, entitlements, generated Info.plist
Sources/TaskNotesUniFFI/      re-export of the generated bindings — lint-exempt
Sources/TaskNotesKit/         portable logic — no SwiftUI, no AppKit
  Host/                       the core's host traits, implemented
  Store/                      the @Observable store over FfiSyncEngine
Sources/TaskNotesMac/         SwiftUI views, scenes, commands — MainActor
Tests/TaskNotesKitTests/      Swift Testing
  Support/                    the spawned-server harness and shared fixtures
Tests/TaskNotesMacTests/      image snapshots — the only test target that sees SwiftUI
ci/no-suppressions.sh         the three gates SwiftLint cannot enforce
project.yml                   XcodeGen spec; the .xcodeproj is generated + gitignored
Package.swift                 SwiftPM manifest; owns every library target's settings
```

## The host layer

The core is sans-I/O: it reads no clock, opens no socket and touches no file.
`Sources/TaskNotesKit/Host/` is the other half of that contract — seven traits
declared in `tasknotes-core/src/sync/host.rs` and `src/store/migrations.rs`,
implemented once each.

| Generated protocol    | Implementation           | Where its state lives                      |
| --------------------- | ------------------------ | ------------------------------------------ |
| `Clock` (`CoreClock`) | `SystemClock`            | none; injectable instant + timezone        |
| `Randomness`          | `SystemRandomness`       | none                                       |
| `RetryScheduler`      | `DispatchRetryScheduler` | `Mutex<Set<TimerId>>` + a serial queue     |
| `TaskApi`             | `URLSessionTaskApi`      | none; `URLSession`                         |
| `QueueStorage`        | `FileHostStorage`        | `queue.json`, `dead-letter.json`           |
| `TaskCacheStorage`    | `FileHostStorage`        | `tasks.json`, `id-aliases.json`, …         |
| `MigrationStorage`    | `FileHostStorage`        | `schema-version.json`, `legacy-queue.json` |

Three rules that are not obvious from the signatures:

- **The engine must never be driven from the main thread.** The core's `TaskApi`
  is synchronous, so `URLSessionTaskApi` blocks its caller. It refuses a
  main-thread call with `CoreError.Invariant` rather than freezing the UI, and
  `TaskNotesStore` reaches the global executor with `@concurrent` — which is
  load-bearing, because `NonisolatedNonsendingByDefault` makes a plain
  `nonisolated async` function inherit its caller's isolation.
- **Cancellation is never propagated, only called.** UniFFI 0.31 has no async
  cancellation at all. `DispatchRetryScheduler` treats an armed timer as an id
  in a set and cancellation as its removal, checked at fire time under the same
  lock — no `Task` to cancel, no `DispatchWorkItem` race, and `cancel` on an
  already-fired timer is a no-op by construction.
- **Storage is the app container, never the vault.** The app is sandboxed with
  no broad filesystem entitlement. `FileHostStorage.containerDefault()` resolves
  through `FileManager`, which returns the redirected container path inside the
  sandbox and the real one outside, so the same call is correct in the app and
  in a test bundle. Vault access is a separate capability needing a system open
  panel plus a security-scoped bookmark.

`Sources/TaskNotesKit/Host/WireBridge.swift` is **temporary and marked so**: the
`/v2` rename table, path-as-id, and envelope unwrapping already exist in
`tasknotes-core/src/domain/wire.rs` but are not exported, because `TaskApi` is a
domain-level trait rather than a transport-level one. Do not grow it; it has a
demolition date.

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
bun run mac:snapshots # render the screens to .build/snapshots as PNGs
bun run mac:format    # xcrun swift-format, in place
bun run mac:analyze   # SwiftLint analyzer rules (needs a full compiler log)
bun run mac:run       # xcodebuild + launch the .app
bun run mac:verify    # the full local pre-merge gate
```

`bun run mac:verify` is the pre-merge gate for this package. **Run it, and
actually launch the app.** A shell that compiles but was never run is not
verified — every UI regression found here so far (a deep link opening a second
window, for one) was invisible to the compiler and to the tests.

## Image snapshots

`bun run mac:snapshots` renders the Today screen, its rows, and the sync banner
to PNGs in `.build/snapshots/` (gitignored) and prints their absolute paths. It
is the plan's "Image snapshot — SwiftUI — `.image` via `NSHostingView`" row, and
it lives in `Tests/TaskNotesMacTests` because `TaskNotesKit` has no UI imports
by design and `ci/no-suppressions.sh` enforces that.

Three rules hold it in place:

- **It renders offscreen, and that is a hard requirement rather than a
  preference.** These run on a Mac somebody is using. `NSApplication`'s
  activation policy is set to `.prohibited` before any window exists, the
  window is created (so `NSTableView` has a hierarchy to lay out in) but never
  ordered in, and pixels come from `cacheDisplay(in:to:)` rather than from the
  framebuffer. Nothing here may reach for `screencapture`, `osascript`,
  `open -a`, or `ImageRenderer` — the last of which cannot render `List` at all,
  which is why a window is involved.
- **Every input is pinned:** size, `2×` scale, instant, timezone, locale, and
  appearance. Both appearances are always rendered, because the definition of
  done forbids an in-app appearance toggle, so half the app is only ever visible
  in one of them.
- **There are no golden files yet, deliberately.** The assertions are that the
  image is the right size, has more than one colour, and is a plausible size — a
  blank render is the silent failure mode. Committing binaries before a human
  has agreed the screens look right would freeze an unreviewed design; that gate
  comes after review, not before.

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
  `TaskNotesUniFFI`. **The same trap catches `Task { … }` and `Task.detached`** —
  in any file importing the bindings, a bare `Task` is the record, so structured
  concurrency has to be spelled `_Concurrency.Task`.
- The core also exports a foreign trait named `Clock`, which collides with
  `Swift.Clock` — the standard-library protocol behind `Task.sleep(for:)`. Same
  fix, same place: use the `CoreClock` alias.
- **A typed-throws function cannot have a non-exhaustive `catch`**, and the only
  exhaustive form is an untyped `catch`, which `untyped_error_in_catch` rejects.
  Use `Result(catching:)` instead — `CoreErrors` wraps the three cases that come
  up. ⚠️ Do not reach for `catch let error as NSError` inside a
  `throws(CoreError)` function: it crashes the Swift 6.4 compiler outright
  (`SILBuilder.h:2244`, `FormalConcreteType->isBridgeableObjectType()`).
- The generated bindings declare plain `throws`, never typed throws, even for a
  Rust function whose only failure type is `CoreError`. The error arriving is
  already a `CoreError`; recover it rather than flattening it.
- UniFFI error cases keep Rust's PascalCase (`CoreError.Invariant`) while plain
  enums get lowerCamelCase (`TaskStatus.inProgress`). Upstream; do not "fix" it.
- `.accessibilityIdentifier()` on a container pushes the identifier onto child
  text elements and leaves the container unidentified. Call
  `.accessibilityElement(children: .combine)` first. Worst on list rows.
