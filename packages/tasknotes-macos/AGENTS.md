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
Tests/Support/                TaskNotesTestSupport — a plain (non-test, non-product)
                              target: the spawned-server harness and the temp
                              directory, shared because a test target cannot
                              import another test target
Tests/TaskNotesKitTests/      Swift Testing
  Support/                    fixtures specific to this target
Tests/TaskNotesMacTests/      image snapshots, and AppEnvironment — the only test
                              target that sees SwiftUI
ci/no-suppressions.sh         the three gates SwiftLint cannot enforce
scripts/release.ts            the operator-run release lane (see Releasing)
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
bun run mac:release   # the release lane; --dry-run for the credential-free half
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

## The quick-add panel

`Sources/TaskNotesMac/QuickAdd/` is the only window in this app that SwiftUI does
not own. It is an `NSPanel` built by hand, because the whole value of a global
quick-add is that it appears **without pulling the application forward**, and
SwiftUI's `Window`/`WindowGroup` expose no way to reach `NSWindow.styleMask`.

Four properties do the work, and each one is deletable without changing how the
panel looks: `.nonactivatingPanel` in the style mask, `canBecomeKey` overridden
to `true` while `canBecomeMain` stays `false`, `isFloatingPanel` plus the
`.floating` level, and `.canJoinAllSpaces`. `QuickAddPanelConfigurationTests`
asserts all of them, because an image cannot.

- **The hotkey is claimed by `AppEnvironment.init`**, not by a scene, so it is
  live from launch and survives the last window closing. `KeyboardShortcuts`
  wraps `RegisterEventHotKey`, which needs **no** permission; a `CGEventTap`
  would need Accessibility and is not an option for a text field.
- The initial binding is `⌃⌥⌘Space`, supplied through the library's own
  `KeyboardShortcuts.Name(_:default:)`, so clearing it in Settings sticks.
  ⚠️ It was `⇧⌘Space` first, on the reasoning that the combination was free. It
  is not — 1Password binds it and macOS 26 added a Siri handler — so the panel
  never opened for anyone. No combination is safe by analysis; the recorder in
  Settings is the real answer and the default is only a better guess.
- ⚠️ **The panel carries its accessibility identifier on the `NSWindow`, not
  only on the hosted SwiftUI view.** `XCUIApplication.windows[_:]` matches the
  window element itself, so an identifier applied inside the content leaves the
  panel anonymous — it comes back as `AXSystemFloatingWindow` with no title and
  no identifier, and every UI query against it silently matches nothing.
- The `banned_switch_default` custom rule used to match the `default:` argument
  label above and forced a hand-rolled seed. That was a rule defect; it now
  discriminates on SourceKit's syntax kind, so the library's mechanism is used
  directly.

## Running the end-to-end tests

```bash
bun run mac:e2e
```

The four navigation flows need nothing special. **The two quick-add hotkey flows
need Accessibility trust, once**, and will otherwise report themselves as
skipped with the reason rather than failing:

```bash
# The identity is per-operator and deliberately not committed. Only the UI test
# target reads this variable, so unlike a bare `DEVELOPMENT_TEAM=` it cannot
# leak onto the SwiftPM package targets. Pass the SHA-1: the name alone is
# ambiguous when a machine holds two certificates issued to the same person.
security find-identity -v -p codesigning | grep "Apple Development"

xcodebuild test -project TaskNotes.xcodeproj -scheme TaskNotes \
  -configuration Debug -derivedDataPath .build/xcode -destination 'platform=macOS' \
  -only-testing:TaskNotesUITests \
  TASKNOTES_UITEST_IDENTITY="<sha1>"
```

⚠️ **Use the Apple Development identity, not the Developer ID one.** Developer
ID is a distribution identity and `testmanagerd` will not drive a runner signed
with it — every flow fails with _"Not authorized for performing UI testing
actions"_, including the four that have nothing to do with the hotkey. Both
identities are equally stable as far as TCC is concerned, so there is no reason
to reach for the release one here.

Then approve **TaskNotesUITests-Runner** in System Settings ▸ Privacy & Security
▸ Accessibility.

⚠️ **Signing the runner is what makes that grant worth giving.** TCC keys the
grant on the code signature, and an ad-hoc runner is re-hashed on every build —
so an approval evaporates at the next rebuild and the flows go back to failing.
With a stable Developer ID signature the grant is genuinely one-time. Approving
an ad-hoc runner repeatedly is not a workflow; it is the thing this setting
exists to avoid.

⚠️ **A dropped event does not look like a permission problem.** `CGEvent.post`
succeeds and the event is discarded when the process is untrusted, so before
this was checked explicitly the failure read "the hotkey did not open the quick
-add panel" — accusing a feature that works. `postGlobalTestHotkey` now asserts
`AXIsProcessTrusted()` first.

## The pomodoro timer and the time report

