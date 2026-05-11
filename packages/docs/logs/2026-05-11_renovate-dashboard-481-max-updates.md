# Renovate Dashboard #481 Max Update Sweep

## Status

Complete

## Context

User asked to work in a new dissociated clone, update as much of Renovate dashboard #481 as possible, and validate locally. This session uses `/Users/jerred/git/monorepo-renovate-481-max` on branch `chore/renovate-481-max`.

## Session Log — 2026-05-11

### Done

- Created dissociated clone at `/Users/jerred/git/monorepo-renovate-481-max`.
- Created branch `chore/renovate-481-max` from fresh `origin/main`.
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
- Android validation installed NDK `26.1.10909125` into `/Users/jerred/Library/Android/sdk` because the updated Gradle project requested it.
- Some validators still print non-fatal warnings/hints: SwiftLint renamed-rule warnings, Astro inline-script hints, Gradle deprecation warnings, and KSP warnings under Kotlin 2.3.20.
