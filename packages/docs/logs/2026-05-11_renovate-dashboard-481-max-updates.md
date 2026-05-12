# Renovate Dashboard #481 Max Update Sweep

## Status

Complete

## Context

User asked to work in a new dissociated clone, update as much of Renovate dashboard #481 as possible, and validate locally. This session uses `/Users/jerred/git/monorepo-renovate-481-max` on branch `chore/renovate-481-max`.

## Session Log — 2026-05-11

### Done

- Created dissociated clone at `/Users/jerred/git/monorepo-renovate-481-max`.
- Created branch `chore/renovate-481-max` from fresh `origin/main`.
- Opened draft PR #773: <https://github.com/shepherdjerred/monorepo/pull/773>.
- Pushed commit `a7ee0bdbc` (`chore(root): update renovate dashboard 481 dependencies`).
- Fixed the Buildkite PR pickup failure by deepening shallow `origin/main` history when the CI pipeline generator cannot compute a merge base.
- Applied the Renovate dashboard sweep across Bun/npm package manifests and locks, Rust crates, Maven deps, Swift packages, Go modules, Terraform/OpenTofu providers, tool pins, Gradle wrapper, and Docker/image digests.
- Migrated Prisma 7 generation/runtime setup for Birmel and Scout backend, including Prisma config files and libSQL adapters.
- Updated Zod 4 call sites and replaced the DPP config loader's `zconf` dependency with TOML parsing plus explicit Zod validation.
- Added a React Native Gradle plugin patch so Gradle 9.5 can build with the Foojay resolver and Kotlin metadata versions used by the new wrapper.
- Refreshed sjer.red Playwright snapshots after the build/test path changed and verified the snapshot update.
- Cleaned generated build/test output directories after validation.

### Remaining

- No requested local validation remains failing.
- `python:3.14.5-slim` was not available in the registry during this sweep, so that Docker image pin was left unchanged.
- `poc/sentinel/web` still has no refreshed standalone lock because it declares a `workspace:*` dependency without being installable as an isolated workspace root.

### Caveats

- Validation passed: `bun run scripts/setup.ts`, `bun run lint`, `bun run typecheck`, `bun run test`, Clauderon `cargo check`, Scout desktop `cargo check`, Castle Casters `mvn test`, ASUSWRT provider `go test ./...`, all three updated Tofu `validate` runs, and Android `./gradlew help` with the local Android SDK exported.
- CI pickup fix validation passed: `cd scripts/ci && bun test src/__tests__/change-detection.test.ts`, `cd scripts/ci && bun run typecheck`, `cd scripts/ci && bun test`, and local PR pipeline generation with `BUILDKITE_PULL_REQUEST=773`.
- Android validation installed NDK `26.1.10909125` into `/Users/jerred/Library/Android/sdk` because the updated Gradle project requested it.
- Some validators still print non-fatal warnings/hints: SwiftLint renamed-rule warnings, Astro inline-script hints, Gradle deprecation warnings, and KSP warnings under Kotlin 2.3.20.

## Session Log — 2026-05-11 (CI failure follow-up)

### Done

- Diagnosed PR #773 Buildkite build #2326 hard failures: lint for `discord-plays-pokemon` + `scout-for-lol` and typecheck for `tasks-for-obsidian` (`knip`/`trivy` were soft).
- Root cause for lint: `@shepherdjerred/eslint-config@0.3.0` added `@eslint/compat` as a dep (used by `src/configs/react-native.ts`), but every consumer's `bun.lock` had cached the pre-bump dep list, so Bun's isolated install layout never placed `@eslint/compat` next to the eslint-config source. ESLint 10 surfaced this as `Oops! ESLint: 10.3.0 ResolveMessage {}` because `src/index.ts` re-exports `reactNativeConfig` eagerly.
- Refreshed file: dep entries with targeted `bun update --filter '*' @shepherdjerred/eslint-config` (and `tasknotes-types`, plus `astro-opengraph-images`/`webring` for `sjer.red`) in 20 consumer lockfiles. No transitive bumps beyond what the file: sources required.
- Root cause for tasks-for-obsidian typecheck: `tasknotes-types` bumped to `zod ^4.4.3` but `tasks-for-obsidian/bun.lock` still pinned its `tasknotes-types/zod` to `^4.3.6`. The two zod copies were structurally different to TS, so `z.array(InlineTimeEntrySchema)` rejected the imported schemas. `bun update tasknotes-types` aligned both copies on `zod@4.4.3`.
- Fixed lint regression in `packages/scout-for-lol/packages/frontend/src/components/Button.astro` — `no-useless-assignment` correctly flagged the initial `let sizeClasses = ""` because every switch branch including `default` writes to it. Declared as `let sizeClasses: string` instead.
- Verified locally with Dagger: `lint`/`typecheck` for `discord-plays-pokemon`, `scout-for-lol`, and `tasks-for-obsidian` all green.
- Committed as `4014a1add` and pushed to `chore/renovate-481-max`.

### Remaining

- Awaiting CI rerun on the new commit (Buildkite picks up automatically on push).
- The pre-existing soft-failures (`knip`, `trivy`) were left as-is per project convention; they do not block the PR.

### Caveats

- Bun's isolated-install layout silently skips dep-list refresh for `file:` deps when the consumer lockfile is satisfiable; the only way to surface the new dep was `bun update <file-dep>`. Worth keeping in mind for future cross-workspace dep additions.
