---
id: reference-completed-2026-05-12-renovate-dashboard-residual-updates
type: reference
status: complete
board: false
---

# Renovate Dashboard Residual Dependency Updates

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
