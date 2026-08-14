---
id: plan-2026-08-11-tasknotes-windows-quality-hardening
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# TaskNotes Windows Quality Hardening

Harden every Windows client layer without changing the TaskNotes server
contract or moving domain behavior out of the shared Rust core.

## Success criteria

- Handwritten Rust, C#, XAML, and TypeScript are covered by explicit strict
  analysis and formatting gates.
- The application follows
  `WinUI -> Presentation -> TaskNotesStore -> EngineRunner -> UniFFI -> Rust`.
- Portable unit and real-server integration tests run on Linux, while WinUI,
  MSIX, accessibility, and UI Automation remain explicit Windows gates.
- Feature-parity claims are backed by runtime assertion evidence rather than
  scenario names.
- Coverage cannot regress, and critical persistence, transport, serialization,
  credential, undo, cleanup, and redaction branches are completely exercised.

## Architecture

- Add a portable `TaskNotes.Windows.Presentation` project built around focused
  view models and portable service contracts.
- Keep Windows Runtime, Credential Locker, activation, hotkeys, window state,
  and XAML in the App project.
- Split the store into focused collaborators while retaining one public async
  facade and immutable state snapshots.
- Replace detached synchronization drains with one owned, bounded, coalescing
  pump that is awaited during shutdown.
- Add allow-listed structured local diagnostics. Never log credentials,
  authorization headers, task content, request bodies, or Markdown.

## Static analysis

- Use `latest-recommended` .NET analysis with warnings as errors and add the
  Microsoft threading analyzers. Scope CA2007 to non-UI Host code.
- Pin CSharpier and XAML Styler as local tools. Generated bindings stay outside
  handwritten-code analyzers and formatters.
- Extend repository suppression, ignored-test, placeholder-assertion,
  duplication, and dependency-boundary checks to C#.
- Preserve rustfmt, strict Clippy, cargo-deny, binding drift, strict TypeScript,
  ESLint, locked restores, and dependency auditing.

## Tests and coverage

- Separate portable unit, real-server integration, WinUI unit-app, and packaged
  UI Automation test responsibilities.
- Use MSTest.Sdk and Microsoft Testing Platform with cooperative timeouts,
  parallel randomized unit tests, deterministic replay seeds, JUnit/TRX output,
  crash or hang diagnostics, and Cobertura coverage.
- Test engine lifecycle, every store mutation and projection, atomic storage,
  exact HTTP behavior, view-model state, activation, settings, credentials,
  hotkeys, diagnostics, and E2E orchestration failure paths.
- Require runtime assertion IDs for every parity feature and preserve complete
  failure artifacts.
- Enforce 90% changed-line coverage for Host, Presentation, Rust client/FFI,
  and Bun orchestration, and 80% for handwritten Windows adapters. Overall
  baselines can only hold or increase.
- Run Stryker.NET and cargo-mutants as explicit deep-quality jobs with an 80%
  mutation-score floor and no surviving critical-invariant mutants.

## Verification and CI readiness

- Keep Linux Buildkite explicit about the portable project set and prepare,
  without activating, the future interactive Windows worker lane.
- `windows:verify` remains the complete packaged Windows gate. It must not skip
  missing visual profiles, installation, signature, cold-launch, restart,
  accessibility, or UI Automation checks.
- Aggregate real 100% and 200% scale runs in light, dark, and high-contrast
  Windows sessions; fail when a session does not match its declared profile.
- Run focused Turbo checks, both available E2E harnesses, `windows:verify`, and
  the complete repository verification before completion.

## Remaining

- [ ] Trust the public E2E certificate in `LocalMachine\\TrustedPeople`, then
      execute packaged E2E and all six real Windows visual profiles.
- [ ] Complete `windows:verify` and repository-wide verification after the
      privileged certificate prerequisite is satisfied.

## Comment log

- 2026-08-11: Approved for implementation with a full MVVM extraction, a
  risk-based coverage ratchet, and a prepared but inactive Windows Buildkite
  lane.
- 2026-08-11: Added the portable Presentation project, owned background pump,
  strict C# and XAML gates, MTP test split, runtime parity evidence, coverage
  and mutation ratchets, structured diagnostics, and the inactive Windows
  Buildkite contract.
- 2026-08-11: Strict release build, formatting, analyzers, architecture checks,
  duplication checks, 115 managed tests (101 unit, five real-server
  integration, and nine WinUI), coverage ratchets, parity contract, and signed
  release MSIX packaging pass locally. Full Windows line coverage is 90.3% for
  Host, 97.5% for Presentation, and 92.7% for handwritten Windows adapters;
  portable Host and Presentation coverage is 90.2% and 96.3%, respectively.
- 2026-08-11: Strengthened E2E evidence so every assertion records a proof kind
  and concrete observation and is validated exactly by the Bun runner. Expanded
  real-server, Markdown, UIA, accessibility, hotkey-collision, and persistence
  assertions, and extracted core-backed projections into a focused Host
  collaborator.
- 2026-08-11: Packaged E2E stops before installation because the AppX service
  does not trust the development certificate in
  `LocalMachine\\TrustedPeople`. This is an intentional fail-fast machine
  prerequisite; no test or package gate was skipped or weakened.
- 2026-08-11: Extracted task projection, saved-view, completion-undo, hotkey,
  task-list, Quick Add, editor, board, and settings responsibilities from the
  original shell/store orchestration. `MainWindow.xaml` is now 178 lines and
  delegates its major surfaces to compiled WinUI views backed by portable view
  models. Consecutive generation produced identical hashes for all seven
  committed binding artifacts.
- 2026-08-11: Measured shared E2E orchestration at 97.68% line coverage and
  98.18% function coverage. The Rust core/client/FFI suite is at 95.1% overall
  line coverage and 95.3% changed-line coverage for the client/FFI boundary.
