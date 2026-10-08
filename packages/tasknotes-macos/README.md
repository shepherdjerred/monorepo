# tasknotes-macos

**Facet** for macOS: a native SwiftUI client over the shared Rust core in
[`packages/tasknotes-core`](../tasknotes-core). Bundle identifier
`red.sjer.tasknotes.mac`, deployment target macOS 15.

First-party code is GPL-3.0-only. Native bundles include the exact repository
[license text](../../LICENSE) alongside separate locked third-party notices.

## Architecture

SwiftPM library targets (`Package.swift` owns their settings):

- `TaskNotesUniFFI` — the seam onto the machine-generated UniFFI bindings from
  `tasknotes-core/bindings/`; lint-exempt by design.
- `TaskNotesKit` — all portable logic, zero SwiftUI/AppKit imports, so the bulk
  of correctness testing runs headless. Includes `Host/` (the core's
  host-implemented traits: clock, randomness, retry scheduler, HTTP, storage)
  and `Vault/` (the standalone `FfiFacetEngine`, exact JSON validation,
  descriptor-confined file access, durable action drafts, and recovery).
- `TaskNotesFacetUI` — shared iOS/macOS SwiftUI presentation over the standalone
  engine. Profiles select a supported local folder or an app-private Obsidian
  Sync replica. Native HTTP/WebSocket hosts execute Rust Sync effects; account
  tokens and vault keys live in the platform secure store.
- `TaskNotesMac` — SwiftUI views, scenes, and commands; `MainActor`-isolated.

The app requires no TaskNotes server. SQLite stores the private index, journals,
outbox, and conflict metadata; Markdown and attachments remain the vault data.
TaskNotes interpretation, queries, mutation policy, and Sync protocol rules
belong to Rust. The native host supplies files, transport, lifecycle, and secure
storage. Generic cloud/document provider write support requires provider-specific
acceptance; selecting a URL alone does not establish safe write capability.

File callbacks use immutable snapshots and durable replacement stages, with
chunks capped at 1 MiB. Rust owns the upload/download payloads and their durable
disposition; native transport passes owned transfer identities instead of whole
attachments or JSON byte arrays. Conflict versions open lazily for exact export
or text previews capped at 1 MiB. Larger versions remain retained and selectable.
Socket reconnects preserve admitted transfer receipts. Explicit shutdown drains
transport, cancels and unbinds the session, closes payload handles, then closes
the runtime and file capabilities. Closing a handle never deletes retained bytes.

Applied mutation receipts carry validated, bounded warnings when a configured
template could not be used or a filename was shortened. The app keeps the Saved
outcome primary and reports cleanup or contract failures separately.

The conflict inbox can keep either exact version, preserve both at a chosen new
vault path, export complete binary versions, or submit a text resolution capped
at 1 MiB of UTF-8. Submitted owner, revision fences, timestamp and bytes remain
fixed for retry. Uncertain actions stay in the private durable queue; the inbox
closes a resolution only after the runtime reports an applied receipt.

iOS folder onboarding imports an independent app-private copy, including
attachments and empty folders, through coordinated read-only source access.
The source stays unchanged and later edits do not synchronize with that folder.
Interrupted copies retain a private import intent and offer retry; a completed
copy becomes a profile only after registration succeeds. Symlinks and unsupported
source entries fail visibly rather than being silently omitted. Provider-specific
materialization still requires acceptance on the selected provider.

Device reminders require explicit system notification authorization. Rust
supplies version-fenced firing plans; native delivery schedules the nearest 64
entries over 30 days and reports entries awaiting the next refresh. Existing OS
entries survive unreadable or changing plans. Reminder notification routes keep
their owning profile and wait behind an unsaved editor. Native background
failures use bounded diagnostic classifications that exclude vault contents and
account responses.

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
swift test --filter FacetGallerySnapshotTests # standalone presentation gallery
bun run lint              # SwiftLint --strict + ci/no-suppressions.sh
bun run mac:format        # swift-format in place (mac:format:check to verify)

bun run mac:generate      # xcodegen generate → TaskNotes.xcodeproj
bun run mac:app           # Debug app build (mac:app:release for Release)
bun run mac:run           # build + open the Debug app
bun run mac:smoke         # Release build + verify it launches and stays up
bun run mac:e2e           # XCUITest suite
bun run mac:e2e:ci        # signed CI suite; requires TASKNOTES_UITEST_IDENTITY
bun run mac:verify        # generate + build + test + lint + format + app + smoke

bun run mac:release       # operator-run release lane (scripts/release.ts)
bun run mac:store -- --dry-run # unsigned Mac App Store archive for inspection
```

The standalone gallery renders the app's actual SwiftUI workspace and forms
offscreen into `.build/snapshots/facet-gallery-*.png`. Its 31 fixture states cover
vault setup, account verification, Sync selection, task lists and boards, task
dates and recurrence, reminders, saved views, preferences, retained actions and conflicts.
Additional dark and narrow layouts check representative surfaces. These images
show presentation with a disconnected fixture store; they do not establish
live Sync, system permissions, simulator interaction or core runtime acceptance.

### Signed UI tests

The two global-hotkey flows post system events and require a stable signed test
runner plus Accessibility trust. List signing identities with
`security find-identity -v -p codesigning`, choose the SHA-1 beside an
**Apple Development** identity, then run:

```bash
TASKNOTES_UITEST_IDENTITY=<40-hex SHA-1> bun run mac:e2e:ci
```

On first run, approve `TaskNotesUITests-Runner` in System Settings → Privacy &
Security → Accessibility. Do not use the Developer ID release identity or an
ad-hoc signature: their runner signature is not accepted for UI testing, or
changes on every build and loses the trust grant.

`lint` and `test` participate in the repository's Linux CI verify graph:
SwiftLint ships a static Linux binary, and the Vitest suite covers only the
platform-independent `scripts/` helpers. Swift/Xcode/UI checks require macOS.
The macOS Woodpecker lane is currently paused in the repository's CI source;
Linux verification does not establish native build or interaction acceptance.
Run focused native checks locally and retain the exact artifact fingerprints,
test transcripts, and rendered UI evidence. Older server harness suites remain
regression references until equivalent standalone coverage is established.

`mac:release` preserves direct Developer ID distribution. `mac:store` creates
an archive and validates reviewed App Store export options and bundle identity;
it does not submit to a store. Signed export requires the owner's Apple team,
profiles, current agreements, and encryption determination. XcodeGen is pinned
in the root mise manifest; use `mise install` to provision it.

See [AGENTS.md](AGENTS.md) for the host/threading invariants that must remain in
context. The architecture and command reference live on this page; the release
implementation is in `scripts/release.ts`.
