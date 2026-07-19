# ScoutQL Analytics and Visualization Expansion

## Status

Complete

## Summary

Ship one PR that expands ScoutQL using existing report-lake data: expose safe analytical fields, add bounded aggregate expressions and richer grouping/filtering, add seven render kinds with appearance controls, and add fourteen categorized presets. Existing saved queries remain valid and no new ingestion or Prisma migration is introduced.

The separate reporting-editor plan has not landed and remains out of scope. This implementation therefore uses UTC for temporal buckets and preserves current numeric champion filtering while keeping the new registries and AST extensible for the later editor work.

## Language and Data

- Support numeric literals, parentheses, `+`, `-`, `*`, `/`, aliases, `round`, `coalesce`, `per_game`, and `per_minute` in `SELECT`.
- Add `HAVING` over metrics or aliases, ordering/rendering by aliases, up to twenty outputs, expression depth eight, and two grouping dimensions.
- Add `GROUP BY all`, categorical match dimensions, and UTC `day`, `week`, and `month` buckets.
- Extend typed `WHERE` filters through a closed field/operator registry; continue to bind every runtime value.
- Expose safe economy, farming, damage, utility, vision, combat, survival, progression, objective, outcome, and Arena metrics already present in the lake.
- Reject source-incompatible grouping/filter fields; preserve the established zero-valued prematch-stat convention.
- Carry ordered output aliases and explicit dimension values so compound dimensions render without losing their axes.

## Rendering

- Keep table, list, leaderboard, bar, and line output.
- Add stacked bar, area, donut, scatter, heatmap, radar, and KPI-card charts.
- Add multi-metric channels (maximum eight), four themes, five palettes, custom series colors, orientation, labels, legend, sorting, smoothing, subtitle, and axis labels.
- Custom colors are contrast-adjusted against solid theme backgrounds; backgrounds and typography remain theme-controlled.
- Keep output at 1600x900 and fail fast on chart-specific cardinality violations.

## Product Integration

- Drive parser, formatter, lint, completion, hover, docs, AI context, output labels, and presets from shared registries.
- Add fourteen categorized presets covering formulas, new metrics, compound/temporal/all grouping, every new chart family, and custom styling.
- Preserve existing query defaults; categorical line queries become real categorical lines rather than one-point time series.

## Verification

- Unit-test parsing, expression evaluation, registry exhaustiveness, source compatibility, filtering, grouping, rendering options, and preset compilation.
- Integration-test DuckDB aggregation through every chart family and runner failure persistence.
- Render deterministic SVG/PNG fixtures for every chart family and representative themes, labels, palettes, and series shapes.
- Run Scout-scoped typecheck, tests, ESLint, and app build; attach actual before/after and gallery artifacts to the PR.

## Session Log — 2026-07-12

### Done

- Implemented bounded expressions, aliases, `HAVING`, typed row filters, two-dimensional grouping, UTC temporal buckets, and `GROUP BY all` in `packages/scout-for-lol/packages/data/src/model/report-query-*.ts`.
- Exposed the existing safe match-lake economy, farming, combat, utility, vision, progression, survival, objective, outcome, and Arena counters through DuckDB and the legacy parity path.
- Added stacked bar, area, donut, scatter, heatmap, radar, and KPI rendering with multi-series channels, themes, palettes, custom contrast-corrected colors, labels, legends, orientation, sorting, smoothing, subtitles, and axis labels.
- Updated Monaco completion/highlighting, in-app reference docs, categorized preset UI, and the report AI language tool. Added fourteen new presets (twenty-three total).
- Added deterministic analytics PNG fixtures and inspected stacked-bar, heatmap, and KPI output; fixed heatmap value formatting/contrast and KPI typography from visual QA.
- Ran full setup and verification: Scout-wide typecheck, app production build, 1,134 backend tests, 451 data tests, 53 report tests, package lint, and package formatting.

### Remaining

- None for the implementation. PR publication and CI/review status are recorded in the final handoff.

### Caveats

- The separate reporting-editor plan remains out of scope; temporal buckets are UTC and champion filtering remains numeric in this PR.
- The data package now ignores generated Data Dragon payloads in its package-local Prettier run, matching the existing root ignore and making its documented format gate reproducible.
