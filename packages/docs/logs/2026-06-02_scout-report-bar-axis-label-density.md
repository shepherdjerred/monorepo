# Scout Report Bar Axis Label Density

## Status

Complete

## Context

Investigated why a Scout for LoL report bar chart with 24 returned rows displayed far fewer Y-axis player labels than bars.

## Findings

The report chart is rendered by `packages/scout-for-lol/packages/report/src/html/competition-chart.ts` with ECharts in SVG SSR mode. The horizontal bar chart maps every returned row into the bar series, but the category axis previously left label interval selection to ECharts. With 24 categories and 24px labels in the available chart height, ECharts auto-skipped category labels to avoid overlap, so roughly every other player label was shown while all bars and value labels remained visible.

The label fix sets the bar chart `yAxis.axisLabel.interval` to `0`, forcing ECharts to render every category label.

System-managed competition bar-chart reports now also cap display rows to top 10 by using the report default max row count instead of the competition participant cap. User-created reports remain configurable through the existing `max-rows` option.

## Session Log — 2026-06-02

### Done

- Loaded TypeScript, Vite/React, and Satori/report rendering guidance.
- Used `toolkit recall search` to check for prior Scout chart context.
- Inspected `packages/scout-for-lol/packages/report/src/html/competition-chart.ts`.
- Confirmed the cause was ECharts automatic category label interval selection, not missing data.
- Updated `packages/scout-for-lol/packages/report/src/html/competition-chart.ts` to force every bar-chart category label to render.
- Added a 24-row regression test in `packages/scout-for-lol/packages/report/src/html/competition-chart.fixtures.test.ts`.
- Updated `packages/scout-for-lol/packages/backend/src/reports/system-reports.ts` so system-managed competition bar charts show top 10 rows by default.
- Added a sync regression test in `packages/scout-for-lol/packages/backend/src/reports/system-reports.integration.test.ts`.
- Verified with `bun run --cwd packages/scout-for-lol/packages/report test src/html/competition-chart.fixtures.test.ts`.
- Verified with `bun run --cwd packages/scout-for-lol/packages/backend test src/reports/system-reports.integration.test.ts`.
- Verified with `bun run --cwd packages/scout-for-lol/packages/report typecheck`.
- Verified with `bun run --cwd packages/scout-for-lol/packages/report lint`.
- Verified with `bun run --cwd packages/scout-for-lol/packages/backend typecheck`.
- Verified with `bun run --cwd packages/scout-for-lol/packages/backend lint`.

### Remaining

- None.

### Caveats

- The exact posted report image was not regenerated, but the focused regressions cover 24-row label rendering and the system-report top-10 cap.
- `bun run --cwd packages/scout-for-lol/packages/backend generate` produced the Prisma client but failed at the Prettier step because `prettier-plugin-astro` was missing in this worktree. The generated client was sufficient for the backend integration test.
