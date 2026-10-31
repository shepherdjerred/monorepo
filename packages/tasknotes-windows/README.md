# TaskNotes for Windows

Facet is the standalone Windows 11 x64 client for TaskNotes vaults. WinUI 3
renders the application; a portable host invokes the shared Rust TaskNotes and
Obsidian Sync engines through generated C# UniFFI bindings. The application
stores its index and mutation journal locally and connects directly to an
authorized Obsidian Sync vault.

Existing duration and time-entry metadata remains untouched in vault notes.

The host validates the complete mutation receipt before presenting its saved
result. Template and filename notices accompany Saved and belong to the exact
vault, action and engine request. Expected refresh or cleanup I/O failures keep
the saved outcome and original action available, with separate maintenance text.
The editor retains its draft until it can load the authoritative resulting task;
late results cannot replace a newer draft. Invalid receipts fail the contract.

Local applied receipts drive task-added, completed, deleted, reopened and Undo
feedback before fallible refresh or cleanup. Feedback has an independent
engine/profile/mutation identity and an originating-window activation lease;
searches and other task actions do not invalidate it. Leaving the foreground
invalidates a pending cue permanently. Startup, remote updates, recovery replay,
no-ops and ordinary field edits are silent. Bulk completion emits one aggregate
cue. The native player consumes each eligible effect once and drops overlapping
attempts using a monotonic duration gate at playback, without queuing audio.
The four bundled first-party WAVs and shared feedback JSON are strictly validated.
Task sounds default on; explicit choices persist independently of other settings.
Malformed sound preferences require an explicit repair choice.

Quick Add opens as a compact native dialog with immediate input focus, Rust-parsed
removable chips and optional Details for notes, Planned/Due dates, configured
priority and exact taxonomy tokens. Commas inside names remain part of a token.
Clearing a parsed chip means a deliberate null or empty-array override. Metadata
without a core-parsed title is rejected before journal admission. Button deferrals
retain the dialog during submission and after failure; reopening preserves an
owned draft. Add & add another resets only after a confirmed receipt, and newer
typing survives an older result. Uncertain captures retain their exact recovery
action. The app currently has one main window; protocol and global capture
activations redirect to that window's dialog, with a separate inline draft.
Submission uses one opaque, core-produced payload frozen with its original
engine and profile; relative dates and defaults are not parsed again after
preview. Once admitted, it can only be reviewed through its exact saved action.

Applied confirmations remain visible for at least six seconds, pause expiration
while focused or hovered, honor a longer native accessibility message duration,
and offer Undo only for that exact authoritative current receipt.
Ctrl+Z remains native text Undo inside text/password editors. Task receipt motion
uses the shared duration and respects Windows animation settings. Native playback,
dialog focus, motion, high contrast and MSIX resource installation still require
an interactive Windows host; portable tests and source checks do not establish
those runtime behaviors.

Settings provides independent background Sync and Windows reminder preferences.
The packaged app requests Windows background access for opted-in work when it
closes. Windows schedules the owned task every 15 minutes when its execution
policy permits. Sync-only work requires network access; reminder maintenance
also runs offline for registered local vaults. Reminder-only writers never open
Sync network sessions. Each activation has a 45-second budget and retains durable
checkpoints when cancelled. Foreground launch cancels only Facet registrations
and waits for the previous writer to release its private-vault lease before
opening SQLite or mutation drafts. Closing the main window confirms dirty edits,
drains session effects and closes the engine before releasing that lease.
Settings displays background permission or registration failures. Background
execution is best effort; COM activation and OS delivery require real Windows
acceptance separately from cross compilation.

Windows reminder delivery uses the shared Rust `reminder_plan` projection with
one explicit clock, IANA time zone and 30-day window. The host reads every page
against the same index version before replacing that vault's OS schedule. Invalid
stored reminders produce diagnostics; unavailable configuration retains the last
schedule. Account changes fence in-flight scheduling and cancel private-vault
notifications before credentials change. Protocol activation selects the reminder's
owning vault and exact task path, with confirmation before discarding a draft.
Windows notification permissions and power policy control delivery. Scheduled
notifications can be missed if the computer remains off for more than five minutes
after the firing time; OS delivery and COM activation remain separate acceptance
requirements.

