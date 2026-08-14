# TaskNotes for Windows

Native Windows 11 x64 client for TaskNotes. WinUI 3 renders the application,
while the committed C# UniFFI binding calls the same pure Rust domain and sync
engine as the macOS client.

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

Portable Linux CI uses `build`, `typecheck`, `lint`, `coverage:portable`, and
`test:ci`. The checked-in `projects.json` classifies every project, and the
quality checker proves the portable solution includes every portable project
and excludes every WinUI, MSIX, and UI Automation project. The CI test
manifest lists both Windows-only suites with explicit reasons; they are not
silently omitted.

## Architecture

The boundary is strict:

```text
WinUI -> Presentation -> TaskNotesStore -> EngineRunner -> generated C# UniFFI -> Rust core
```

Portable view models own navigation, command state, validation, projections,
deep-link interpretation, dialogs, editor state, and auxiliary-window state.
They consume immutable `ITaskNotesStore` snapshots and portable contracts;
only the App project references WinUI and Windows Runtime APIs.

The shell composes focused compiled views for task lists, Quick Add, the task
editor, Board, and Settings. Native event adapters stay beside their WinUI
views, while command state and validation remain in portable view models. This
keeps generated XAML and UI-thread concerns out of the portable test surface.

`TaskNotesStore` exposes the complete task snapshot, fixed and dynamic query
projections, vocabulary, saved-view metadata, completion undo, live timing and
Pomodoro state, pending IDs, sync state, errors, and parked changes. A
single-reader channel executes every FFI call away from the UI thread. Its
bounded coalescing pump owns background drains and is awaited during disposal.
Host
callbacks supply atomic app-local files, bearer-authenticated `HttpClient`,
system time and timezone, cryptographic randomness, cancellation, and
idempotent retry timers. C# does not implement recurrence, mutation,
wire-protocol, filtering, sorting, or synchronization policy.

The server URL is non-secret and lives in local settings. The bearer token
lives only in Windows Credential Locker.

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
notifications, Store publication, ARM64, and production signing remain
deferred. Windows 11 x64 is the supported target.

## Real-server E2E

`@tasknotes/e2e` creates a fresh seeded Markdown vault, starts the real
`tasknotes-server` on an ephemeral port, and fronts it with a deterministic
offline/fail-next proxy. `windows:e2e` builds and registers the isolated
`red.sjer.TaskNotes.E2E` package once, resets package data and Credential Locker
state between serial scenarios, and drives the app with direct Windows UI
Automation. Failed scenarios retain the redacted server/proxy logs, JUnit XML,
UIA tree, screenshot, process inventory, and vault under `artifacts/e2e/`.

The Windows UI lane remains local until Buildkite has unlocked interactive
Windows 11 x64 workers. The exact inactive lane contract is checked in at
`ci/windows-buildkite.pipeline.yml`; provisioning is tracked in
`packages/docs/todos/tasknotes-windows-buildkite-worker.md`. Until that TODO is
complete, a PR needs attached local `windows:verify` evidence and must not
claim packaged Windows tests are CI-enforced.
