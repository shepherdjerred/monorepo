---
id: tasks-for-obsidian-context-menu-rn85
status: active
origin: packages/docs/plans/2026-07-03_tasknotes-first-in-class.md
source_marker: false
---

# tasks-for-obsidian: context-menu dep chain incompatible with RN 0.85 prebuilt core

## What

`zeego` → `react-native-ios-context-menu@3.2.1` → `react-native-ios-utilities@5.2.0`
referenced `RCTRootContentView`, which React Native 0.85 no longer compiles
into React-Core at all. The reference lived in a dead convenience property
(`closestParentReactContentView`, zero callers), so the app carries a bun
patch removing it: `patches/react-native-ios-utilities@5.2.0.patch`.

`react-native-ios-utilities` 5.2.0 (2025-09-28) is the latest release; no
RN 0.85-compatible version exists yet. Two of its pods also misdeclare
deployment targets (worked around in the Podfile post_install: global
<15.0 clamp for Xcode 27, and a 16.0 pin for react-native-ios-context-menu
which uses iOS-16-only API unguarded).

## Done when

Either:

- upstream ships RN 0.85-compatible releases → bump, drop the bun patch and
  the context-menu post_install deployment-target pin, or
- the app replaces zeego's iOS context menus (used in
  `src/components/task/TaskRow.tsx` and `src/components/common/KanbanCard.tsx`)
  with an alternative, and the deps are removed.

## Context

Found 2026-07-03 while getting the Maestro e2e harness's fresh-checkout
build working (plan P0). The committed iOS native state had drifted ~2 RN
minor versions behind package.json (Renovate bumps without local builds);
the same drift also broke fresh `pod install` (stale Sentry pin — fixed) and
would have failed the next Xcode Cloud build.
