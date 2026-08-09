---
id: plan-2026-08-08-scout-temporal-visualization-expansion
type: plan
status: in-progress
board: false
---

# Scout Temporal Analysis and Visualization Expansion

## Summary

Deliver the selected top fifteen visualization features in one PR. Reports gain reproducible ScoutQL temporal analysis for windows up to 365 days. Competitions retain official competition-to-date standings while adding period-filtered standings and curated analysis presets across the full competition lifespan.

Web previews and detail pages use interactive charts. Discord and archived posts receive deterministic PNGs generated from the same versioned visualization model.

## Temporal Analysis

- Add canonical ScoutQL clauses for relative and custom windows, day/week/month/patch buckets, previous or custom comparison periods, and IANA timezones.
- Preserve existing queries through compatibility parsing while rejecting ambiguous mixtures of legacy and canonical temporal controls.
- Add shared temporal window, comparison, evidence, annotation, series-result, and visualization snapshot schemas.
- Limit report periods to 365 days. Clamp competition periods to competition dates without adding a duration cap.
- Use ISO Monday weeks, automatic buckets, eight plotted series, and a 2,000-point ceiling.
- Treat missing additive buckets as zero and missing rates or averages as unknown.

## Visualization Features

1. Preset and custom date ranges.
2. Day, week, month, patch, and automatic buckets.
3. Previous-period comparison.
4. Absolute and percentage deltas.
5. Sample sizes and Wilson confidence intervals for binary rates.
6. Denominator-aware rolling averages.
7. Equal-length custom baselines.
8. Patch, season, and competition annotations.
9. Competition rank-position bump charts.
10. Percentage-normalized stacked charts.
11. Cumulative additive metrics.
12. Calendar heatmaps.
13. Linear trend overlays with slope and R-squared, without forecasting.
14. Interactive web hover, crosshairs, zoom, and brushing.
15. Table and KPI sparklines, with static Discord equivalents.

## Reports and Competitions

- Build one serializable visualization model consumed by browser ECharts and server SVG-to-PNG rendering.
- Archive exact report query and visualization snapshots for new runs while preserving PNG fallback for existing runs.
- Add temporal controls to report editing, preview, and detail exploration.
- Add `Official` and `Selected period` competition standings modes plus criterion score, rank, activity, performance, and composition presets.
- Compute match criteria from report-lake facts and ranked criteria from historical leaderboard snapshots materialized into the disposable report lake.
- Persist a competition analysis timezone, defaulting existing competitions to UTC.
- Preserve current permissions, query timeouts, and official standings behavior.

## Persistence and Compatibility

- Add nullable report-run query and visualization artifact metadata without backfilling historical runs.
- Extend report-lake staging, compaction, and rebuild for competition leaderboard snapshots while retaining S3 as authority.
- Preserve existing APIs and PNG fields during migration.
- Update ScoutQL parsing, formatting, Monaco support, help, AI context, presets, architecture documentation, and the human wiki.

## Verification

- Unit-test grammar, formatting, timezone and DST behavior, range limits, comparison alignment, transforms, evidence, annotations, and cardinality.
- Integration-test DuckDB temporal aggregation, competition range intersection, every competition criterion, and rank-history rebuilds.
- Add deterministic SVG and PNG fixtures for every new visualization behavior.
- Test browser/server model parity, controls, standings modes, archived fallback, permissions, and failure states.
- Run focused Scout data, backend, report, and app checks; Buildkite remains the exhaustive repository gate.
- Attach report and competition interaction recordings plus representative Discord PNGs to one draft git-spice PR.

## Assumptions

- Report analysis periods and comparison periods may each span up to 365 days.
- Competition analysis may span any portion of the competition, while official standings remain unchanged.
- The implementation uses phased commits inside one PR.
- Lower-ranked visualization ideas remain out of scope.
