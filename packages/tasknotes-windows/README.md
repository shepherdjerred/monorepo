# TaskNotes for Windows

Facet is the standalone Windows 11 x64 client for TaskNotes vaults. WinUI 3
renders the application; a portable host invokes the shared Rust TaskNotes and
Obsidian Sync engines through generated C# UniFFI bindings. The application
stores its index and mutation journal locally and connects directly to an
authorized Obsidian Sync vault.

The host validates the complete mutation receipt before presenting its saved
result. Template and filename notices accompany Saved and belong to the exact
vault, action and engine request. Expected refresh or cleanup I/O failures keep
the saved outcome and original action available, with separate maintenance text.
The editor retains its draft until it can load the authoritative resulting task;
late results cannot replace a newer draft. Invalid receipts fail the contract.

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
bun run windows:parity-check
bun run windows:e2e
bun run windows:e2e --scenario quick-add-create
bun run windows:e2e --keep-artifacts
bun run windows:accessibility # packaged keyboard and UIA contract scenario
bun run windows:visual-profile # requires TASKNOTES_VISUAL_PROFILE and matching OS state
bun run windows:visual-matrix  # aggregates six fresh real-session profiles
bun run windows:verify   # complete local release and packaged-E2E gate
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
the package to `AppPackages/cross/`. The `tasknotes-windows-cross` CI step runs
the same build. The image needs a linux/amd64 container
host.

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

`FacetTaskNotesStore` exposes the complete task snapshot, fixed and dynamic query
projections, vocabulary, saved-view metadata, completion undo, live timing and
Pomodoro state, pending IDs, sync state, errors, and retained conflicts. A
single-reader channel executes every FFI call away from the UI thread. Its
bounded coalescing pump owns background drains and is awaited during disposal.
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
Board, saved views, projects, contexts, tags, Pomodoro, Time Report, and
Settings. The reusable task workspace supports search, filters, sorting,
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

`@tasknotes/e2e` creates a fresh seeded Markdown vault, starts the real
`tasknotes-server` on an ephemeral port, and fronts it with a deterministic
offline/fail-next proxy. `windows:e2e` builds and registers the isolated
`red.sjer.TaskNotes.E2E` package once, resets package data and Credential Locker
state between serial scenarios, and drives the app with direct Windows UI
Automation. Failed scenarios retain the redacted server/proxy logs, JUnit XML,
UIA tree, screenshot, process inventory, and vault under `artifacts/e2e/`.

That harness exercises the retained server implementation; its passing results
do not prove the standalone account, replica or direct Sync composition.
Standalone acceptance must exercise local Markdown mutation, immutable retry
identity, cached restart, remote ingestion, conflicts and the equivalent UI
assertions through the production host.

The Windows UI lane requires unlocked interactive Windows 11 x64 workers. The
inactive lane contract is checked in at `ci/windows-ci.pipeline.yml`; native
worker availability is tracked as AI-148. Portable engine/host tests and Linux
cross packages are distinct from actual packaged Windows runtime and UIA
evidence. A release needs attached `windows:verify` evidence and must not claim
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

Standalone tracked-time summaries stream bounded history pages while preserving
the core's per-entry rounding. The editor and Time Report show at most 128
history entries or running sessions per page. Continuations retain their original
vault, task revision, index version, clock and request owner; changing vaults or
refreshing requires a fresh reading. Saved warnings belong to one applied action
and clear when a newer action is admitted, including a rejected edit.
