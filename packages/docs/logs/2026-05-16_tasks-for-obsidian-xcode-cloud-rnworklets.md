---
id: log-2026-05-16-tasks-for-obsidian-xcode-cloud-rnworklets
type: log
status: complete
board: false
---

# TasksForObsidian Xcode Cloud RNWorklets Failure

## Summary

Xcode Cloud build 35 failed during `ios/ci_scripts/ci_post_clone.sh` while running `pod install`.

Root cause:

- `react-native-reanimated@4.3.0` depends on the separate `react-native-worklets` package for its native `RNWorklets` pod.
- `packages/tasks-for-obsidian/bun.lock` already contained `react-native-worklets@0.8.1`, but `packages/tasks-for-obsidian/package.json` did not declare it.
- Xcode Cloud therefore installed Reanimated but did not install the Worklets package into `node_modules`, so CocoaPods could not find `RNWorklets.podspec`.

Fix:

- Added `react-native-worklets` to `packages/tasks-for-obsidian/package.json`.
- Added it to the workspace dependency list in `packages/tasks-for-obsidian/bun.lock`.
- Updated `packages/tasks-for-obsidian/babel.config.js` to use `react-native-worklets/plugin`, matching Reanimated 4 Community CLI docs.

Prevention guard:

- Added `bun run check:ios-native-deps` in `packages/tasks-for-obsidian`.
- The guard verifies a hoisted install, missing native peer dependencies, and missing iOS podspec paths from `react-native config`.
- Added `.buildkite/scripts/tasks-for-obsidian-ios-native-deps.sh` and a hard per-package Buildkite step so this class of failure is caught before Xcode Cloud.

## Session Log - 2026-05-16

### Done

- Diagnosed the Xcode Cloud failure from the pasted logs.
- Confirmed the missing native module by inspecting `package.json`, `bun.lock`, and `babel.config.js`.
- Verified `bun install --frozen-lockfile --linker hoisted` now installs `react-native-worklets@0.8.1`.
- Verified `node_modules/react-native-worklets/RNWorklets.podspec` exists after install.
- Ran `pod install`; it now auto-links `RNWorklets` and gets past the original missing-spec failure.
- Implemented the prevention guard in `packages/tasks-for-obsidian/scripts/check-ios-native-deps.ts`.
- Added focused tests for missing native peers and missing iOS podspecs.
- Added the hard Buildkite per-package step for `tasks-for-obsidian`.
- Verified the package guard, Buildkite wrapper, CI generator tests, generated pipeline step, TasksForObsidian eslint, TasksForObsidian typecheck, and the full TasksForObsidian Bun test suite locally.

### Remaining

- Push the fix and rerun Xcode Cloud build 35 or trigger a new build.

### Caveats

- Local `pod install` stopped later because this sandbox lacks the full Hermes/cmake/network setup needed for the fallback source path. That is after the fixed `RNWorklets` resolution point.
- The TasksForObsidian pre-commit checks require frozen installs in local file dependencies as well as the app package. Running `bun install --frozen-lockfile` in `packages/eslint-config` and `packages/tasknotes-types` populated those ignored local `node_modules` folders and made the package eslint/test/typecheck checks pass.
