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
  Updates/                    Sparkle: the updater object and its App-menu item
Tests/TaskNotesKitTests/      Swift Testing
  Support/                    the spawned-server harness and shared fixtures
Tests/TaskNotesMacTests/      image snapshots — the only test target that sees SwiftUI
ci/no-suppressions.sh         the three gates SwiftLint cannot enforce
scripts/release.ts            the operator-run release lane (see Releasing)
scripts/stage-frameworks.sh   makes Sparkle.framework reachable from `swift test`
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
- The initial `⇧⌘Space` binding is seeded **once**, under this app's own
  `UserDefaults` flag, so clearing it in Settings sticks.
- ⚠️ `KeyboardShortcuts.Name(_:default:)` is unusable here: its argument label is
  literally `default:`, and the `banned_switch_default` custom rule matches
  `default` followed by a colon anywhere outside a comment. **That is a rule
  defect** — it cannot tell a `switch` case from an argument label — and it is
  worked around rather than suppressed.

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

Direct download with Developer ID signing, notarization, and Sparkle. There is
no App Store build and no CI lane: `bun run mac:release` is an **operator
command on a Mac**, following the same rule as everything else here.

`bun run mac:release --dry-run` runs every step that needs no credential —
preflight, XcodeGen, the Release archive, the structural checks against the
archived app, dSYM collection — and prints the commands the credentialed half
would run. Use it to check a change before asking for a real release.

### One-time operator setup

Both of these are per-machine, and neither produces a file in this repository.

```bash
# 1. Notarization. Stores an app-specific password in the login keychain under
#    a profile name; nothing is ever written to disk by this repo.
xcrun notarytool store-credentials tasknotes-mac \
  --apple-id <apple-id> --team-id <TEAMID>

# 2. Sparkle's EdDSA signing key. Generates a keypair, stores the *private*
#    half in the login keychain, and prints the public half.
.build/artifacts/sparkle/Sparkle/bin/generate_keys
```

⚠️ **The private key is the one thing that cannot be replaced.** Losing it means
every installed copy stops trusting new updates, and the only recovery is
Sparkle's key rotation, which needs an unbroken Developer ID chain. Back it up
**out of band, once**:

```bash
# Export to a file, put the file's contents in 1Password, delete the file.
.build/artifacts/sparkle/Sparkle/bin/generate_keys -x /tmp/sparkle-ed-key
op document create /tmp/sparkle-ed-key --title 'TaskNotes macOS Sparkle EdDSA private key'
rm -f /tmp/sparkle-ed-key
```

The exported file is the base64 of a 32-byte ed25519 **seed** — the same string
as the keychain item's password. It is never committed, and nothing in this
repository reads it from a file: `scripts/release.ts` either lets
`generate_appcast` read the keychain, or pipes the key in on **stdin** from
`TASKNOTES_MAC_SPARKLE_ED_PRIVATE_KEY` so it is neither an argument (visible in
`ps`) nor a file.

The **public** half is not a secret and belongs in `project.yml` as
`SUPublicEDKey`, beside `SUFeedURL`, where it is reviewable.

### Environment

```bash
TASKNOTES_MAC_TEAM_ID                    # 10-character Apple Developer team id
TASKNOTES_MAC_NOTARY_PROFILE             # the notarytool profile name above
TASKNOTES_MAC_UPDATES_DIR                # persistent dir: every archive + appcast.xml
TASKNOTES_MAC_DOWNLOAD_URL_PREFIX        # public URL prefix the archives are served from
TASKNOTES_MAC_SPARKLE_ED_PRIVATE_KEY     # optional; otherwise the login keychain
```

`TASKNOTES_MAC_UPDATES_DIR` is **accumulated state, not a build directory**.
`generate_appcast` reads the whole directory to build delta updates and to keep
older entries in the feed; pointing it at a fresh empty directory silently
publishes a one-entry feed with no deltas.

### 🔴 Two decisions are still open, and the app ships disabled until they are made

`SUFeedURL` and `SUPublicEDKey` are deliberately **absent** from `project.yml`.
Until both are set, `UpdaterController` constructs no updater, the App-menu
_Check for Updates…_ item is present and **disabled**, and `mac:release` refuses
to archive. See the long comment in `project.yml` for why a placeholder would be
worse than an absence.

