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
New repeat drafts resolve Scheduled and Created anchors through the same Rust
boundary. Missing anchors may use the captured current day; unreadable provided
anchors remain unresolved until an explicit valid start date is chosen.
Explicit replacement of a raw rule preserves its selected effective start when
the common rule drops an inline DTSTART, retaining a matching Scheduled time.

Engine, account and selected-profile ownership is application-wide. The Mac
application starts them even with no visible workspace; view tasks await that
shared startup.
DEBUG native acceptance also prepares its synthetic fixture in the application
bootstrap, with concurrent restored windows sharing one registration and result.
Before constructing SwiftUI's App, the DEBUG acceptance launcher validates its
isolated descriptor and installs a dedicated `NSApplication` subclass. Its
AppKit restoration hook declines archived windows without decoding their state;
the acceptance scene also disables restoration. Once launch and restoration
finish, the isolated application requests one fresh workspace through AppKit's
untitled-window delegate route only when no windows exist. An unsupported or
failed request stops startup. A separate launch check requires
one workspace on initial and cold launch and retains scalar installation/veto
receipts. Cold relaunch workflows prove persisted vault data; production
window-layout restoration remains automatic and requires separate runtime
verification.
Startup publishes the engine, importer and account together after their initial
reads succeed. A failed preparation closes its unpublished engine and permits a
fresh startup attempt. Account requests check cancellation and their original
session generation before and after each HTTP operation, including between the
OPTIONS preflight and the credential POST, then again before decoding a response.
When an account token is retained in this app's Keychain namespace, startup
rediscovers vault choices through the normal authenticated HTTP/Rust boundary.
Owner metadata alone cannot produce a vault list. Missing or rejected tokens
return to sign-in without deleting profile identities, vault keys or outboxes;
network failures offer session-restoration Retry. Late responses cannot publish
after cancellation, account replacement or lifecycle ownership loss. A successful
restore returns directly to vault selection, so connection can resume after cold
launch without another password or authenticator submission.
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

Dependency editing reads the core's `dependency_editor` metadata through the
validated feature boundary. Returned choices and an explicitly configured default
drive new records; an absent default requires a relationship choice. Read-only
loads are fenced to the original editor, engine and vault, with visible Retry on
failure. Loading options leaves existing dependency identities, gaps and extension
properties unchanged.

An ordered action coordinator admits different-row actions without dropping taps.
Materialized series use the core's versioned rolling plan and durable generation
failure projections. The shared Apple inspector and task editor expose Generate
window and Repair generation using the returned revision fences and repair
commands; dirty editors disable these actions. A successful completion remains
successful when a future occurrence fails, and the Series section rediscovers
retained failures after restart.

An application-owned occurrence worker coalesces requests across profiles after
configuration and initial Sync readiness. Each pass captures one local day,
finishes its consistent paged discovery before writing, and admits one immutable
automatic window action at a time through the normal action coordinator. Saved
envelopes recover before replacement actions. Core-defined automatic maintenance
receipts retain durability without displacing user Undo. Remote ingestion and
readiness request another pass, including offscreen profiles; own upload
acknowledgments refresh presentation only. Requests received during a drain remain
pending, so later edits and deleted children receive fresh discovery. Query and
reminder reads never generate tasks, and automatic recovery emits no local cue.
Each pass retains its account and lifecycle generation across discovery and queue
waits. Ownership loss or cancellation blocks new admission, while already admitted
receipts retain their exact durable recovery and observation identity.
The engine rechecks the pass permit at actor admission and between retained
recovery attempts, so a queued call cannot revive a revoked pass.

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
account controls through an addressed native helper and the selected credential
backend. It verifies the exact run, descriptor, frozen source/artifact provenance,
process lifetime and account sheet before reading credentials.

Field entry uses normal keyboard events addressed to the verified process, with
the exact enabled field and its focus checked before and after each matched key
pair. The helper preserves secure-field ownership and the form's enabled-button
checkpoints so successful event delivery alone cannot establish ready credentials.

From this package:

```bash
bun run mac:account <runID> probe
bun run mac:account <runID> present
bun run mac:account <runID> credentials --credential-backend keychain \
  --account <accountID> --vault <vaultID> --item <itemID>
# Only when the app currently requests a verification code:
bun run mac:account <runID> verification --credential-backend keychain \
  --account <accountID> --vault <vaultID> --item <itemID>
bun run mac:account <runID> vault --vault-password-backend service-account \
  --vault-password-ref op://<vaultID>/<itemID>/password
```

