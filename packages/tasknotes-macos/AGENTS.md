# Facet Apple host constraints

This package owns the native macOS application (`TaskNotes`) and the shared Swift
libraries (`TaskNotesKit` and `TaskNotesFacetUI`) consumed by both macOS and iOS.
Load `tasknotes-development` for cross-package workflows.

## Architecture boundaries

- `TaskNotesKit` is `nonisolated` by default and **must not** import `SwiftUI`,
  `AppKit`, `Cocoa`, or `UIKit`. It owns generated protocol models
  (`Sources/TaskNotesKit/Generated/Protocol.swift`), `FacetSQLiteDatabase`
  (`import SQLite3` actor), `FacetLocalStore`, `FacetAPIClient` (`/api/v1/sync`),
  `KeychainTokenStore`, `FacetQuickCaptureParser`, `FacetRecurrenceCodec`,
  `FacetFilterQueryEvaluator`, `MarkdownBody`, and presentation/feedback schema
  validation.
- Do not hand-edit `Sources/TaskNotesKit/Generated/Protocol.swift`; regenerate it
  from `packages/facet-protocol` via `bun run generate`.
- `TaskNotesFacetUI` and `TaskNotesMac` are `MainActor`-isolated by default and
  own shared SwiftUI Todoist-style workspaces, boards, inspectors, capture sheets,
  and sensory feedback.
- SQLite databases (`Application Support/Facet/facet-sync.sqlite3`) live strictly
  inside the app-private container — **never** inside the iOS App Group
  `group.com.tasksforobsidian` (to avoid `0xdead10cc` background lock kills).
  The App Group holds only bounded widget projection JSON and Siri intent capture
  files.
- Server bearer tokens live in Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`),
  never in `UserDefaults`, SQLite, App Groups, logs, or snapshots.

## Swift 6.2 & SwiftLint invariants

- All targets compile under Swift 6.2 with `.strictMemorySafety()`,
  `.treatAllWarnings(as: .error)`, `ExistentialAny`, `MemberImportVisibility`,
  `InternalImportsByDefault`, `NonisolatedNonsendingByDefault`, and
  `InferIsolatedConformances`.
- `try?`, `print(`, `default:` in `switch` statements over closed/value types,
  `Bool?` / `[T]?` declarations, `unsafeBitCast`, `unsafeDowncast`,
  `@unchecked Sendable`, `assumingMemoryBound`, and `swiftlint:disable` /
  `swift-format-ignore` directives are banned by `.swiftlint.yml` and
  `ci/no-suppressions.sh`.
- Keep `Sources/TaskNotesFacetUI/Presentation/FacetWindowCloseGuard.swift` aligned
  with `.swiftlint-appkit-baseline.json` (`scripts/check-appkit-baseline.ts`).

## Verification and release

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test
bun run lint
bun run mac:format:check
bun run mac:smoke
```

Snapshot tests render offscreen at fixed size, 2x scale, fixed `ViewerCalendar`,
and both `.light` and `.dark` appearances without capturing the host screen.
App Store and Developer ID lanes remain distinct operator-authorized products.
