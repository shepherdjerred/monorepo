# TaskNotes macOS constraints

This is the native SwiftUI client over the shared Rust core. `README.md` owns
the target layout, commands, and release reference. Load `tasknotes-development`
for cross-package workflow.

## Boundaries

- `TaskNotesUniFFI` is generated binding glue. `TaskNotesKit` is portable and
  has no SwiftUI/AppKit imports. `TaskNotesMac` owns UI and is MainActor-isolated.
- Do not edit generated Swift. Build the XCFramework from `tasknotes-core`
  before compiling, and commit every regenerated binding diff.
- Every `FfiSyncEngine` call goes through `EngineBox`'s serial queue. The Rust
  engine holds one mutex for a call; never block the main actor on dispatch,
  snapshot, drain, or dead-letter work.
- Core HTTP and storage are host traits. App storage uses the sandbox container;
  vault access needs a user-selected security-scoped bookmark.
- `WireBridge.swift` is temporary. Do not grow a Swift-owned wire model that
  duplicates the Rust core.

## Swift and UI

- Authored code uses strict Swift 6, SwiftLint, and swift-format without source
  suppressions or unsafe flags. Generated code keeps its measured exemptions.
- Exhaustive switches have no `default`; `@unknown default` is allowed.
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

Changed TaskNotes paths also have a hard serial macOS Buildkite gate. Preserve
accessibility assertions; a compile-only result is not app verification.

Releases use the operator-run Developer ID/notarization lane. Do not add an App
Store path or updater without a separately approved distribution design. Keep
certificates, team IDs, notarization credentials, and release output untracked.
