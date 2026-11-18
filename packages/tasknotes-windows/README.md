# TaskNotes for Windows

Facet is the native Windows 11 x64 client for the Facet task management service.
WinUI 3 renders the application; a portable C# host (`TaskNotes.Windows.Host`)
persists tasks, projects, sections, labels, reminders, saved views, sync cursor
state, and the optimistic `QueuedCommand` outbox in a local SQLite database
(`Microsoft.Data.Sqlite`) and synchronizes with `tasknotes-server` over
`POST /api/v1/sync` using generated `TaskNotes.Protocol` DTOs
(`packages/facet-protocol/generated/FacetProtocol.cs`).

Local applied receipts drive task-added, completed, deleted, reopened, and Undo
feedback before network synchronization settles. Feedback carries an explicit
mutation identity and originating-window activation lease; searches and other
task actions do not invalidate it. Leaving the foreground invalidates a pending
cue permanently. Startup, remote delta updates, outbox replay, no-ops, and
ordinary field edits are silent. Bulk completion emits one aggregate cue. The
native player consumes each eligible effect once and drops overlapping attempts
using a monotonic duration gate at playback, without queuing audio. The four
bundled first-party WAVs and shared feedback JSON under
`packages/facet-protocol/presentation` are strictly validated. Task sounds
default on; explicit choices persist independently of other settings. Malformed
sound preferences require an explicit repair choice.

Quick Add opens as a compact native dialog with immediate input focus, pure-C#
`QuickCaptureParser` removable chips (`today`, `tomorrow`, `next week`, weekday
names, `YYYY-MM-DD`, `#Project`, `@label`, `p1`–`p4`, and `every ...` repeat
phrases), and optional Details for notes, Planned/Due dates, priority, and
taxonomy tokens. Clearing a parsed chip records an explicit null or empty-list
override. Metadata without a title is rejected before outbox admission. Button
deferrals retain the dialog during submission and after failure; reopening
preserves an owned draft. Add & add another resets only after a confirmed local
write, and newer typing survives an older result. Submission freezes one
`PreparedCapturePayload` with resolved relative dates and active view defaults.

Applied confirmations remain visible for at least six seconds, pause expiration
while focused or hovered, honor a longer native accessibility message duration,
and offer Undo for the authoritative current completion receipt. `Ctrl+Z`
remains native text Undo inside text and password editors. Task receipt motion
uses the shared duration and respects Windows animation settings. Native
playback, dialog focus, motion, high contrast, and MSIX resource installation
require an interactive Windows host; portable tests and source checks do not
establish those runtime behaviors.

Settings configures the Facet server URL (defaulting to
`https://tasknotes.tailnet-1a49.ts.net`), stores the bearer API token in Windows
Credential Locker (`PasswordVault` resource `red.sjer.Facet`), surfaces parked
server-rejected outbox mutations for Retry or Discard, and provides independent
background sync and Windows reminder preferences. When installed via MSIX, the
packaged app registers background maintenance tasks and schedules OS toast
reminders within a 30-day window. When launched directly as the standalone
unpackaged `TaskNotes.Windows.App.exe` (`WindowsPackageType=None`),
`PackageIdentity.IsPackaged` routes local state and settings to
`%LOCALAPPDATA%\Facet`, plays bundled WAV cues via `file://` URIs, continues
using Windows Credential Locker for token storage, and gracefully skips
MSIX-only background task and toast registration APIs.

First-party application code uses GPL-3.0-only. The Windows package includes the
exact repository license under `Licenses/GPL-3.0.txt`; third-party NuGet
components retain their own licenses and notices.

Normal app builds generate NuGet notices after locked restore. NuGet licenses
come from package files, the package's exact declared repository commit, or a
captured publisher URL bound to its exact package version, locked content hash,
and nuspec hash. Cross builds run `bun scripts/prepare-notices.ts` first to
stage `generated/notices`, and MSBuild verifies every source and bundled output
SHA256 before compilation.

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

