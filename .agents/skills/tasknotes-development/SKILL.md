---
name: tasknotes-development
description: Develop or verify TaskNotes (Facet) across the shared wire protocol, PostgreSQL sync server, macOS, iOS, and Windows native clients. Use for any packages/facet-protocol, packages/tasknotes-*, or packages/tasks-for-obsidian work.
---

# TaskNotes development

Facet is a native cross-platform task system synchronized through `/api/v1/sync`.
Read the nearest package `AGENTS.md` and README, then identify which contract
layer owns the change.

- `packages/facet-protocol` is the single source of truth for wire DTOs, the
  `SyncCommand` variants, and shared design tokens (`presentation/`). Regenerate
  Swift, TypeScript, and C# protocol files with `bun run --cwd packages/facet-protocol generate`
  and commit every generated diff; never hand-edit generated bindings.
- `packages/tasknotes-server` owns PostgreSQL persistence (`PrismaFacetStore`),
  monotonic `sync_seq` delta watermarks, `SyncCommandLog` UUID idempotency,
  server-side RRULE recurrence advancement, and `/api/v1/*` REST routes.
- `packages/tasknotes-macos` (`TaskNotesKit` + `TaskNotesFacetUI`) owns the
  native Swift SQLite sync engine, Keychain token storage, and shared SwiftUI
  presentation consumed by both macOS and `packages/tasks-for-obsidian` (iOS +
  WidgetKit).
- `packages/tasknotes-windows` owns the WinUI 3 client over `Microsoft.Data.Sqlite`,
  `FacetProtocol.cs`, and Windows Credential Locker, keeping `Host` and
  `Presentation` free of `Microsoft.UI`/`Windows.UI` references so portable
  tests and coverage ratchets run on non-Windows hosts.

Use focused verification per platform:

- Run `tasknotes-server` unit/sync suites and live-server integration suites in
  `tasknotes-macos` (`FacetLiveServerSyncTests`) and `tasknotes-windows`
  (`ServerIntegrationTests`) whenever wire or sync semantics change.
- Run macOS accessibility/UI flows for affected Apple UI behavior, and XcodeGen +
  native dependency checks (`check:ios-native-deps`) for iOS archive changes.
- Use portable Windows verification (`build`, `lint`, `test`,
  `coverage:portable:check`) on non-Windows hosts and `bun run windows:verify`
  on Windows for full WinUI runtime and MSIX/standalone packaging claims.

Never soften an accessibility assertion, skip a coverage or lint gate, edit
generated protocol code, or claim runtime parity without matching verification.
