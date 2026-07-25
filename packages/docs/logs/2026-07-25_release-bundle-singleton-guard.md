---
id: log-2026-07-25-release-bundle-singleton-guard
type: log
status: complete
board: false
---

# Guard against duplicate singletons in the Release bundle

## Why

The duplicate-React startup crash (build #62, see
[log-2026-07-24-ios-duplicate-react-startup-crash]) passed every existing gate:
imports resolved fine, so `check:release-bundle` was green, and the app only
crashed at runtime on a device. We needed a pre-merge check that catches this
class — two copies of a singleton package (react/react-native/scheduler) in the
Release bundle — before it reaches Xcode Cloud.

## What

`packages/tasks-for-obsidian/scripts/check-release-bundle.ts` now also emits a
Metro sourcemap and asserts each singleton resolves to exactly one on-disk
package root (`findDuplicatePackages`, exported + unit-testable). Two roots for
any of them = a duplicate copy that would crash at launch → the guard exits
non-zero with the offending paths.

Wired into `bun run verify` (fails CI on a duplicate):

- `packages/tasks-for-obsidian/package.json` — new `check:release-bundle` script.
- `packages/tasks-for-obsidian/turbo.json` — `check:release-bundle` task
  (`dependsOn: tasknotes-types#typecheck` for the source coupling, scoped
  `inputs`).
- root `package.json` — added `check:release-bundle` to the `verify` turbo list.

## Verification

- Unit: `findDuplicatePackages` flags a synthetic two-`react` sources list and
  passes a single-copy one; ignores `react-native-gesture-handler` (trailing-slash
  marker).
- Real bundle **with** the metro dedupe fix: `Singleton check OK`.
- Real bundle **without** the dedupe resolver (isolated linker, i.e. CI's mode):
  guard exits non-zero and reports the two `react` copies
  (`.bun/react@19.2.3` vs `.bun/react@19.2.7`) — confirming it catches the #62
  condition under normal CI, no hoisted install needed.
- `turbo run check:release-bundle typecheck lint --filter=tasks-for-obsidian` green.

## Notes

- Stacked on the metro dedupe fix (feature/xcc-react-dedupe) so `verify` is green
  when this lands; on its own it would (correctly) fail against the pre-fix tree.
- Scope: this catches duplicate _singletons_, not arbitrary release-only startup
  crashes. A general net (a launch-smoke Test action in Xcode Cloud) remains a
  separate, larger follow-up.
