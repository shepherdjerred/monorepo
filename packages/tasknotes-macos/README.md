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

Default-settings consent appears only after discovery confirms that configuration
is absent. Invalid or unreadable settings retain visible failures without an
earlier missing-settings prompt offering defaults.

The standalone desktop uses `FacetNativeWorkspace`: a native split-view sidebar,
task list or board, inline capture, and a persistent inspector. The iOS shell
uses Inbox, Today, Upcoming and Browse tabs, with native navigation stacks and
detented capture/detail sheets. These views adapt the retained clients'
composition while dispatching through `FacetStore` and `FacetEngine`; they do
not connect the historical server-backed `TaskNotesStore` to the standalone app.
Native form values for common recurrence patterns cross a portable Kit adapter,
with rule parsing and construction performed by the existing Rust functions
away from the UI actor.

Engine, account and selected-profile ownership is application-wide. The Mac
application starts them even with no visible workspace; view tasks await that
shared startup.
DEBUG native acceptance also prepares its synthetic fixture in the application
bootstrap, with concurrent restored windows sharing one registration and result.
Startup publishes the engine, importer and account together after their initial
reads succeed. A failed preparation closes its unpublished engine and permits a
fresh startup attempt. Account requests check cancellation and their original
session generation before and after each HTTP operation, including between the
OPTIONS preflight and the credential POST, then again before decoding a response.
`FacetWindowState` owns each window's query, search, saved-view constraints,
selection and pagination. Each Mac workspace owns its capture-sheet presentation
and draft; opening capture in one window does not present sheets in other windows.
Account and conflict sessions remain shared, while each sheet belongs to the
requesting Mac window; other windows wait for that sheet to finish cleanup before
opening another session.
Independent read generations never retire mutation
publication. Browse vocabulary uses a separate version-consistent all-page read
so a narrowed task list cannot hide the vault's projects, contexts or tags.
Group membership and order come from the core. Counts describe loaded pages;
recurring rows use `(task identity, occurrence date)` presentation identities.

Desktop title fields commit on Return or blur, Markdown commits on Done or blur,
and controls commit their own field. Navigation, profile changes, close and
termination drain all owning drafts; failed or newly dirty buffers veto teardown.
Native window-close delegates restore the previous delegate when detached without
overwriting a newer owner. A draft retains its selected occurrence across revision
reads. Once a receipt reports an applied change, a failed revision read is retried
as observation rather than executing the change again.

An ordered action coordinator admits different-row actions without dropping taps.
Capture owns a local buffer, captured profile and clock, and an immutable submitted
command and mutation identity. Pre-admission failures remain editable; uncertain
durably admitted changes keep their exact recovery identity. Resume/Retire reads
the durable journal before releasing a retained capture. Other windows and unrelated
rows remain usable while a capture waits.

Saved views and bulk decisions reserve their immutable action before yielding to
async work. Recurring completion batches reject duplicate note paths before
admission; note-level changes deduplicate only matching revisions. Supported saved
actions may retire only after authoritative absent or parked proof. Pending,
uncertain and applied work stays protected. Native recovery exposes the original
vault/action identity, and explicit local-draft discard checks the journal again.
Local success feedback comes from verified applied receipts before maintenance
and refresh. Its session, vault, action and originating window activation are
captured before queue admission: losing focus consumes the old cue even if the
window returns before the result arrives. Startup, remote changes, no-ops and
duplicate receipts stay silent. Bulk actions produce one aggregate cue. Ordinary
edits receive quiet visual acknowledgement, and Undo targets the exact eligible
core receipt with a six-second banner that pauses while focused or hovered.

Task Sounds defaults on across Apple platforms; mobile Haptics defaults on.
The independent local choices preserve both explicit legacy values, and malformed
preferences require visible reset. The shared first-party four-cue palette is
validated against its neutral contract. Individual SwiftPM copies turn source
symlinks into regular bundled files, checked byte-for-byte against that palette.
iOS ambient playback respects Silent Mode and mixes with other audio. Foreground
loss and interruptions release players; overlapping physical attempts are dropped
without replay. Device audio audibility and physical haptic feel require hardware
acceptance; simulator view renders establish neither.

Compact capture focuses its title and projects the existing Rust parser into
removable chips. Details expands notes, dates, priority and taxonomy controls;
explicit empty notes, cleared dates and removed tokens remain submitted overrides.
Add Another preserves the panel/sheet for repeated capture. Notes-only and
structured-only drafts veto dismissal. The reusable nonactivating macOS panel
keeps hidden drafts and restores title focus on each explicit opening.

Presentation tokens and configured-color policy are validated Swift values from
the [language-neutral presentation specification](../tasknotes-fixtures/presentation).
Native semantic colors and Dynamic Type remain authoritative. Configured labels,
colors and ordering decorate open workflow values; existing values absent from
settings remain selectable with a diagnostic, preserving their raw metadata.

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

