---
id: scout-report-backends-verify
type: todo
status: awaiting-human
board: true
verification: human
disposition: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Test and confirm the Scout for LoL report backends work end-to-end

## Human Verification

scout-prod logs show the `scheduled_reports` cron running every minute and completing
(`✅ scheduled_reports completed in ~70ms`), so the dispatcher loop is healthy. **However**,
PagerDuty incident **#5838** (triggered) reports that four `COMMON_DENOMINATOR` weekly reports
(`id=46,47,48,49`: Ranked Surrender Leaders, Ranked Pairings, Ranked Bottom Pairings, Arena
Pairings) "have not successfully run on schedule" — with a bogus `20631d` overdue duration, i.e.
their last-successful-run timestamp is epoch-0 / **null → they have never fired in prod**. So the
e2e path is _not_ confirmed green; there may be a real gap where these report types never dispatch.
Stays open — and worth investigating as a possible bug, not just a verification.

## What

Verify that report generation and delivery produce correct output across all
render variants and the scheduled-report path.

- **Render package** `packages/scout-for-lol/packages/report/` — satori (JSX→SVG)
  → resvg (SVG→PNG). Variants: `matchToImage`/`arenaMatchToImage`,
  `loadingScreenToImage`, `competitionChartToImage`, `discordScreenshotToImage`.
- **Post-match pipeline**
  `packages/scout-for-lol/packages/backend/src/league/tasks/postmatch/`
  (`match-history-polling` → `match-data-fetcher` → `match-report-*` →
  `match-report-generator` → S3 store → Discord post).
- **Scheduled reports** `packages/scout-for-lol/packages/backend/src/reports/`
  (`scheduler`, `discord-dispatcher`, `query-engine`, `system-reports`,
  `runner`).

## Why it's open

There's broad unit + snapshot coverage (~115 test files) and some integration
tests, but no recent confirmation that the full chain works against real data
and actually posts to Discord. The user wants the backends confirmed working,
not just unit-green.

## Done when

- `bun test` green in `packages/report/` and `packages/backend/` (incl. the
  `report-store` and `reports` integration tests).
- A real (or fixture) match flows the whole pipeline: poll → fetch → render →
  S3 → Discord post.
- Each render variant (standard, arena, loading screen, competition chart,
  discord screenshot) spot-checked, and the scheduled dispatcher confirmed to
  post a due report.

Resolve (delete this doc) once the end-to-end run is confirmed.