`Sources/TaskNotesMac/Timing/` are two `Window` scenes. **Do not add `Commands`
for them**: SwiftUI contributes a Window-menu item for every `Window` scene by
itself, from launch and before either has been opened. Verified by reading the
running app's menu bar — an explicit pair produced `Pomodoro, Time Report,
Pomodoro, Time Report`.

🔴 **Both are placeholders over a gap in the core, and the gap is reported.** The
core exports `PomodoroStatus`, `PomodoroPhase`, `TimeSummary`, `TopTask` and
`TaskTime` as _records_ but no way to fetch or drive them — no engine method, no
`/api/pomodoro/*` or `/api/time/summary` in `net/endpoints.rs`. So the timer runs
locally (the core is sans-I/O and can never tick a clock anyway) and the report
shows all-time totals re-projected from `CoreTask.totalTrackedTime`, which the
_server_ computed. Neither writes a time entry. The wanted API is
`pomodoro_{start,pause,stop,status}` and `time_summary(period:)` with `TimePeriod`
a closed core enum. Do not grow a wire layer in Swift to close it.

Two conventions worth keeping: the countdown uses the core's `elapsedFormat`
(`MM:SS`, a ticking clock — exactly right there), and the report deliberately
does **not**, because `1:30:00` reads as a video length rather than as an hour and
a half of work. Durations in the report go through `Duration.UnitsFormatStyle`.

## Releasing

Direct download with Developer ID signing and notarization. There is no App
Store build, no self-update mechanism, and no CI lane: `bun run mac:release` is
an **operator command on a Mac**, following the same rule as everything else
here. It ends at a notarized, stapled `TaskNotes-<version>.zip` in
`.build/release/`, which a human hands out.

`bun run mac:release --dry-run` runs every step that needs no credential —
preflight, XcodeGen, the Release archive, the structural checks against the
archived app, dSYM collection — and prints the commands the credentialed half
would run. Use it to check a change before asking for a real release.

### One-time operator setup

Per-machine, and it produces no file in this repository.

```bash
# Notarization. Stores an app-specific password in the login keychain under a
# profile name; nothing is ever written to disk by this repo.
xcrun notarytool store-credentials tasknotes-mac \
  --apple-id <apple-id> --team-id <TEAMID>
```

### Environment

```bash
TASKNOTES_MAC_TEAM_ID                    # 10-character Apple Developer team id
TASKNOTES_MAC_NOTARY_PROFILE             # the notarytool profile name above
```

### What the lane does

Archive → Developer ID export → `notarytool submit --wait` → `stapler staple`
→ `stapler validate` + `spctl --assess` + `codesign --verify --deep --strict`
→ re-zip the stapled app → collect dSYMs.

Five things are worth knowing:

- **⚠️ The archive carries no team, on purpose — so Xcode's Organizer cannot
  distribute it.** `project.yml` pins `CODE_SIGN_STYLE: Manual`,
  `CODE_SIGN_IDENTITY: "-"` and an empty `DEVELOPMENT_TEAM` so a clean checkout
  builds with no account, and the archive command adds only
  `ENABLE_HARDENED_RUNTIME=YES`. The Developer ID identity is applied later, by
  `-exportArchive` re-signing from a generated `ExportOptions.plist`
  (`method: developer-id`, `signingCertificate: Developer ID Application`).
  Organizer ▸ Distribute App reads the archive itself and stops with **"No Team
  Found in Archive"** — that is the expected result, not a defect to fix. Use
  `bun run mac:release`; the GUI path is not supported.

  ⚠️ Do **not** "fix" it by passing `DEVELOPMENT_TEAM=` / `CODE_SIGN_STYLE=Automatic`
  on the `xcodebuild` command line. Those apply to _every_ target, including the
  SwiftPM package targets (`KeyboardShortcuts`, `TaskNotesCore-product`), which
  then fail with _"No Account for Team"_ / _"No signing certificate Mac
  Development found"_. Measured, twice.

- **⚠️ `TASKNOTES_MAC_TEAM_ID` is the Developer ID team, which need not be the
  team on your Apple Development certificates.** On this machine the two differ,
  and passing the Apple Development team makes preflight report that no
  "Developer ID Application" certificate exists — while `security find-identity
-v -p codesigning` plainly lists one. Read the team out of the identity you
  actually intend to sign with:

  ```bash
  security find-identity -v -p codesigning | grep "Developer ID Application"
  # → …"Developer ID Application: NAME (TEAMID)"   ← that TEAMID
  ```

- **`--deep` is right on `codesign --verify` and wrong on `codesign --sign`.**
  Verification with `--deep` is what walks into the embedded
  `TaskNotesCore.framework` instead of stopping at the app's own signature;
  signing with `--deep` flattens per-item entitlements across nested code. Same
  flag, opposite advice, and the script only ever uses the first.
- **Notarize the zip, staple the app, then zip again.** The ticket has to live
  inside the bundle so a first launch works offline, and stapling mutates the
  `.app` after the archive that was submitted. Both zips are
  `ditto -c -k --sequesterRsrc --keepParent`, which is what preserves the
  `Versions/` symlinks `TaskNotesCore.framework`'s signature depends on.
- **Ship both dSYMs, and know which one matters.** ⚠️ `TaskNotes.app.dSYM`
  contains **zero** `tasknotes_core` symbols — the Rust archive links into
  `TaskNotesCore.framework`, so `TaskNotesCore.framework.dSYM` is what makes a
  Rust frame in a crash report readable. The script copies everything the
  archive produced and hard-fails if either of those two is absent.

## No self-update

There is no in-app updater, by decision rather than by omission: this is a
personal-use app, and the whole update mechanism — a dynamic framework with
nested XPC services, two sandbox entitlement exceptions, an EdDSA key pair that
can never be lost, and a feed URL that is compiled into every shipped binary and
can never be changed — is cost with no user on the other end of it. A new
version is a new zip from `bun run mac:release`, dragged into `/Applications`.

Do not reintroduce one without also deciding, up front, where the feed is hosted
and how its signing key is backed up; those are the two things that cannot be
taken back once a build is installed.

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