The Obsidian account sheet owns visible progress, verification guidance and
redacted errors. Account diagnostics correlate HTTP status and response-decoding
failures by a native request UUID and timestamp, retaining only fixed engine
categories. A closed `requestKind` identifies sign-in, vault listing, sign-out,
vault authorization or user information without retaining URLs or response text;
an account rejection alone does not establish that credentials were incorrect.
A successful account with no Sync vaults has an explicit empty
state. Dismissal cancels only that sheet's request and fences late replies;
credentials remain transient and clear after success or dismissal. Startup
publishes the engine and account together, so failed initialization can retry.
An outbound connection failure retains pending uploads and retires its worker.
Returning to the foreground starts a new authorized transport after the previous
worker has unbound; authentication and contract failures require their own recovery.

The Xcode application target (`project.yml`, XcodeGen — the `.xcodeproj` is
generated and gitignored) links `TaskNotesMac` and supplies only the `@main`
entry point in `App/`, so SwiftPM and Xcode compile the same sources.

Tests: `Tests/TaskNotesKitTests` (Swift Testing, headless),
`Tests/TaskNotesMacTests` (image snapshots; the only test target that sees
SwiftUI), `UITests/` (XCUITest, run via `mac:e2e`).

### Isolated native acceptance

Debug acceptance uses the `TaskNotesAcceptance` Xcode scheme and the separate
`red.sjer.tasknotes.mac.acceptance` sandbox identity. It never claims production
URL schemes or registers the global quick-add shortcut. Launch it with
`--facet-acceptance-descriptor /absolute/path.json`; a missing or invalid
descriptor fails startup without opening the normal application state. The
descriptor must reside inside the acceptance app container and contain
`schemaVersion: 1`, `runID` as a UUID, `stateDirectory` as the exact app-private
Application Support path `FacetAcceptance/<lowercase-run-UUID>`, and optionally
`allowedRemoteVaultID`. Omitting it permits local testing and account metadata
discovery while forbidding every remote-vault authorization.
Symlink redirection, unknown descriptor fields, and other remote-vault IDs are
rejected. The descriptor is nonsecret; credentials remain in per-run account and
staging Keychain services. Selected profile, reminders and feedback preferences
use the run's defaults suite. Notifications belong to the dedicated app identity.

The iOS descriptor uses the same fields inside an owned disposable simulator.
The launching process must supply `FACET_E2E_SIMULATOR` equal to `SIMULATOR_UDID`.
For Xcode test installs, use the exact launch token
`--facet-acceptance-descriptor @documents/acceptance.json` and the exact virtual
state path `/Library/Application Support/FacetAcceptance/<lowercase-run-UUID>`.
This iOS-only form resolves against the app's current private container, so an
Xcode reinstall cannot leave stale absolute paths. Other relative paths and
UUIDs are rejected; macOS continues to require absolute paths.
The existing `ios:native:e2e` local journey supplies that ownership marker and
continues using its seeded `Documents/Native acceptance` vault. Acceptance
widgets and intent captures write beneath the private run directory, and no
production App Group or background scheduling is used. The native harness must
preserve the run directory on failure and clean up only resources it created.

Before a live run is bound, signing in may list owned vault metadata. Inspect
only the intended synthetic vault's accessibility identifier
`facet.account.vault.<remote-ID>`, bind that exact ID into both descriptors,
then relaunch and sign in again. Discovery cannot authorize or reconnect any
vault. Do not inspect account tokens, browser storage, or Obsidian secret files
to obtain the ID, and do not capture the account-entry screen.

For a prepared, sealed and bound Mac-only live run, `mac:account` drives normal
account controls through an addressed native helper and the configured 1Password
CLI. It verifies the exact run, descriptor, frozen source/artifact provenance,
process lifetime and account sheet before reading credentials. From this package:

```bash
bun run mac:account <runID> present
bun run mac:account <runID> credentials --account <accountID> --vault <vaultID> --item <itemID>
# Only when the app currently requests a verification code:
bun run mac:account <runID> verification --account <accountID> --vault <vaultID> --item <itemID>
bun run mac:account <runID> vault --vault-password-ref op://<vaultID>/<itemID>/password
```

Identifiers and password references are nonsecret. Passwords and generated codes
stay in memory/private helper input; they never belong in command arguments,
environment variables, logs, captures or the clipboard. Account-item reads use
Desktop authorization; the vault-password read uses the repository service-account
wrapper. Each invocation performs only its selected action and emits a closed
receipt. If a receipt reports an unknown submission outcome, inspect the current
app/status before invoking it again.

After `lifecycle-begin <runID> macos`, add `--lifecycle-round <1|2|3>` to every
account invocation, including `present`. The driver requires that round's retained
checkpoint, original profile, unchanged replica and immutable pending outbox;
`vault` reconnects the existing profile. It refuses an already released transport
interruption. Then run `lifecycle-finish <runID> macos` through the live harness.
These account commands do not establish Sync or native-workflow acceptance.

