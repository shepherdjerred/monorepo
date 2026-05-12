# Renovate Dashboard Residual Dependency Updates

## Status

Complete

## Summary

Apply the Renovate dashboard items still behind `main`, without downgrading
dependencies that are already newer than the requested dashboard target.

## Planned Changes

- Refresh direct Bun package specs and locks for `@typescript-eslint/utils`,
  `playwright`, `react-native-screens`, Claude Code, GitHub MCP server, and
  related tool/image pins.
- Refresh Docker and Helm pins in Dagger, Buildkite, Discord Plays Pokemon, and
  homelab `versions.ts`.
- Update Rust `sentry` and Maven `gson` where the repo is still behind.
- Fix the Talos installer Renovate error by adjusting Renovate config instead
  of writing the base installer digest into the Talos factory image reference.
- Remove the tracked npm lockfile in Birmel; this repo uses Bun exclusively.

## Verification

- Run targeted package installs and lockfile refreshes using Bun.
- Run targeted checks for Birmel, Monarch, React Native packages, Clauderon,
  Castle Casters, homelab cdk8s, Dagger constants, and CI scripts.
- Finish with formatting, `git diff --check`, and a concise session log.

## Session Log — 2026-05-12

### Done

- Updated remaining Renovate dashboard dependency pins across Bun package
  manifests and locks, Dagger/Buildkite tool constants, homelab image/chart
  versions, Docker Compose image digests, Rust `Cargo.lock`, and Maven `pom.xml`.
- Removed the tracked `packages/birmel/package-lock.json` so Birmel follows the
  repo's Bun-only lockfile policy.
- Added ESLint 10 compatibility wrapping for legacy plugin context APIs in
  `packages/eslint-config`, plus the direct `@eslint/compat` dependency needed
  by `packages/clauderon/web` child workspace lint commands.
- Added a Renovate package rule to stop digest pinning for
  `ghcr.io/siderolabs/installer`, whose Talos factory installer references are
  not compatible with the base registry digest pin Renovate tried to apply.
- Verified with targeted package checks, the full Scout package slice, root
  `bun run typecheck`, root `bun run test`, root `bun run lint`, and
  `git diff --check`.
- Rebased the PR branch onto `origin/main` at `6deb0f13e` and resolved conflicts
  in `packages/docs/index.md`,
  `packages/scout-for-lol/packages/backend/prisma/schema.prisma`, and the
  regenerated Scout test template database.
- Folded in the Scout competition recovery changes needed on the current base:
  notification retry columns, rank-history match timestamps, S3 date filtering,
  Prisma 7.8 branded-type generation compatibility, and fixture/test updates.

### Remaining

- None.

### Caveats

- Playwright browser binaries were installed into the local cache so the updated
  Playwright suites could run.
- Root lint and typecheck still print non-failing Astro hints and SwiftLint rule
  rename warnings; both commands exited successfully.
- The repository has `origin/main` but no `origin/master`; the update was applied
  from `origin/main`.
- The dependency branch now also carries the Scout competition recovery work
  needed for the current base to typecheck, test, and lint cleanly.
