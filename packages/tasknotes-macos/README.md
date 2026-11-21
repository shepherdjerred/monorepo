# tasknotes-macos

**Facet** for macOS — native SwiftUI client backed by local SQLite3 persistence
and `/api/v1/sync` (`packages/tasknotes-server`). Bundle identifier
`red.sjer.tasknotes.mac`, deployment target macOS 15 / iOS 18 (shared libraries).

First-party code is GPL-3.0-only. Native bundles embed the repository
[license text](../../LICENSE) alongside generated third-party notices.

## Architecture

`Package.swift` defines three library products compiled identically by SwiftPM
and Xcode:

- **`TaskNotesKit`** (`nonisolated`, zero UI framework imports):
  - `Generated/Protocol.swift`: generated wire models and `SyncCommand` enum from
    [`packages/facet-protocol`](../facet-protocol).
  - `Client/FacetSQLiteDatabase.swift`: `actor` wrapping Apple's system `SQLite3`
    in WAL mode (`Application Support/Facet/facet-sync.sqlite3`) with atomic
    `BEGIN IMMEDIATE ... COMMIT` persistence for `tasks`, `projects`, `sections`,
    `labels`, `filters`, FIFO `outbox`, and `sync_token`.
  - `Client/FacetLocalStore.swift` & `FacetAPIClient.swift`: optimistic local
    mutations, `""` wire-sentinel clearing for nullable server columns,
    `full_sync` baseline replacement with concurrent outbox replay,
    `temp_id_mapping` ID rewriting across all collections and queued commands,
    `sync_status` error surfacing, and reversible Undo stack. Apple clients request
    tasks, projects, sections, labels, and filters. Upgrading removes cached
    reminders and unsent reminder commands from the Apple device. Reminders
    already synced by any client remain on the server.
  - `Client/FacetQuickCaptureParser.swift`, `FacetRecurrenceCodec.swift`,
    `FacetFilterQueryEvaluator.swift`, & `Detail/MarkdownBody.swift`: pure-Swift
    Todoist-style natural-language capture (`#Project`, `@label`, `p1`–`p4`,
    dates, times, `every ...`), RFC 5545 `RRULE` parsing/advancement, saved
    filter query evaluation, and GFM block parsing.
  - `Host/`: `KeychainTokenStore` (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`),
    `FacetServerConfiguration` (default `https://tasknotes.tailnet-1a49.ts.net`),
    `FacetWidgetProjection`, and
    `FacetIntentQueue`.
- **`TaskNotesFacetUI`** (`@MainActor`):
  - Shared macOS & iOS SwiftUI Todoist workspace (`FacetRootView`,
    `FacetNativeWorkspace`, `FacetMobileWorkspace`). On iPhone, **Inbox**, **Today**,
    **Upcoming**, and **Browse** are persistent tabs. Browse contains projects,
    labels, filters and completed tasks. The Mac sidebar adds keyboard access to
    capture and workspace search. Search reads local tasks and notes, including
    subtasks, with an option to include completed tasks. Task detail opens over
    the current list. At larger widths the editor and properties sit side by side.
- **`TaskNotesMac`** (`@MainActor`):
  - macOS `FacetMacEnvironment`, non-activating floating `QuickAddPanel` bound to
    `⌃⌥⌘Space` (`KeyboardShortcuts`), menu bar commands (`FacetMacCommands`),
    window close/termination flush delegates, and isolated window restoration.

## Commands

```bash
bun run mac:build          # swift build
bun run mac:test           # swift test (TaskNotesKitTests + TaskNotesMacTests)
bun run mac:snapshots      # offscreen Light & Dark PNG snapshots (.build/snapshots/)
bun run lint               # SwiftLint --strict + ci/no-suppressions.sh
bun run mac:format         # xcrun swift-format in place (mac:format:check to verify)
bun run mac:generate       # xcodegen generate → TaskNotes.xcodeproj
bun run mac:app:release    # Release TaskNotes.app build
bun run mac:smoke          # Release launch smoke check (--facet-release-smoke)
bun run mac:e2e            # XCUITest smoke suite
bun run mac:release        # Developer ID export, notarize, staple, assess (--dry-run needs no credentials)
bun run mac:verify         # generate + build + test + lint + format + app + smoke
bun run test               # Vitest suite for scripts/
```

`mac:release` does the Xcode archive and export itself and uses the shared
[`native-release`](../native-release/README.md) helpers for the Developer ID
identity and notary-profile preflight, notarization, stapling and Gatekeeper
assessment.

To regenerate native license notices after changing `Package.resolved`:

```bash
bun scripts/generate-native-notices.ts
bun scripts/generate-native-notices.ts --ios
```
