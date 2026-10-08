# Facet Apple host constraints

This package supplies the native macOS app and the reusable SwiftUI/Foundation
host used by iOS. Load `tasknotes-development` for the cross-package workflow.

## Boundaries

- `TaskNotesUniFFI` is generated glue. `TaskNotesKit` has no SwiftUI/AppKit imports;
  `TaskNotesFacetUI` and `TaskNotesMac` own MainActor presentation.
- Do not edit generated Swift. Build the XCFramework from `tasknotes-core`
  before compiling, and commit every regenerated binding diff.
- `FacetEngine` serializes synchronous runtime calls away from UI. Rust owns
  domain/Sync policy and SQLite receipts. Native adapters own Keychain, URLSession
  effects, security-scoped bookmarks, coordinated files and lifecycle.
- Core HTTP and storage are host traits. App storage uses the sandbox container;
  vault access needs a user-selected security-scoped bookmark.
- `URLSessionTransport.swift` carries HTTP method, URL, headers and bytes.
  Do not grow a Swift-owned wire model that duplicates the Rust core.
- Validate shared schemas fully. Preserve arbitrary configured values, unknown
  note properties and Markdown bytes. Never substitute corrupt data.
- Provider writes require proven confinement and durable displaced-byte capture.
  Keep backups until the runtime acknowledges its conflict/journal commit.
- Complete retry identity includes owning profile, timestamp and payload.
  Credentials never enter vault files, App Groups, diagnostics or artifacts.

## Swift and UI

- In binding-importing files, use `CoreTask`/`CoreClock` and
  `_Concurrency.Task` to avoid generated-name collisions.
- Durable failures must be visible and actionable in the UI, not merely parked
  on disk.
- The quick-add window remains a nonactivating `NSPanel` with a stable global
  hotkey and window-level accessibility identifier. Hotkey UI tests require a
  stable Apple Development-signed runner and Accessibility trust.
- Snapshot tests render offscreen at fixed size, scale, time, locale, timezone,
  and both appearances. Do not capture the user's screen.

## Verification and release

```bash
cd ../tasknotes-core && cargo xtask build-xcframework
cd ../tasknotes-macos
bun run mac:verify
bun run mac:e2e
```

Native UI checks require matching artifacts and real standalone vault assertions;
legacy server-backed tests are separate. Preserve accessibility assertions;
a compile-only result is not app verification. The macOS Woodpecker lane is
currently paused; local native checks are not exact-head CI evidence.
App Store and Developer ID lanes are distinct products. Keep signing material
and release artifacts untracked; publication needs explicit owner authorization.
