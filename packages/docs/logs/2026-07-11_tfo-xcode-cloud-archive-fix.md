# Tasks for Obsidian — Xcode Cloud Archive failure (build #49)

## Status

Complete

## Summary

Xcode Cloud "Archive - iOS" for TasksForObsidian (build #49, 2026-07-11) failed with
`Command PhaseScriptExecution failed with a nonzero exit code`. Root-caused to a Metro
module-resolution failure in the Release JS bundle, fixed the CI bootstrap script, and
shipped tooling + docs so future cloud-build failures are debuggable locally.

## Root cause

The failing phase was **"Bundle React Native code and images"** (Metro, runs only in
Release/Archive). The bundle failed with:

```
UnableToResolveError: Unable to resolve module @tasknotes/model
  from packages/tasknotes-types/src/v2.ts
```

- `tasks-for-obsidian` depends on `tasknotes-types` via `file:../tasknotes-types` and
  consumes it **from source** (`main`/`exports` → `src/*.ts`).
- `tasknotes-types/src/v2.ts` does `export * from "@tasknotes/model"`. `@tasknotes/model@0.2.1`
  is a real public npm package, a dependency **of tasknotes-types**, added in #1391 (2026-07-09).
- The app moved onto the v2 contract in #1394, so the bundle now imports `tasknotes-types/v2`
  → pulls `@tasknotes/model` into the graph.
- Bun does **not** install a `file:` directory dependency's transitive deps into the consumer.
  Metro resolves `@tasknotes/model` from `packages/tasknotes-types/node_modules`, but
  `ci_post_clone.sh` only ran `bun install` in the app, never in `tasknotes-types` → that
  `node_modules` was empty on the worker → resolution failed.
- Unrelated to #1438 (the commit named in the failure email); that was just the next build.

## Fix

`packages/tasks-for-obsidian/ios/ci_scripts/ci_post_clone.sh` now runs
`bun install --frozen-lockfile --linker hoisted` in `packages/tasknotes-types` before the app
install, populating its `node_modules`. Verified end-to-end by running the exact Release Metro
bundle command locally — it now produces a 12 MB `main.jsbundle` (previously threw
`UnableToResolveError`). `tasknotes-types/bun.lock` already contains `@tasknotes/model`, so
`--frozen-lockfile` works on CI.

## Tooling + docs shipped

- `packages/tasks-for-obsidian/scripts/xcode-cloud-logs.ts` — App Store Connect API log puller
  (`runs`, `logs <id|latest-failed> [outDir]`). Mints an ES256 JWT, walks
  ciProducts → buildRuns → actions → artifacts, downloads log bundles. Reads creds from the
  1Password item **"App Store Connect API — Xcode Cloud"** (Personal vault: `credential`,
  `key id`, `issuer id`) — no baked secrets. Typecheck + eslint clean.
- `packages/tasks-for-obsidian/.gitignore` — ignore `xcode-cloud-logs/`.
- Skill `xcode-cloud-debug` (`packages/dotfiles/dot_agents/skills/xcode-cloud-debug/SKILL.md`) —
  how to pull logs, read the bundle, reproduce the Release bundle locally, the `@tasknotes/model`
  failure, and the 1Password item. Deployed live to `~/.agents/skills/`.
- `packages/tasks-for-obsidian/AGENTS.md` — Xcode Cloud section documents the dual-install
  requirement and the log-pulling script.

## Guard against recurrence (added after the fix)

A CI guard that reproduces the exact failure pre-merge, so this class of bug can't
reach Xcode Cloud again:

- `packages/tasks-for-obsidian/scripts/check-release-bundle.ts` + `check:release-bundle`
  script — runs the **Release Metro bundle** (`--dev false`, the Archive path) under
  `bun` (pure JS, no macOS), asserts a full (>1 MB) bundle. Proven both ways: passes with
  deps present (12 MB bundle), fails with `UnableToResolveError` + actionable message when
  `tasknotes-types/node_modules` is missing the dep.
- `.dagger/src/quality.ts` `tasksForObsidianIosNativeDepsHelper` — now installs
  `tasknotes-types` + the app (mirrors `ci_post_clone.sh`) and runs both
  `check:ios-native-deps` and `check:release-bundle`.
- `scripts/ci/src/steps/per-package.ts` — step relabeled `:iphone: iOS Native Deps + Release
Bundle`, timeout 10→15 min. Existing tests key off the step `key` (unchanged); all 313
  CI-generator tests pass.

Why a real bundle rather than a static check: the bundle is the independent oracle — it's
exactly what fails on the worker, and it catches **any** future unresolvable source-only
import, not just `@tasknotes/model`.

## 1Password

Created item **"App Store Connect API — Xcode Cloud"** in the **Personal** vault
(id `koxy4ucfwt75pwdyss67kopmsq`), category API Credential:
`credential` = the `.p8` (ES256 Team Key), `key id` = `254JA3KTG2`,
`issuer id` = `cfbda24f-ff28-47fa-a9de-c4c272abd81c`. Verified the stored key is
byte-identical to the downloaded `.p8`.

## Session Log — 2026-07-11

### Done

- Root-caused Xcode Cloud build #49 Archive failure to Metro `@tasknotes/model` resolution.
- Fixed `ios/ci_scripts/ci_post_clone.sh` to install `tasknotes-types` deps (shellcheck clean).
- Verified the fix: exact Release Metro bundle command builds a 12 MB `main.jsbundle`.
- Shipped `scripts/xcode-cloud-logs.ts` (typecheck + eslint clean; tested `runs` + `logs latest-failed`).
- Added `xcode-cloud-debug` skill (+ live deploy) and updated `AGENTS.md`; `.gitignore` for log output.
- Stored the App Store Connect API key in 1Password (Personal); deleted the plaintext `.p8` from `~/Downloads`.
- Built the recurrence guard: `check:release-bundle` (real Release Metro bundle) wired into the
  `:iphone: iOS Native Deps + Release Bundle` Dagger/Buildkite step. Verified pass + fail; 313 CI-gen tests pass.

### Remaining

- Merge the PR, then re-run the Xcode Cloud workflow (or push to trigger it) to confirm a green Archive + TestFlight upload.

### Caveats

- The lockfiles were **not** the fix — `bun install` in the app does not pull a `file:` dep's
  transitive deps; the tasknotes-types `node_modules` install is what matters. Don't "fix" this by
  regenerating the app lockfile.
- Any future source-only `file:` dep the app's bundle imports needs installing in **both**
  `ci_post_clone.sh` and the Dagger helper. This is no longer silent: the `check:release-bundle`
  guard turns CI red until both are wired. The bundle runs under `bun` in the Linux CI container
  (verified locally); if a future RN/Metro version stops running under bun, the guard step would
  need `node` added to the Dagger base.
