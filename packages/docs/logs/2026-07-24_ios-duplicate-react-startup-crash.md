---
id: log-2026-07-24-ios-duplicate-react-startup-crash
type: log
status: complete
board: false
---

# iOS Release startup crash — duplicate React in the Metro bundle

## Symptom

TestFlight build 1.0 (#62) crashed immediately on launch (~370 ms) on a real
device (iPhone 17 Pro, iOS 27). The native `.crash` showed a fatal JS exception
routed through `RCTExceptionsManager` → `RCTFatal` → `abort`. Bugsink (project 10,
`TaskNotes App`) had **zero events**: the app boot-loops, so Sentry's on-disk
crash report never flushes.

## Reproduction

Bugsink being empty, reproduced locally with a **Release** simulator build
(the dev server hides the bug — see below). Built via `xcodebuild -configuration
Release` after replicating Xcode Cloud's hoisted install
(`bun install --linker hoisted`), installed on the sim, and launched with
`simctl launch --console-pty`, which surfaced the real JS error:

```
TypeError: Cannot read property 'useEffect' of null
    at App (main.jsbundle)
```

## Root cause

Two copies of React in the bundle:

- `packages/tasks-for-obsidian/node_modules/react` → **19.2.3** (the app's exact
  pin, required by React Native 0.85.3, whose bundled `react-native-renderer` is
  19.2.3)
- root `node_modules/react` → **19.2.7** (pulled by another workspace package that
  wants `^19.2.7`, hoisted to the root)

React Native's dev server resolves a single copy, but **Release/Archive uses
Bun's hoisted linker**, so both copies are physically present and Metro
(`nodeModulesPaths = [app, monorepoRoot]`) bundles both. Two Reacts → the internal
hooks dispatcher is null → `Cannot read property 'useEffect' of null` at the first
hook. It went unseen because earlier builds never reached a device (all blocked on
"Missing Compliance"; see [log-2026-07-24-testflight-auto-compliance]).

Bumping the app to 19.2.7 is **not** the fix — it then fails with
`Incompatible React versions: react 19.2.7 vs react-native-renderer 19.2.3`,
because RN 0.85.3 hard-requires React 19.2.3.

## Fix

`packages/tasks-for-obsidian/metro.config.js`: add a `resolver.resolveRequest`
that forces `react` (and its subpaths) to resolve from **this package's**
`node_modules` (the 19.2.3 copy RN needs), so exactly one React lands in the
bundle regardless of what's hoisted at the root. Package versions are unchanged —
the app's `react@19.2.3` pin is correct.

## Verification

- Release simulator build **before** fix: crashes at launch with the duplicate-React
  error.
- Release simulator build **after** fix: boots and renders the Tasks/Inbox UI,
  stays alive (screenshot attached to the PR). `scheduler` and `react-native` were
  already single copies, so only `react` needed deduping.
- The `check:release-bundle` guard does not catch this (imports resolve fine; the
  duplication is a runtime identity issue, not an unresolved import).
