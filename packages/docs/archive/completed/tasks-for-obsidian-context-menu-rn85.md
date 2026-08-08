---
id: tasks-for-obsidian-context-menu-rn85
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-07-03_tasknotes-first-in-class.md
source_marker: false
---

# tasks-for-obsidian: context-menu compatibility chain removal

## What

`zeego` pulled `react-native-ios-context-menu` and
`react-native-ios-utilities` into the app. That dependency chain required a Bun
patch for React Native compatibility plus an iOS 16 deployment-target override
in the Podfile.

Task rows, Kanban cards, and the bulk-priority control now use the maintained
`@react-native-menu/menu` path already used by task detail and saved views.
Task and card menus preserve long-press activation and nested actions; bulk
priority remains a tap menu. The replacement supports Android's native popup
menu and iOS's native `UIMenu` without the old compatibility packages.

## Remaining

- [x] Replace every Zeego context/dropdown menu call site.
- [x] Remove `zeego`, `react-native-ios-context-menu`, and
      `react-native-ios-utilities` from the app and Bun lockfile.
- [x] Remove the obsolete Bun patch and Podfile deployment-target workaround.
- [x] Regenerate the CocoaPods lockfile and verify native dependency discovery.

## Evidence

- Source and dependency searches contain no remaining references to the three
  removed packages.
- `pod install` removed `ComputableLayout`, `ContextMenuAuxiliaryPreview`,
  `DGSwiftUtilities`, `react-native-ios-context-menu`, and
  `react-native-ios-utilities`, then completed with the retained native menu
  module autolinked.
- The package typecheck, targeted ESLint, iOS native-dependency check, and
  release bundle pass with the replacement.

## Comment Log

- 2026-07-27: Deferred while the local compatibility patch remained a working
  fix and there was no current app failure.
- 2026-08-07: Closed during the native product-experience pass. The app now has
  one maintained native-menu implementation and no local compatibility patch
  or deployment-target exception for context menus.