First-party application and Rust core code use GPL-3.0-only. The Windows package
includes the exact repository license under `Licenses/GPL-3.0.txt`; third-party
components retain their own licenses and notices.

Normal app builds generate Rust and NuGet notices after locked restore. NuGet
licenses come from package files, the package's exact declared repository
commit, or a captured publisher URL bound to its exact package version, locked
content hash and nuspec hash. Publisher sources retain separately verified raw
and text assets; publisher notices are preserved. The generated inventory
records unresolved source gaps and rejects runtime source gaps.
Cross builds require `bun scripts/prepare-notices.ts` first. Stage
`generated/notices` with the listed source inputs; MSBuild verifies every source
and bundled output SHA256 before compilation. Missing or stale notices fail the
cross lane. The MSIX contains both notice texts and their dependency inventories
under `Licenses`.

## One-time Windows setup

Open an elevated PowerShell terminal. If `winget` is missing or broken, repair
App Installer first from Microsoft Store, then apply the checked-in WinUI
configuration. This follows Microsoft's
[WinUI development setup](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/set-up-your-development-environment):

```powershell
winget configure --file .\packages\tasknotes-windows\dev\winui-configuration.winget --accept-configuration-agreements
winget install jdx.mise
```

The configuration enables Developer Mode and installs Visual Studio 2026
Community with .NET desktop, Universal Windows, Windows App SDK, Windows SDK
26100, and x64 MSVC components. Reopen an elevated terminal, install the CLI
template, and provision this machine's development certificate:

```powershell
dotnet new install Microsoft.WindowsAppSDK.WinUI.CSharp.Templates
.\packages\tasknotes-windows\scripts\provision-signing.ps1
```

The certificate's private key stays in the current user's certificate store.
Only its public certificate is trusted in the local machine's Trusted People
store. Its thumbprint is written only to ignored
`packages/tasknotes-windows/Directory.Build.local.props`.

