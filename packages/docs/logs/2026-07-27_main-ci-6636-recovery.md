---
id: log-main-ci-6636-recovery-2026-07-27
type: log
status: in-progress
board: false
---

# Main CI Build 6636 Recovery

## Objective

Restore a fully passing Buildkite pipeline on `main` without weakening quality or release-safety gates.

## Evidence

- Initial `origin/main`: `eeb93a8edfc47185712de22e98535f19a284e4ad` (`chore: bump pending image versions (#1738)`).
- Buildkite #6636 passed repo-wide `verify` and its main-specific Playwright lane; `deploy sites` is the first failed hard step.

## Session Log — 2026-07-27

### Done

- Began current-main Buildkite triage and preserved unrelated main-checkout changes.
- Created isolated worktree `fix/main-ci-6636` for the repair.
- Isolated Buildkite #6636's first hard failure to the Scout archive build:
  its filtered dependency install omitted `@shepherdjerred/glitter-context`,
  leaving its gitignored `dist` entrypoint unavailable to Vite.
- Added the shared context as an explicit selected workspace and built it before
  the Scout archive. The selector and pipeline validator now enforce that
  prerequisite.
- Passed the static pipeline validator, CI selector regression suite, exact
  Scout prerequisite build sequence, and `bun run verify -- --affected`
  (21/21 tasks).

### Remaining

- Push the verified repair to `main` as authorized and follow the resulting
  Buildkite build through all release and deploy lanes.

### Caveats

- All implementation is isolated in this worktree.