**Where the appcast is hosted is the decision that cannot be taken back.** The
feed URL is compiled into every shipped binary, so anyone who installs a build
is pinned to that URL forever — a bad host choice is not a migration, it is an
abandoned install base. `public.sjer.red` (SeaweedFS) is the obvious candidate
and `toolkit pr asset` shows the upload shape, but the bucket's `pr/assets/`
prefix **expires objects after 365 days**, which for an update feed means every
installed copy silently stops finding updates a year later. A different prefix
with no expiry, or a different host entirely, has to be chosen and confirmed
before the first release.

### What the lane does

Archive → Developer ID export → `notarytool submit --wait` → `stapler staple`
→ `stapler validate` + `spctl --assess` + `codesign --verify --deep --strict`
→ re-zip the stapled app → `generate_appcast` → collect dSYMs.

Three things are worth knowing:

- **`--deep` is right on `codesign --verify` and wrong on `codesign --sign`.**
  Verification with `--deep` is what walks into `Sparkle.framework` and checks
  its XPC services; signing with `--deep` flattens per-item entitlements across
  nested code and is the documented cause of Sparkle sandbox failures. Same
  flag, opposite advice, and the script only ever uses the first.
- **Notarize the zip, staple the app, then zip again.** The ticket has to live
  inside the bundle so a first launch works offline, and stapling mutates the
  `.app` after the archive that was submitted.
- **Ship every dSYM, and know which one matters.** ⚠️ `TaskNotes.app.dSYM`
  contains **zero** `tasknotes_core` symbols — the Rust archive links into
  `TaskNotesCore.framework`, so `TaskNotesCore.framework.dSYM` is what makes a
  Rust frame in a crash report readable. The archive also carries Sparkle's
  five. The script copies all of them and hard-fails if the three load-bearing
  ones are absent.

## Sparkle

Pinned `from: "2.9.5"` — a **security** floor. 2.9.2 and 2.9.5 are both
symlink-traversal fixes in the delta installer (2.9.5 completes the fix 2.9.2
started) and 2.9.2 additionally makes the installer validate its connection
before accepting appcast data. `from:` means `>= 2.9.5, < 3.0.0`, so no
resolution can land below the fix.

**Sandboxing is the part that bites, and it bites at install time rather than
at build time.** The app is sandboxed, so Sparkle cannot replace the app bundle
from inside this process; it does the install from `Installer.xpc`, which ships
inside `Sparkle.framework`. That needs three things to line up:

| Where                        | What                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `project.yml` Info.plist     | `SUEnableInstallerLauncherService: true`                              |
| `App/TaskNotes.entitlements` | `mach-lookup.global-name` = `<bundle-id>-spks` and `<bundle-id>-spki` |
| the built bundle             | `Sparkle.framework/Versions/B/XPCServices/Installer.xpc` present      |

Sparkle validates the third at startup and refuses to start without it, which
`SPUStandardUpdaterController` answers with a modal alert a second into launch —
so `scripts/release.ts` checks all three against the exported app.

⚠️ **No Downloader XPC service.** It exists only for sandboxed apps that will
not take `com.apple.security.network.client`; this app already has it, and
enabling the service would move release notes onto a deprecated WebKit1 view.
The service is still _embedded_ (it comes with the framework) and is simply
never launched; Sparkle documents a build-phase script to strip it, which is not
worth a run script that re-signs nested code under `ENABLE_USER_SCRIPT_SANDBOXING`.

Two more, both verified rather than reasoned about:

- **`swift test` cannot load `Sparkle.framework` without help.** It is the only
  dynamic framework here, and SwiftPM's current build system puts it in the
  products directory while giving the test bundle an rpath of
  `<products>/PackageFrameworks`. `scripts/stage-frameworks.sh` bridges the two
  with a symlink; `DYLD_FRAMEWORK_PATH` does not work, because the test helper
  inside Xcode is restricted and dyld strips it.
- **Do not add `SUFeedURL` to `UserDefaults`.** Sparkle logs a deprecation error
  if it finds one there and may keep using it in preference to the Info.plist.

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
