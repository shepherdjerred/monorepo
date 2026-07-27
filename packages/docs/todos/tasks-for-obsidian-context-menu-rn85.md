---
id: tasks-for-obsidian-context-menu-rn85
type: todo
status: planned
board: true
verification: agent
disposition: deferred
origin: packages/docs/archive/completed/2026-07-03_tasknotes-first-in-class.md
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

## Remaining

- [ ] At the next `zeego` / `react-native-ios-context-menu` /
      `react-native-ios-utilities` release, verify RN compatibility and either
      upgrade and remove both local workarounds, or document that the upstream
      blocker remains.
- [ ] If no compatible release exists when the patch next conflicts, replace
      the two Zeego context-menu call sites and remove the dependency chain.

## Context

Found 2026-07-03 while getting the Maestro e2e harness's fresh-checkout
build working (plan P0). The committed iOS native state had drifted ~2 RN
minor versions behind package.json (Renovate bumps without local builds);
the same drift also broke fresh `pod install` (stale Sentry pin — fixed) and
would have failed the next Xcode Cloud build.

## Comment Log

### 2026-07-27 — in-progress board audit

- Deferred intentionally: the committed patch is a working compatibility fix,
  and there is no current app failure that warrants replacing the menu stack.