The pinned versions come from the official [.NET 10 downloads](https://dotnet.microsoft.com/en-us/download/dotnet/10.0),
[Windows App SDK releases](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/downloads),
and [UniFFI C# generator](https://github.com/NordSecurity/uniffi-bindgen-cs)
documentation.

## Repository onboarding

Run these commands from the repository root:

```powershell
mise install
bun install --frozen-lockfile
bunx turbo run generate
bun run windows:preflight
```

## Commands

```powershell
bun run windows:build    # locked release build, including WinUI
bun run windows:test:unit
bun run windows:test:integration
bun run windows:test:winui
bun run windows:coverage # Cobertura baselines plus changed-line ratchet
bun run windows:analysis # compiler, analyzers, architecture, duplication
bun run windows:format   # CSharpier and XAML Styler
bun run windows:mutation # explicit Stryker.NET and cargo-mutants deep gate
bun run windows:package  # signed MSIX under AppPackages/
bun run windows:cross-package # unsigned MSIX built on Linux
bun run windows:run      # register debug identity and launch
bun run windows:parity-check # original assertion inventory, not runtime proof
bun run windows:e2e      # standalone production-store local journey
bun run windows:e2e --scenario standalone-production
bun run windows:accessibility # packaged keyboard and UIA contract scenario
bun run windows:visual-profile # requires TASKNOTES_VISUAL_PROFILE and matching OS state
bun run windows:visual-matrix  # aggregates six fresh real-session profiles
bun run windows:verify   # local checks, packaged local UIA, six real visual profiles
```

`windows:run` is also the correct way to refresh an existing Developer Mode
registration. A plain Debug build updates compiler output but does not deploy
the new XAML resources into the registered package.

To install the newest signed release package after `windows:package`, run the
generated installer from the newest `_Test` directory. It installs the public
development certificate and required Windows App Runtime dependency before the
MSIX:

```powershell
$installer = Get-ChildItem .\packages\tasknotes-windows\AppPackages -Recurse -Filter Install.ps1 |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
& $installer.FullName -Force -SkipLoggingTelemetry
```

## Linux package build

`bun run windows:cross-package` builds every Windows project and the unsigned
MSIX on Linux, in the pinned
[`windows-cross-compiler-winui`](../windows-cross-compiler/) image, and writes
the package to `AppPackages/cross/`. CI does not run this build while the
Windows compiler image build is paused. The image needs a linux/amd64
container host.

The Rust core cross-compiles for `x86_64-pc-windows-msvc` with cargo-xwin, and
`Directory.Build.targets` imports the image's `$(WindowsCrossTargets)`, which
runs Microsoft's XAML compiler, `makepri`, and `makeappx` under Wine. The
package README documents the Wine patches and the build's limitations. This is
compile and package evidence only: packaged runtime, UI Automation, and parity
claims still require `windows:verify` on Windows.

Portable Linux CI uses `build`, `typecheck`, `lint`, `test:ci`, and
`coverage:portable:check`. The two portable suites run once with coverage,
randomized ordering, timeouts, and per-test JUnit reports. The uncached coverage
check consumes those fresh reports and applies the same baseline and changed-line
ratchets. `bun run coverage:portable` remains the standalone local command that
runs both suites and checks coverage. The checked-in `projects.json` classifies every project, and the
quality checker proves the portable solution includes every portable project
and excludes every WinUI, MSIX, and UI Automation project. The CI test
manifest lists both Windows-only suites with explicit reasons; they are not
silently omitted.

## Architecture

The boundary is strict:

```text
WinUI -> Presentation -> FacetTaskNotesStore -> EngineRunner -> generated C# UniFFI -> Rust core
```

Portable view models own navigation, command state, validation, projections,
deep-link interpretation, dialogs, editor state, and auxiliary-window state.
They consume immutable `ITaskNotesStore` snapshots and portable contracts;
only the App project references WinUI and Windows Runtime APIs.

The shell composes focused compiled views for task lists, Quick Add, the task
editor, Board, and Settings. Native event adapters stay beside their WinUI
views, while command state and validation remain in portable view models. This
keeps generated XAML and UI-thread concerns out of the portable test surface.

The desktop list follows the retained macOS client's compact composition: a
source sidebar, grouped rows with aligned metadata/date columns, native query
menus and Extended Ctrl/Shift selection, inline capture, and a persistent
inspector. Narrow windows overlay the inspector over the list. Hover actions
also appear on keyboard focus, and motion honors Windows animation preferences.
Dimensions, typography, motion durations, and supported configured colors are
validated against the shared `tasknotes-fixtures/presentation` contracts; native
semantic colors remain responsible for theme and high-contrast behavior.

Inspector text commits on Return/blur (body on Done/blur), while native controls
commit their changed field. Commits retain the owning vault, revision and exact
journal admission; newer text survives receipt observation, and untouched fields
refresh from the authoritative result. Navigation and close first flush valid
drafts. Failed drafts stay available for Retry/Discard; admitted uncertain or
applied-but-unobserved actions must use existing Settings recovery rather than
submitting a replacement edit. Token suggestions and Quick Add chips use core
projections. There is one main workspace window today; auxiliary capture windows
own their drafts without redirecting the main query, selection, or inspector.

Reminder kind changes remove only the previous kind's incompatible fields and
write the new kind's required values, preserving reminder IDs and extensions.
Dependency rows edit task references, relationship types and optional gaps as
structured records. The owning vault's Rust metadata supplies the supported
relationships and any explicitly configured default; without a default, Add
requires a relationship choice. Unchanged records and vendor fields are retained,
and unsupported existing entries remain visible and read-only until explicitly
removed. Unsupported whole lists require an explicit replacement draft. Metadata failures
retain the draft for retry, and late responses cannot replace another task's editor.
Simple repeat controls consume Rust projections and Rust-built rules, preserve
unchanged rule text exactly, and retain existing calendar selectors and endings
when changing an interval. Patterns the controls cannot express, including
ordinal weekdays, and rules declined by the common projection remain in the full
recurrence field; Apply requires editing that rule there or clearing it before
choosing a new simple schedule.

Row actions freeze their rendered vault, path, revision, and recurrence
occurrence before entering the host queue. Bulk completion supports distinct
notes; selecting multiple occurrences of one note requires completing those
occurrences separately because the existing core batch contract requires
distinct files. The rejected bulk action retains selection and creates no
journal entry. Note-scoped scheduling, priority, and deletion explicitly
deduplicate occurrences and reject inconsistent reviewed revisions. Named-view
creation freezes its owning vault/query and retains the exact admitted action
through uncertain outcomes; an applied view is observed without creating it again.

Portable checks prove coordinator behavior and projections. XAML source checks
and cross packaging are separate from native Windows interaction, motion,
accessibility and screenshot acceptance, which require an interactive Windows
host.

`FacetTaskNotesStore` exposes the complete task snapshot, fixed and dynamic query
projections, vocabulary, saved-view metadata, completion undo, pending IDs,
sync state, errors, and retained conflicts. An `EngineRunner` single-reader
channel executes every FFI call away from the UI thread. The standalone store
serializes operations and background snapshot publication through one operation
gate; its bounded coalescing pump is awaited during disposal.

The retained server-backed `TaskNotesStore` publishes its immutable snapshot
inside the queued engine operation, before completing that operation, and
rejects older publication sequences. Concurrent callers cannot replace newer
state with an older snapshot.

Host callbacks supply app-private filesystem capabilities, bounded HTTP and
WebSocket transport, clock and timezone context, cryptographic randomness,
cancellation and secure credential storage. C# does not implement recurrence,
mutation, wire-protocol, filtering, sorting or synchronization policy. Host
JSON input and output are validated against the shared versioned schemas in
`tasknotes-fixtures`; binary file content uses the native binary boundary.

Settings signs in to Obsidian, handles MFA, lists accessible vaults and
authorizes an existing vault. Each connected vault has an app-private replica
and a durable Rust SQLite index/outbox. All authorized profiles synchronize;
selection controls the visible profile. The application does not create a
remote vault. An external folder can be indexed read-only; writes require the
private replica capability. Revoked filesystem access leaves the last complete
cached index readable and exposes an actionable error for refresh or mutation.

Credential Locker holds the account token and vault keys qualified by an
authorization generation, profile and vault. Signing out stops sessions before
removing credentials. Signing in again requires explicit reauthorization of
existing profiles, preserving their replicas and pending changes. App-local
files retain nonsecret profile capabilities, selection and immutable mutation
envelopes. Shell preferences remain in local settings.

The inspector offers explicit single-date generation and a configured rolling
window as user actions with normal core Undo authority. Settings queries typed,
paged generation outcomes after restart independently of primary draft cleanup.
Pending, failed and unrepairable outcomes have separate presentation; Repair
re-queries the current core-authored command and parent/child revision fences
before admitting a new user decision. The original progression and older retry
envelopes remain immutable.

The local packaged acceptance journey uses an ordinary daily series and a
descriptor-owned missing-template fault. Completion must remain saved while
Settings reports a durable failed successor after a cold relaunch. Restoring
the template alone must not retry it; the real Repair action creates the future
occurrence, and Undo restores the exact complete vault while preserving the
already completed child and progressed parent. Semantic assertions read exact
typed properties through Rust's parser in a separate read-only index; opaque
metadata, whole-vault Undo and original seed hashes retain independent byte
checks. This source journey still requires interactive Windows execution.

Automatic rolling generation runs through the same serialized production journal,
with the core's `automatic_maintenance` origin and no user sound or Undo authority.
It requires a writable private capability, valid indexed configuration, and the
core's settled initial-Sync barrier for Windows' current Direct Sync profiles.
Disabling network sessions does not manufacture readiness. Browsing and reminder
projection never request generation. Initialization, explicit refresh, user
mutations and settled remote-content changes coalesce by profile, captured local
day and version-fenced pages. Dirty generations preserve requests arriving during
a traversal or drain; upload acknowledgments do not start another generation loop.
Lifecycle, secure account authority and exact profile ownership are rechecked
after awaits and again with readiness on the native worker before an automatic
write. A lost owner leaves already admitted envelopes intact.

A parent rename or deletion between a complete plan and native dispatch is a
typed rejection. Only an exact absent or parked receipt permits retiring that
obsolete automatic envelope and bounded replanning; uncertain pending/applied
decisions remain retained. An expected recurrence expansion-budget rejection
keeps the last complete task projection and publishes durable generation
outcomes and retained actions, so a correctable repeat rule cannot fault the
background publication pump or hide Repair after restart.

Completed task and saved-view projections belong to one explicit profile. A
profile switch clears actionable rows, caches and vocabulary before loading
the new vault; a rejected query can retain a prior complete list only for that
same profile. Cache-based legacy actions require the selected projection owner,
while rendered-row actions retain and verify their explicit original profile
and reviewed revision. Generation outcomes, saved actions and actual core Undo
remain available independently when the new vault has no complete task list.

Recovery also reviews automatic envelopes whose parent was deleted or stopped
being recurring. An obsolete decision is retired only after the exact core
receipt reports it absent or parked, followed by a fresh bounded replan. Pending
or applied outcomes retain their original identity for observation. Repeated
concurrent changes stop at an actionable refresh message; they cannot create an
unbounded maintenance loop or repeatedly submit the same stale fence.

The composition root uses Microsoft.Extensions.Hosting and writes allow-listed
JSONL diagnostics under app-local storage. Logs contain operation metadata,
correlation IDs, durations, status codes, and exception types; tokens, headers,
request bodies, Markdown, and task content are never persisted. Files rotate
at 25 MB and expire after seven days.

Coverage is a checked-in ratchet, not a one-time report. Full Windows line
coverage is currently 90.3% for Host, 97.5% for Presentation, and 92.7% for
handwritten adapters. Portable CI separately holds Host at 90.2% and
Presentation at 96.3%. The shared Bun E2E harness and Rust core/client/FFI
boundary have their own changed-line and non-regression checks.

## Native surface

The `NavigationView` contains Inbox, Today, Upcoming, Browse, completed tasks,
Board, saved views, projects, contexts, tags, and Settings. The reusable task workspace supports search, filters, sorting,
grouping, multi-selection, bulk mutation, task editing, recurrence completion,
and LIFO completion undo. The shell also implements `tasknotes://` activation,
singleton auxiliary windows, keyboard commands, a configurable global Quick
Add hotkey, persistence, and stable automation identifiers.

Apple-only widgets, Live Activities, Siri/App Intents, haptics, and Apple
lifecycle behavior are explicit parity exclusions. Windows Widgets,
notifications and ARM64 are separate native surfaces. Windows 11 x64 is the
supported target. Store artifacts require the registered product identity and
the acceptance layers below.

## Microsoft Store package

Enroll the publishing account in Microsoft Partner Center and reserve the app
name. In that product's **Product management → Product identity** page, copy
the registered **Package/Identity/Name**, **Package/Identity/Publisher** and
**Package/Properties/PublisherDisplayName** values. Use the exact registered
values; the checked-in `CN=TaskNotes Development` publisher belongs only to
local development packages. Microsoft's
[package identity requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/app-package-requirements?pivots=store-installer-msix)
describe this correspondence.

Create a nonsecret local JSON file with `schemaVersion: 1`, the three strings
as `name`, `publisher`, `publisherDisplayName`, your `displayName`, and a
four-component `version` whose last component is `0`. Do not include
certificates, passwords or account credentials. From the package directory on
Windows 11 x64, run:

```powershell
bun run windows:store-package C:\release\facet-store-identity.json
```

The command rejects missing or development identity, builds Release with a
separate generated manifest, disables local signing, and verifies the packaged
identity, native DLL and absence of a development signature. Artifacts are
written to a fresh `AppPackages/Store/` directory. It never uploads or submits a
package. Microsoft signs packages accepted through the Store, as described in
the [MSIX signing guide](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide).
The existing `windows:package` command still builds the locally signed
development package.

Enrollment and product reservation are prerequisites for this lane. Source or
cross compilation does not establish native launch, signing, Store acceptance
or publication. Use `windows:verify` on an interactive Windows worker before
release, then complete the product submission in Partner Center.

## Acceptance layers

`windows:e2e` builds and installs the dedicated `red.sjer.TaskNotes.E2E`
package and drives the normal `FacetTaskNotesStore` and Rust engine through
Windows UI Automation. Each invocation stages a fresh synthetic vault with real
TaskNotes configuration and exact seed hashes under that package's
`LocalState/StandaloneAcceptance/<run UUID>/`. A closed descriptor binds the
run, package family, private profile and seed bytes. Its JSON Schema is shared
by the actual TypeScript and C# validators. Initial bootstrap rejects links,
undeclared files, changed hashes and foreign profiles; a bound durable receipt
allows subsequent task edits to survive relaunch. It never grants an external
folder write capability or supplies a fake account/remote. Local acceptance
disables Sync; real remote behavior is a separate acceptance layer.

The descriptor entrypoint and isolated settings/credential namespace exist only
in the E2E build. Release rejects the descriptor argument and excludes its
bootstrap sources. The runner refuses to adopt a running E2E package and never
resets another run's package data, credentials or profile. UIA ownership binds
the activation-returned PID, primary executable, actual package family, process
creation lifetime, and exactly one run-specific workspace window. Restarts stop
only that owned process. Global hotkey verification briefly creates one
test-owned focus window and destroys that exact window on the same thread.

The production journey covers local capture, validation and autosave, deletion,
search/navigation, bulk operations, portable saved-view Markdown, routes,
board mutations, shell persistence, accessibility, and hotkey collisions. A real
Windows file-sharing denial exercises retained-action admission and retry.
Relaunch preserves the original ID, timestamp, revision and command; a concurrent
Markdown edit exercises rejected-action retirement without overwriting the other
editor. Completion Undo checks the original file bytes, including grouped
actions. Untouched Markdown, unknown historical metadata and a binary attachment
have independent exact-byte assertions.

Each native producer must emit precisely its assertion set from
[`e2e/standalone/scenarios.json`](e2e/standalone/scenarios.json); missing,
duplicate, foreign-run or wrong-scenario evidence fails. Results, JUnit, the
synthetic vault and app-only PNGs remain in the fresh run's private directory,
whose path the runner prints. Capture uses `PrintWindow` for the owned window,
rejects visible password surfaces and blank output, and never screenshots the
desktop. Each real scale/theme profile captures Browse, inspector, Quick Add
and Board. Native execution is required to establish that these producers work;
portable tests and source validation do not establish UIA acceptance.

The old server scenario sources and runner are non-executable reference text
under `e2e/reference`; their assertions remain in `e2e/scenarios.json` and
`parity.json`. `windows:parity-check` preserves that original inventory.
[`e2e/standalone/porting.json`](e2e/standalone/porting.json) maps every original
assertion to its standalone producer, an explicit semantic replacement, or a
named live acceptance requirement. No server-backed
release composition or obsolete URL/token UI is reintroduced. Executable
server host unit/integration contracts remain separate.

Real account/MFA and vault discovery, Credential Locker separation,
independent-client bidirectional Sync and offline replay, account reauthorization,
and actual two-replica conflicts require the named live scenarios in that matrix.
They need a synthetic authorized remote vault and an interactive Windows host;
local acceptance makes no claim about them.

The Windows UI lane requires unlocked interactive Windows 11 x64 workers. The
inactive lane contract is checked in at `ci/windows-ci.pipeline.yml`; native
worker availability is tracked in Tracker as AI-148. Portable engine/host tests and Linux
cross packages are distinct from actual packaged Windows runtime and UIA
evidence. A PR needs attached local `windows:verify` evidence and must not claim
packaged Windows tests are CI-enforced before that worker exists. Native
filesystem rename and directory-entry power-loss durability also require real
Windows verification; a portable `Flush(true)` test proves file contents only.

Private JSON receipt commits flush the new file and use Windows
[`MoveFileExW` with `MOVEFILE_WRITE_THROUGH`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)
for its namespace move. The bounded exchange adapter separately flushes actual
replacement/captured file handles before committing an applied outcome. It
preserves recovery state for partial
[`ReplaceFileW`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)
failures and checks prepared file identity rather than equal contents. This
route uses supported file operations without assuming a POSIX directory flush
on Windows. Provider power-loss acceptance and writable external folders remain
separate native verification requirements.

Bounded callback migrations preserve earlier retained backup IDs. Capability
owners merge recorded legacy and current metadata in sorted pages of at most
128 records and stream preserved bytes into private read snapshots. A
profile- and engine-qualified acknowledgement receipt commits before legacy
files are unlinked; interrupted cleanup resumes from that receipt. Missing or
ambiguous legacy captures remain visible errors requiring review. Sealed
metadata traversal does not read attachment contents.

Saved warnings belong to one applied action and clear when a newer action is
admitted, including a rejected edit.
