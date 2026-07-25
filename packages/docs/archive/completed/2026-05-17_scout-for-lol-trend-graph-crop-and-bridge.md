---
id: reference-completed-2026-05-17-scout-for-lol-trend-graph-crop-and-bridge
type: reference
status: complete
board: false
---

# scout-for-lol — fix trend graph empty + gap regions

## Context

The "Best Solo Queue" / `HIGHEST_RANK` line chart (competition leaderboard trend over time) had two visual defects:

1. **Empty left edge** — the x-axis ran from `competition.startDate` to `min(now, competition.endDate)`, but the earliest leaderboard snapshot is often well after the competition's nominal start. Result: a blank gutter on the left where no series has data.
2. **Mid-series gaps** — when a player was missing from a snapshot (e.g., dropped out of the top-N briefly), their series got `value: null` for that point. ECharts was configured with `connectNulls: false`, so the line literally broke instead of bridging the gap.

The user also wanted visibility into the cropping decision: when snapshots don't cover the full competition window, log the crop to console so it's clear what the chart is actually showing vs. what the underlying competition window says.

## Changes

| #   | File                                                                                                                  | Change                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [chart-builder.ts](../../scout-for-lol/packages/backend/src/league/competition/chart-builder.ts)                      | Updated `resolveTimeWindow` to take `snapshots` and crop to the snapshot range when snapshots don't cover the full competition window; logs via `logger.info` when cropping happens.                                                                                                |
| 2   | [chart-builder.ts](../../scout-for-lol/packages/backend/src/league/competition/chart-builder.ts)                      | Reordered the line-branch so snapshots are loaded **before** `resolveTimeWindow`, then passed in.                                                                                                                                                                                   |
| 3   | [competition-chart.ts](../../scout-for-lol/packages/report/src/html/competition-chart.ts)                             | Flipped `connectNulls: false` → `connectNulls: true` so mid-gaps in a series are bridged with a straight line. Updated the JSDoc above `SOLID_LINE_THRESHOLD` to document the new connect-null behavior.                                                                            |
| 4   | [competition-chart.fixtures.test.ts](../../scout-for-lol/packages/report/src/html/competition-chart.fixtures.test.ts) | Extended `06-line-sparse-late-joiner` so two established (non-late-joiner) series also have a mid-range null gap (days 10–16) — exercises the new `connectNulls` behavior visually. Added new fixture `12-line-snapshots-start-after-competition` that simulates the cropping path. |

## What is intentionally NOT in scope

- **No interpolation / extrapolation of missing values.** Per the clarifying answer, we use `connectNulls: true` only — ECharts draws a straight line across the gap, no synthetic intermediate points are computed and no leading/trailing nulls are backfilled. This means a player who joined the leaderboard late still appears as a series that starts mid-chart (not extended backwards).
- **No y-axis log scale.** Y-axis stays linear.
- **No change to `competition.startDate` semantics.** The competition window is still the source of truth for everything else (notifications, scoring eligibility); only the _chart's display window_ gets cropped.

## Verification

```bash
# Typecheck
cd packages/scout-for-lol/packages/backend && bunx tsc --noEmit
cd packages/scout-for-lol/packages/report  && bunx tsc --noEmit

# Lint
cd packages/scout-for-lol/packages/backend && bunx eslint src/league/competition/chart-builder.ts
cd packages/scout-for-lol/packages/report  && bunx eslint src/html/competition-chart.ts src/html/competition-chart.fixtures.test.ts

# Re-render fixtures (writes PNGs to test-output/competition-chart/)
cd packages/scout-for-lol/packages/report
bun test src/html/competition-chart.fixtures.test.ts

# Backend unit tests
cd packages/scout-for-lol/packages/backend
bun test src/league/competition/chart-builder.test.ts
```

All passing. Cropping log line confirmed during backend test run:

```
[CompetitionChart] 🪟 Competition 123 chart window cropped to snapshot range:
  2026-04-01T00:00:00.000Z → 2026-04-02T00:00:00.000Z
  (competition window: 2026-04-01T00:00:00.000Z → 2026-05-17T23:45:12.661Z)
```

Visual review of the rendered PNGs confirmed:

- `02-line-highest-rank-30d-10p.png` — unchanged (no nulls in the series).
- `06-line-sparse-late-joiner.png` — late-joiner series still start mid-chart (no backfill, as designed); mid-gaps in Dan Kim/Edward are bridged invisibly with straight lines.
- `12-line-snapshots-start-after-competition.png` — chart fills the full frame across its 30-day range; no empty left gutter.

## Session Log — 2026-05-17

### Done

- `packages/scout-for-lol/packages/report/src/html/competition-chart.ts`: `connectNulls: true` + JSDoc update.
- `packages/scout-for-lol/packages/backend/src/league/competition/chart-builder.ts`: `resolveTimeWindow` takes snapshots, crops to data range, logs the crop; call site reordered so snapshots load before window resolution.
- `packages/scout-for-lol/packages/report/src/html/competition-chart.fixtures.test.ts`: extended `06-…`, added new fixture `12-line-snapshots-start-after-competition`.
- All typecheck, lint, unit tests, and fixture renders pass. Visual self-inspection of fixtures 02, 06, 07, 12 confirms expected behavior.

### Remaining

- None for this change.

### Caveats

- A stale bun cache for the `file:` symlinked `@scout-for-lol/data` package caused an initial `SyntaxError: Export named 'resolveQueueTypeFromGame' not found` when running the backend test. Resolved by re-running `bun install --frozen-lockfile` inside `packages/scout-for-lol/packages/backend`. Worth keeping in mind if future agents hit a "symbol not found in @scout-for-lol/data" error before touching deps — it's almost always the bun cache, not a real missing export.
- `connectNulls: true` will also bridge wide mid-gaps (e.g., a player missing for a week), producing a straight line that doesn't reflect their actual trajectory through the gap. We accepted this trade-off because (a) it's the simplest change, (b) it's what the user asked for, and (c) the alternative ("don't draw anything") was strictly uglier. If a future change wants to limit how far a bridge can stretch, switch to per-series interpolation in `buildSeries` and remove the ECharts flag.
