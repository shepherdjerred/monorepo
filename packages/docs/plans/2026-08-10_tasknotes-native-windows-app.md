---
id: plan-2026-08-10-tasknotes-native-windows-app
type: plan
status: in-progress
board: true
verification: human
disposition: active
---

# TaskNotes Native Windows App

Canonical implementation plan for the native Windows client.

The initial Today slice is now the foundation for the broader
[feature-parity and real-server E2E plan](2026-08-11_tasknotes-windows-feature-parity-and-e2e.md).
Its maintainability and verification follow the
[Windows quality-hardening plan](2026-08-11_tasknotes-windows-quality-hardening.md).

## Goal

Create `packages/tasknotes-windows` as a packaged C#/.NET 10 WinUI 3 application backed by the existing Rust/UniFFI core. The first usable slice configures a server, loads cached and live Today tasks, adds tasks, completes or reopens them, and exposes synchronization and parked-change errors.

A fresh Windows 11 x64 environment must be able to follow the documented setup, launch the MSIX app from Visual Studio or the CLI, and exercise the slice against the real TaskNotes server.

## Architecture

The platform boundary is:

```text
WinUI -> TaskNotesStore -> serialized EngineRunner -> generated UniFFI -> Rust core
```

C# owns native presentation and host capabilities. Rust continues to own recurrence, mutations, wire protocol, synchronization, and domain validation.

The solution contains four projects:

- `TaskNotes.Core.Bindings`: committed generated C# bindings only.
- `TaskNotes.Windows.Host`: portable host adapters and serialized engine execution with no WinUI dependency.
- `TaskNotes.Windows.App`: Windows 11 x64 WinUI 3 application packaged as MSIX.
- `TaskNotes.Windows.Tests`: portable host and real-core integration tests.

## Implementation

### Windows toolchain

- Repair or install WinGet, apply Microsoft's WinUI development configuration, enable Developer Mode, install mise, and reopen the terminal.
- Pin .NET SDK 10.0.302 in `.mise.toml` and `global.json`, Windows App SDK 2.3.1, Windows SDK 10.0.26100.0, and C# 14.
- Add a read-only preflight that fails unless Visual Studio's WinUI workload, MSBuild, Developer Mode, the pinned .NET and Rust toolchains, and x64 MSVC support are available.
- Onboard with `mise install`, `bun install --frozen-lockfile`, `bunx turbo run generate`, and the Windows preflight.

### UniFFI compatibility gate

- Install `uniffi-bindgen-cs` tag `v0.11.0+v0.31.0` through mise's Cargo Git backend, never through the shipped Rust dependency graph.
- Generate committed C# bindings under `packages/tasknotes-core/bindings/csharp/` and extend `cargo xtask check-bindings` to detect C# and Swift drift.
- Build the dynamic core, compile the generated C#, validate UniFFI checksums and callback construction, then exercise a pure function and `FfiSyncEngine`.
- Stop if the generator cannot consume the existing UniFFI 0.31.2 metadata. Do not downgrade UniFFI, edit generated code, or add an unreviewed fork.

### Native scaffold and host

- Target `net10.0-windows10.0.26100.0`, minimum Windows 11 build 22000, x64, and single-project packaged MSIX.
- Enable central package management, nullable references, deterministic builds, C# 14, analyzers, warnings as errors, locked restores, and generated-code isolation.
- Copy the explicitly built Rust DLL into app and integration-test runtime outputs; keep native build artifacts ignored.
- Implement atomic file storage, `HttpClient` transport, Credential Locker token storage, local server URL settings, system clock/timezone, cryptographic randomness, cancellation, and idempotent retry timers.
- Serialize every FFI call on one background reader so the UI thread never enters the engine.

### Today vertical slice

- Expose observable Today tasks, pending ids, sync state, parked changes, and user-facing errors through `TaskNotesStore`.
- Implement initialize/reconfigure, refresh, add, set completion, retry/discard parked mutation, and dispose operations.
- Build a Today destination with cached-first tasks, quick add, complete/reopen, pending indicators, refresh, offline state, `Ctrl+N`, and `Ctrl+R`.
- Build Settings with server URL, token, save-and-sync validation, connection state, and parked-change retry/discard.
- Use native controls, semantic colors, keyboard navigation, automation names, and accessible status announcements.

## Verification

- Verify deterministic generation, checksums, callback coverage, and record-order drift detection.
- Test storage corruption and atomicity, token separation, HTTP mapping, cancellation, scheduling, clock/randomness, and serialized engine access.
- Run real-server scenarios for authentication, cached startup, add, complete, reopen, offline recovery, recurrence, and parked changes; assert Markdown output where relevant.
- Test view states for unconfigured, loading, connected, cached-offline, authentication failure, synchronization failure, pending mutation, and parked changes.
- Run portable .NET tests in Linux CI with JUnit reporting. Keep WinUI/MSIX build, install, launch, keyboard, and accessibility checks as a required local Windows gate until a Windows CI worker exists.
- Run focused Turbo tasks, `bun run windows:verify`, and the complete `bun run verify` because CI reporting changes.

## Deferred

- ARM64, server discovery, Store publication and signing, production updates, global quick-add, notifications, deep links, full detail editing, saved views, and Kanban.
- The iOS and macOS clients, server contract, and shared fixture oracles remain unchanged.

## Remaining

- [x] Initialize and verify the Windows development toolchain.
- [x] Pass the C# UniFFI compatibility gate and produce deterministic bindings.
- [x] Scaffold and verify the portable host, tests, and packaged WinUI application.
- [x] Complete the Today and Settings vertical slice.
- [x] Integrate CI reporting and repository documentation.
- [ ] Complete local Windows acceptance and attach PR evidence.

## Comment Log

- 2026-08-10: Approved for implementation with C# and WinUI 3, packaged MSIX, Visual Studio plus CLI workflows, Linux portable verification, and a live read/add/complete Today slice.
- 2026-08-11: Windows preflight, deterministic bindings, focused Turbo, Rust workspace tests and Clippy, `windows:verify`, signed MSIX packaging, and a responding packaged debug launch passed. The 21-test .NET suite includes real open and gated servers, synchronization-error mapping, loading state, credential separation, offline recovery, recurrence, and parked-change persistence. Release-MSIX install trust, keyboard/accessibility inspection, restart persistence, and PR evidence remain for elevated or human acceptance.
- 2026-08-11: The complete `bun run verify` graph was also attempted on Windows. Task-scoped checks pass, but the repository-wide graph is not Windows-clean: macOS/TeX lanes require unavailable `swiftlint` and `xelatex`, while unrelated packages still assume POSIX paths and tools. Documentation validation was made Windows-safe and passes; broader repository portability remains outside this plan.
- 2026-08-11: A UI Automation smoke run against an authenticated local TaskNotes server passed settings save, cached/live startup, add, complete, undo, `Ctrl+N`, `Ctrl+R`, restart persistence, cached-offline behavior, recovery, critical accessible names, and Markdown assertions. Visual inspection caught and fixed stale navigation selection after `Ctrl+N`. The run also exposed a missing Rust DLL in the AppX layout; MSBuild now stages it before packaging and `windows:verify` opens the resulting MSIX to assert the DLL is present. The remaining local acceptance work is trusting and installing the release signing certificate/MSIX and attaching the captured screenshot to a PR.
- 2026-08-11: Release MSIX installation reached Windows deployment but failed with `0x800B0109`: the valid development signing certificate is present in `CurrentUser\My` but not in `LocalMachine\TrustedPeople`, and this agent session is not elevated. Run the documented signing-provision script from an administrator PowerShell before repeating the install check.