Identifiers and password references are nonsecret. Passwords and generated codes
stay in memory/private helper input; they never belong in command arguments,
environment variables, logs, captures or the clipboard. Account and verification
reads default to the local, nonsynchronizing classic macOS Keychain. Follow the
one-time signed-helper installation and explicit 1Password enrollment commands
in the [live Apple Sync setup](../tasks-for-obsidian/README.md#live-apple-sync-acceptance).
The stable helper lives at
`~/Library/Application Support/FacetAcceptanceCredentials/bin/facet-credentials`;
only that helper is trusted to read its credential item. Enrollment stores selected
login credentials and any OTP seed locally while leaving the original 1Password
item unchanged. It does not copy the login to Homelab or grant machine access to
the Personal vault.

Routine Keychain reads disable authentication UI and fail on missing, locked or
denied items without prompting, changing trust or trying another backend. Keep
the selected Apple Development signing identity stable; a helper replacement
does not silently broaden an existing item's access policy. The required
`--account`, `--vault` and `--item` locators bind the local record to its original
item. Explicit `--credential-backend desktop` selects attended reads;
`--credential-backend service-account` requires separately provisioned machine
access and uses the token's account rather than passing `op --account`.

The vault encryption password remains a separate `service-account` read through
`scripts/onepassword/with-service-account.sh`; login enrollment does not copy it.
An explicitly attended invocation can select `--vault-password-backend desktop`.
Backend failures emit closed errors and never trigger a fallback.

The probe runs separate synthetic email/password and authenticator phases before
any real account read. The Mac fixture requires the dedicated Debug acceptance
bundle, validated isolated descriptor and a virtualized guest. Its fresh account
directory has no credential store or network fallback. A receipt produced by the
actual fixture instance binds the run and session; mode environment values alone
cannot confirm fixture ownership. The first phase submits nothing; the second
uses one normal synthetic Sign in to reach the original Rust MFA decoder and
enters a fake code without submitting it. Each phase retains native and transport
output, the app's declared stdout/stderr with descriptor checks, and raw unified
logs bounded to that fresh fixture process and lifetime at info/debug levels.
Missing or incomplete output, media or a sentinel match blocks approval. These
are owned-process privacy checks; they do not claim coverage of every OS process
or a separate XCTest SDK. Both complete raw-evidence gates bind
the exact prepared source, app and helper bytes. They establish input privacy for
email/password and verification fields, not a separate vault-password sentinel
proof or real authentication.
After both gates pass, the probe awaits its existing normal app launch, fresh
idle account status and the owned process lifetime before returning for real entry.

Each real invocation revalidates those two measured proofs before reading its
selected backend. Authenticator entry accepts only the enrolled local Keychain
seed. It prepares and binds the native channel, completes expensive checks, then
issues one code with expiry checks before entry and the normal click. It retains
an exclusive intent before submission; no code or value-derived digest enters
the receipt. Every session keeps its original 120-second limit.
After FINISHED, the native helper requires the sender's empty terminal EOF before
exiting, within that same deadline. Any trailing input rejects the session; the
host still requires complete output, exit zero and empty diagnostics.
Each invocation performs only its selected action and emits a closed receipt.
If a receipt reports an unknown submission outcome, inspect the current
app/status before invoking it again. These credential backends configure the
acceptance harness; installed apps retain their normal sign-in UI and Keychain.

Run `probe` without credential options or a lifecycle round. After
`lifecycle-begin <runID> macos`, add `--lifecycle-round <1|2|3>` to each real
account invocation, including `present`. The driver requires that round's retained
checkpoint, original profile, unchanged replica and immutable pending outbox;
`vault` reconnects the existing profile. It refuses an already released transport
interruption. Then run `lifecycle-finish <runID> macos` through the live harness.
These account commands do not establish Sync or native-workflow acceptance.

The official Obsidian reference uses the phase-specific commands in the
[live Apple Sync setup](../tasks-for-obsidian/README.md#live-apple-sync-acceptance).
Its authenticator step requires a separate zero-submit fake-code probe against
the same owned form and process. The real step uses only the enrolled local OTP
seed, prepares its private native channel before generating the code, and retains
an exclusive verification intent before entry and the normal click. Expired codes,
changed forms and unknown outcomes stop without automatic resubmission or backend
fallback. Account captures remain off. A submitted code still requires observed
authentication and replica acceptance afterward.
No-code native preparation retains bounded output, exit status and fixed guard
phases before rejecting a result, so a failed form or ownership check can be
diagnosed without capturing the real OTP session. The method guard recognizes
the exact authenticator label from the pinned official app and still rejects
email and recovery-code challenges.

The iOS driver described there requires separate email/password and synthetic
verification privacy proofs for the same prepared bytes. Its verification
fixture reaches the normal Rust MFA decoder through an isolated, strictly local
HTTP boundary, without authenticating an account or submitting a code. Real iOS
authenticator entry uses a one-shot local Keychain generator after ownership
checks, with native expiry checks before mutation and the normal tap. Fixture
privacy evidence and real account/Sync acceptance remain separate.

`bun run mac:acceptance:e2e` builds once, checks initial and cold-launch window
isolation, then runs four local standalone workflows sequentially with
a new descriptor, synthetic Markdown, and no live account: capture/edit/cold
relaunch plus complete/reopen/delete/exact-byte Undo; dirty inspector navigation
and normal window-close retention; independent search and selection in two
windows; and menu Quick Add hidden-draft retention with Add Another. File →
New Window opens a separate workspace; New Task keeps Command-N and Quick Add
keeps Shift-Command-N. Each workspace has its own stable accessibility identity
for the lifetime of that window.

Each workflow runs in its own XCTest invocation. The runner requires that exact
case to pass before starting the next, stops on the first failure, and merges
the four actual workflow results for the unchanged complete-suite gate.
Immediately before each Mac test invocation, a shared preflight requires an
unlocked on-console session. A blocked preflight records its observation and
`blocked` outcome without starting XCTest; it is distinct from a failed test.
`bun run mac:acceptance:e2e --launch-smoke-only` checks just initial and cold
launch, creates no task notes, and explicitly records that full acceptance was
not run. It still initializes the synthetic vault and profile.

The runner retains `run.json` with the exact selected test methods and outcome,
each invocation's `.xcresult` and result receipt, safe synthetic workspace
screenshots and the run's private
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

Prepare an explicit signed build before running a guest case:

```bash
bun run mac:occurrences:e2e --vm <running-VM> --prepare
bun run mac:occurrences:e2e --vm <running-VM> --artifact-build <build-UUID> --setup-capture
bun run mac:occurrences:e2e --vm <running-VM> --artifact-build <build-UUID>
```

Preparation exports the exact build without running app UI. Replays require its
explicit UUID and matching source, signing and artifact fingerprints; they never
rebuild or select a latest cached artifact. `--setup-capture` runs only
`CaptureReadinessUITests/testOwnedSyntheticWindowCapture` on a fresh synthetic
vault. Its separate `native-capture-readiness-macos` receipt becomes `capture-ready`
only after the exact native result, named owned-window PNG, completed capture
diagnostics, unchanged original seed files and one closed launch are retained.
Normal rolling maintenance may add children. Capture readiness does not establish
recurrence acceptance. The same stable signed Runner bundle is reused for guest
permission provisioning and recurrence, while every case gets a fresh app state.

Replaying without `--setup-capture` runs the separate local recurrence journey
in a fresh `Native acceptance` vault. It checks automatic rolling
generation, the production Generate button preserving completion Undo when it has
nothing to create, and a missing-template failure that preserves a completed
child. With the owned app stopped, the harness restores only its synthetic
template; the production Repair button must create one successor, Undo must
restore the exact committed parent and child, and a second repair must survive
cold relaunch. It retains source fingerprints, exact XCTest results, persisted
Markdown and app-only captures in `.build/occurrence-acceptance/<UUID>`. It uses
the same signing, capture and process ownership checks as ordinary acceptance.
The command requires an already running, preprovisioned Tart guest with Guest
Agent, a matching selected Xcode, an unlocked GUI session, and normal XCTest,
Accessibility and Screen Recording permissions for the signed acceptance runner.
It never downloads, installs, boots a VM, starts VNC, or falls back to host UI.

Provision three read-only named shares once: `tasknotes-xcode` for the selected
host Xcode bundle, `tools` for this package's `.build/occurrence-vm/tools`, and
`exports` for `.build/occurrence-vm/exports`. The guest must select its canonical
Xcode path and have real, guest-owned directories at the host package's compiled
absolute path. Do not share a home directory, Keychain, credentials or the full
workspace. The producer copies the installed Bun runtime and generates persistent
per-run bundles and strict source/artifact receipts beneath `.build/occurrence-vm`;
no private `/tmp` helper is required after reboot. Fresh host and guest UUIDs
protect existing state. Owned regular result files return through a size-limited,
SHA-256 verified manifest and binary Guest Agent copies, without a writable share.
The acceptance runner retains Xcode's sandbox and has a signing-only write grant
for the synthetic `FacetAcceptance` state directory. Effective signed app and
runner capabilities are checked before dispatch and again inside the guest;
missing or broader write access stops the run before app UI.

Foreground manual testing requires explicit opt-in:
`bun scripts/occurrence-acceptance/run-macos.ts --host-ui`.
The four ordinary workflows and their fixture remain a separate required gate.
Series repair controls match the core's current canonical `sourceTaskPaths`.
An explicit empty array excludes historical child paths; older responses without
that field retain their original child-path behavior. Parent controls remain
available for their own failures.
The recurrence build lives under that run's UUID and XCTest launches its exact
app URL. Each launch journals its PID, UID and start lifetime with the run,
descriptor and executable; cold termination closes that identity before another
launch. Cleanup may signal only the last retained running identity. A missing
receipt, reused PID or replacement process fails closed and leaves the foreign
process running. Commands retain file-backed logs, bound build/test startup and
actual process exit, and give retained-owner cleanup a separate bounded budget.

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