The pinned versions come from the official
[.NET 10 downloads](https://dotnet.microsoft.com/en-us/download/dotnet/10.0) and
[Windows App SDK releases](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/downloads)
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
bun run windows:build          # locked release build, including WinUI
bun run windows:test:unit
bun run windows:test:integration
bun run windows:test:winui
bun run windows:coverage       # Cobertura baselines plus changed-line ratchet
bun run windows:analysis       # compiler, analyzers, architecture, duplication
bun run windows:format         # CSharpier and XAML Styler
bun run windows:mutation       # explicit Stryker.NET deep gate
bun run windows:package        # signed MSIX under AppPackages/
bun run windows:cross-package  # unsigned MSIX + standalone win-x64 exe built in container
bun run windows:run            # register debug identity and launch
bun run windows:parity-check   # assertion inventory check
bun run windows:e2e            # standalone production-store local journey
bun run windows:accessibility  # packaged keyboard and UIA contract scenario
bun run windows:visual-profile # requires TASKNOTES_VISUAL_PROFILE and matching OS state
bun run windows:visual-matrix  # aggregates six fresh real-session profiles
bun run windows:verify         # local checks, packaged local UIA, six real visual profiles
```

To install the newest signed release package after `windows:package`, run the
generated installer from the newest `_Test` directory:

```powershell
$installer = Get-ChildItem .\packages\tasknotes-windows\AppPackages -Recurse -Filter Install.ps1 |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
& $installer.FullName -Force -SkipLoggingTelemetry
```

## Container cross-package build

`bun run windows:cross-package` builds every Windows project, the unsigned MSIX
(`AppPackages/cross/`), and a self-contained unpackaged Windows x64 executable
bundle (`AppPackages/win-x64-standalone/TaskNotes.Windows.App.exe`) inside the
pinned [`windows-cross-compiler-winui`](../windows-cross-compiler/) image.
`Directory.Build.targets` imports the image's `$(WindowsCrossTargets)`, which
runs Microsoft's XAML compiler, `makepri`, and `makeappx` under Wine. This is
compile and package evidence only: packaged runtime, UI Automation, and parity
claims still require `windows:verify` on Windows.

Portable CI uses `build`, `typecheck`, `lint`, `test:ci`, and
`coverage:portable:check`. The unit and real-server integration suites run with
coverage, randomized ordering, timeouts, and per-test JUnit reports, and the
coverage check enforces non-decreasing baselines and changed-line ratchets. The
checked-in `projects.json` classifies every project, and `quality-check.ts`
proves `TaskNotes.Windows.Portable.slnx` includes every portable project and
excludes WinUI, MSIX, and UI Automation projects.

## Architecture

The boundary is strict:

```text
WinUI (App) -> Presentation -> FacetSyncStore (Host) -> FacetSqliteCache (SQLite) + FacetApiClient (/api/v1/sync) -> TaskNotes.Protocol (Bindings)
```

Portable view models own navigation, command state, validation, projections,
deep-link interpretation, dialogs, editor state, and auxiliary-window state.
They consume immutable `ITaskNotesStore` snapshots and portable contracts; only
`TaskNotes.Windows.App` references WinUI and Windows Runtime APIs.

- **`FacetSqliteCache`**: Transactional `Microsoft.Data.Sqlite` persistence
  (`facet-sync.sqlite3`) storing `tasks`, `projects`, `sections`, `labels`,
  `reminders`, `filters` (saved views), `sync_meta` (`sync_token`), and the
  `outbox` (`QueuedCommand` JSON plus parked error items).
- **`FacetApiClient`**: Typed `HttpClient` wrapper sending `Bearer` token
  authenticated `SyncRequest` payloads to `/api/v1/sync` using
  `FacetProtocolJson.Options`.
- **`FacetSyncStore`**: Hydrates synchronously from SQLite on `InitializeAsync`,
  applies optimistic local mutations and enqueues `SyncCommand` entries, sends
  `""` on the wire to clear nullable task fields (`section_id`, `parent_id`,
  `due_date`, `due_datetime`, `recurrence_rule`), handles `full_sync` baseline
  replacement and `temp_id_mapping` remapping across cached entities and
  subsequent queued outbox commands, advances recurring tasks optimistically via
  `RecurrenceCodec`, and surfaces server-rejected commands (`"error: ..."`) as
  `ParkedChange` items for retry or discard.
- **Todoist-style Board**: Inside a Project route, Board columns represent
  `"No section"` plus ordered project `Section`s (moving cards updates
  `section_id` and `child_order`); in cross-project routes, Board columns
  group open tasks by Priority `P1`–`P4`.

The composition root uses `Microsoft.Extensions.Hosting` and writes allow-listed
JSONL diagnostics under app-local storage. Logs contain operation metadata,
correlation IDs, durations, status codes, and exception types; bearer tokens,
headers, request bodies, and task content are never persisted. Files rotate at
25 MB and expire after seven days.

## Native surface

The `NavigationView` contains Inbox, Today, Upcoming, Browse, Completed, Board,
saved views (`Filter`s), projects, contexts, labels/tags, and Settings. The
workspace supports search, filters, sorting, grouping, multi-selection, bulk
mutation, task editing, RFC 5545 recurrence controls, LIFO completion undo,
`tasknotes://` deep links, singleton auxiliary windows, keyboard commands, a
configurable global Quick Add hotkey, window/shell persistence, and stable
automation identifiers.

## Microsoft Store package

Enroll the publishing account in Microsoft Partner Center and reserve the app
name. In that product's **Product management → Product identity** page, copy the
registered **Package/Identity/Name**, **Package/Identity/Publisher**, and
**Package/Properties/PublisherDisplayName** values. Microsoft's
[package identity requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/app-package-requirements?pivots=store-installer-msix)
describe this correspondence.

Create a nonsecret local JSON file with `schemaVersion: 1`, the three strings as
`name`, `publisher`, `publisherDisplayName`, your `displayName`, and a
four-component `version` whose last component is `0`:

```powershell
bun run windows:store-package C:\release\facet-store-identity.json
```

Microsoft signs packages accepted through the Store, as described in the
[MSIX signing guide](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide).
Use `windows:verify` on an interactive Windows worker before release, then
complete the product submission in Partner Center.