`bun run mac:acceptance:e2e` runs four bounded local standalone workflows with
a new descriptor, synthetic Markdown, and no live account: capture/edit/cold
relaunch plus complete/reopen/delete/exact-byte Undo; dirty inspector navigation
and normal window-close retention; independent search and selection in two
windows; and menu Quick Add hidden-draft retention with Add Another. File →
New Window opens a separate workspace; New Task keeps Command-N and Quick Add
keeps Shift-Command-N. Each workspace has its own stable accessibility identity
for the lifetime of that window.

The runner retains `run.json` with the exact selected test methods and outcome,
the `.xcresult`, safe synthetic workspace screenshots and the run's private
state under `.build/native-acceptance/<UUID>`. Mac screenshots come only from
ScreenCaptureKit filters for explicitly owned workspace windows and separate
captures of their exact owned sheets; foreign windows are excluded by the capture
producer. Capture requires an existing runner Screen Recording grant and fails
without prompting if it is absent. Ownership, safe UI state, geometry and process
lifetime are checked again after bounded capture completes. Automatic system desktop
attachments are discarded; custom user attachments are retained. Inspect the
app-only images before using them as visual proof or publishing them. The same
capture policy applies to the Mac live Sync journeys. The local runner's Markdown checks
require one final open task per selected workflow and byte-for-byte preservation
of the original task, reference note and configuration. To diagnose one flow,
use `bun run mac:acceptance:e2e --only-testing=testQuickAddRetainsHiddenDraftAndAddsAnother`;
a narrowed run is recorded as such and does not establish the full suite.
`TASKNOTES_UITEST_IDENTITY=<Apple Development SHA-1>` also signs this acceptance
test runner without overriding app or package signing. Its separate runner
identity may require an existing Accessibility grant; no gate assumes it.
After building with a stable Apple Development runner identity, open System Settings →
Privacy & Security → Screen & System Audio Recording. Click **+**, add
`.build/acceptance-xcode/Build/Products/Debug/TaskNotesAcceptanceUITests-Runner.app`
(relative to this package), and enable it. Keep the same signing identity for
subsequent runs. Grant access through Settings; the tests only check existing
consent and never request it or modify the privacy database.
The isolated acceptance app disables the global hotkey, so this suite proves
the ordinary Quick Add command and panel; production global-hotkey behavior
still needs its own signed, trusted native checkpoint. Both
the default local and CI E2E launchers run this acceptance suite before the
separate legacy server-backed suite; individual legacy selectors remain scoped
to those tests. The legacy suite still requires its own migration and is not
evidence of standalone isolation. The live test selector
`LiveSyncVaultUITests/testInitialDownloadUsesTaskNotesConfiguration` requires
the harness's authoritative `FACET_E2E_INITIAL_TASK_TITLE`. It verifies that
the existing task appears exactly once, native capture is enabled, and no
configuration warning or standard-settings consent appears. Initial live
acceptance runs this check on both clients before marking download complete.
The live test selector
`LiveSyncVaultUITests/testCaptureEditCompleteUncompleteAndColdRelaunch` requires
an already authenticated bound run and the harness's run ID, vault ID and round
number. It creates a unique task per platform and round, waits for durable
Sync to settle between changes, and records post-authentication states only.
The separate live selector
`LiveSyncVaultUITests/testOfflineCaptureEditAndColdRelaunchRetainPendingChanges`
requires that run's real transport to have been interrupted through its private
control file. It captures and edits offline, then proves the task survives cold
relaunch without resuming the connection. The live harness resumes transport
and verifies the retained upload converges across the three replicas.

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

`mac:smoke` launches the actual production Release bundle and signing using
`--facet-release-smoke <UUID>`. The app computes its private
`Application Support/FacetReleaseSmoke/<UUID>` directory and distinct account,
staging-Keychain and preferences namespaces; remote vault authorization,
global hotkeys and notification outputs are disabled. Debug acceptance
descriptors and controls remain unavailable in Release. The runner requires
successful engine/account startup through an exact `started.<PID>` marker,
then the same process must survive, preserve focus and exit on SIGTERM.
Ordinary failures clean up only the exact owned process; a proven SIGTERM
timeout leaves that process available for inspection.
The marker contains the lowercase UUID followed by newline. Per-run executable
fingerprints and provenance live in `.build/release-smoke/<UUID>`.
This proves Release startup behavior; it is not live Sync acceptance.

Native presentation renders instantiate the actual shared workspace, inspector
and forms with isolated synthetic state. `FacetNativeCheckpointTests` renders
AppKit hosting views into `.build/snapshots/`; the iOS `FacetPresentationTests`
unit target renders UIKit hosting controllers in an active simulator window scene.
The [reference matrix](../tasknotes-fixtures/presentation/reference-matrix.json)
maps retained source composition to standalone states and adaptive variants.
Capture manifests distinguish these fixture renders from app-window captures and
runtime journeys, and include current source/build fingerprints. Retained-client
source references are not evidence of an old iOS runtime capture. Offscreen renders
do not establish interactive gestures, live Sync, signed release acceptance or
persistence across application relaunch; those remain separate acceptance layers.
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
