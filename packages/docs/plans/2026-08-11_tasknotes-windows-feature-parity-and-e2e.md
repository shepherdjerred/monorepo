---
id: plan-2026-08-11-tasknotes-windows-feature-parity-and-e2e
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# TaskNotes Windows Feature Parity and Real-Server E2E

Expand the initial Windows Today slice into the union of the macOS and iOS
application surfaces. Apple interaction patterns become native Windows
interactions while domain, recurrence, wire, and synchronization behavior stays
inside the shared Rust core.

The follow-on
[Windows quality-hardening plan](2026-08-11_tasknotes-windows-quality-hardening.md)
defines the presentation-layer extraction, strict analysis, coverage, and
evidence requirements for this surface.

## Success criteria

- Every applicable macOS or iOS capability is implemented on Windows or has an
  explicit platform exclusion in the checked parity manifest.
- The Windows 11 x64 MSIX exercises the production TaskNotes protocol through
  generated UniFFI bindings.
- `bun run windows:e2e` provisions a real local server and Markdown vault,
  drives an isolated E2E package through UI Automation, and validates the
  resulting Markdown.
- `bun run windows:verify` is the complete local Windows release gate.
- Linux Buildkite continues to run portable core, bindings, host, and
  real-server integration tests without attempting WinUI or MSIX work.

## Architecture

The platform boundary remains:

```text
WinUI -> view models -> TaskNotesStore -> EngineRunner -> generated UniFFI -> Rust core
```

Rust owns domain values, recurrence, filtering, sorting, mutation construction,
server URLs and bodies, response validation, synchronization, retry policy, and
the durable queue. C# owns Windows presentation, application-data storage,
Credential Locker, `HttpClient`, windowing, activation, hotkeys, and UI
automation identifiers.

Timing and Pomodoro actions are live server operations. They are not queued
offline because replaying a start or stop after an arbitrary delay would create
false timing data.

## Implementation

### Enforceable parity

- Add a machine-readable feature manifest covering the union of the shipped
  macOS and iOS surfaces.
- Record each feature's source platform, Windows destination and interaction,
  applicable or excluded disposition, and automated scenario identifiers.
- Add `windows:parity-check`; it fails for duplicate identifiers, unknown
  scenarios, an applicable feature without automated coverage, or an exclusion
  without a reason.
- Translate swipe actions to row commands and context menus, bottom sheets to
  inspectors/dialogs/windows, and pull-to-refresh to toolbar refresh and
  `Ctrl+R`.

### Shared core and host

- Expose the server's existing task timing and Pomodoro endpoints from
  `TaskNotesClient` through `TaskNotesApi` and UniFFI. Regenerate both committed
  binding sets and extend exact request/response tests.
- Expand `TaskNotesStore` from a Today projection to the complete task snapshot,
  vocabulary, fixed and dynamic queries, pending and parked state, active time,
  Pomodoro, and aggregate reports.
- Add create, update, delete, status, occurrence completion, bulk mutation,
  completion undo, saved-view lifecycle, timing, Pomodoro, refresh,
  reconfiguration, and parked retry/discard operations.
- Keep all generated calls on the single-reader `EngineRunner`. A successful
  live timing mutation refreshes the engine snapshot; a failed request leaves
  local task state unchanged and surfaces the failure.
- Persist saved-view presentation metadata in atomic shell storage while using
  core-owned JSON codecs and filtering/sorting semantics.

### Native Windows surfaces

- Build a `NavigationView` shell for Inbox, Today, Upcoming, Browse, Board,
  Saved Views, Projects, Contexts, Tags, and Settings.
- Reuse one task-list workspace for search, filters, sorting, grouping,
  completed tasks, cached-first loading, pending state, multi-selection, and
  bulk commands.
- Add a complete task editor/inspector, contextual Quick Add with natural
  language preview, saved-view editor and lifecycle, and status Kanban with
  pointer and keyboard moves.
- Add singleton Pomodoro and Time Report windows backed by live server APIs.
- Support fixed, entity, task, saved-view, Quick Add, Settings, Pomodoro, Time
  Report, and Kanban `tasknotes://` activation routes.
- Persist window/navigation/inspector/hotkey preferences. Keep the URL in local
  settings and the bearer token only in Credential Locker.
- Centralize stable automation identifiers and accessible names for every
  interactive control, page, row, editor field, and live status announcement.

### Real-server E2E

- Extract the existing iOS server, temporary-vault, chaos-proxy, Markdown
  assertion, artifact, and cleanup support into a private Bun workspace package
  consumed by both platform harnesses.
- Add a Windows-only .NET 10 MSTest UI Automation project. UIA patterns are the
  default interaction path; keyboard and pointer injection are reserved for
  accelerators, hotkeys, and drag/drop.
- Build an E2E-only package identity, Credential Locker resource, application
  data container, and reset/diagnostic activation contract. The contract is
  absent from Release and never persists a secret in a fixture or artifact.
- Build and register once, then run scenarios serially with a fresh vault,
  local server, proxy, application state, and process per scenario.
- Use bounded condition waits rather than correctness sleeps. On failure retain
  JUnit, app/server/proxy logs, UIA tree, screenshot, process state, and vault.
- Cover configuration/authentication, cached startup, every navigation and
  deep-link destination, CRUD, recurrence, completion undo, bulk actions,
  search/filter/sort/group, completed tasks, saved views, Kanban, timing,
  Pomodoro, offline replay, parked changes, global Quick Add, packaged launch,
  persistence, keyboard-only use, accessibility properties, DPI, themes, and
  high contrast.

## Verification

- Core request tests pin timing/Pomodoro URLs, methods, bodies, query escaping,
  response schemas, statuses, cancellation, and failures.
- Binding checks pin deterministic generation, checksums, callback construction,
  and record order.
- Portable tests cover serialization, query projections, saved-view storage,
  completion undo, timing state, cancellation, token separation, corrupt
  storage, and every view-model state.
- The shared E2E support keeps the existing iOS flows green.
- `windows:verify` runs preflight, locked restore, binding drift, release build,
  unit/integration tests, parity check, UI E2E, signed packaging, install, cold
  launch, and restart persistence.
- The future Windows Buildkite lane requires an unlocked interactive Windows 11
  x64 worker, pinned toolchains, trusted development certificate, locked Bun
  install, generation, JUnit upload, and failure-artifact upload.
- Focused Turbo checks and the complete `bun run verify` finish the repository
  integration gate.

## Platform boundaries

Windows Widgets, notifications, Store publication, ARM64, voice integration,
Apple widgets, Live Activities, Siri/App Intents, haptics, and Apple lifecycle
behavior are outside this plan. The TaskNotes server contract and Markdown
format remain unchanged.

## Remaining

- [x] Complete the parity manifest and shared E2E support.
- [x] Complete the Rust/UniFFI timing and Pomodoro surface.
- [x] Complete the portable Windows store and feature tests.
- [x] Complete the native Windows feature surface and integrations.
- [ ] Complete the real-server UI Automation suite and all verification gates.

## Comment Log

- 2026-08-11: Approved as the successor to the initial Windows Today-slice plan.
- 2026-08-11: Implemented the parity contract, shared real-server harness,
  timing/Pomodoro bindings, portable store, native shell, and UI Automation
  project. Full packaged execution remains part of the final Windows gate.
