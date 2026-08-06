---
id: reference-completed-2026-05-16-data-dragon-image-only-pr-suppression
type: reference
status: complete
board: false
---

# Data Dragon Image-Only PR Suppression

## Summary

Keep Scout Data Dragon's current Temporal cadence: cheap version-check refreshes Sunday-Friday and a forced refresh on Saturday. Suppress automated PRs when the updater only changes existing image bytes, and send an email notice for those skipped runs.

## Implementation Plan

- Keep `packages/temporal/src/schedules/register-schedules.ts` unchanged.
- Add typed git-status parsing in `packages/temporal/src/activities/data-dragon.ts`.
- Open PRs for data/config/source changes and for added, removed, renamed, copied, or untracked images.
- Skip PRs for modified existing raster Data Dragon image assets plus modified generated Arena visual snapshots.
- Send Postal email on image-only skips with the mode, current/latest version, changed-file count, and reason.

## Verification

- `cd packages/temporal && bun test src/activities/data-dragon.test.ts`
- `cd packages/temporal && bun run typecheck`
- `cd packages/temporal && bun run lint`
