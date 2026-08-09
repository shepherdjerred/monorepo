---
title: Scout temporal analysis
description: How Scout reports and competitions share one reproducible time model while preserving official standings and deterministic Discord output.
---

Scout can explore reports and competitions over time without changing official
competition standings. One versioned visualization snapshot drives interactive
web charts and deterministic Discord PNGs, so both surfaces show the same data.

```mermaid
flowchart LR
  Q[ScoutQL time window] --> D[DuckDB report lake]
  C[Competition period] --> D
  H[S3 leaderboard history] --> L[Rank-history lake source]
  L --> D
  D --> V[Visualization snapshot]
  V --> W[Interactive web chart]
  V --> P[Archived PNG]
  accTitle: Scout temporal analysis flow
  accDescr: Report ScoutQL windows and competition periods query the disposable DuckDB report lake. S3 leaderboard history is materialized as a rank-history source. Both paths produce one visualization snapshot, which renders interactively on the web and deterministically as an archived PNG.
```

Reports save their timezone in ScoutQL. They support relative or inclusive
calendar windows up to 365 days, automatic or explicit buckets, and optional
equal-length comparisons. New runs archive the exact query and visualization;
older runs continue to use their PNG.

Competitions default to `Official`, the existing competition-to-date result.
`Selected period` intersects the requested dates with the competition lifespan
and recomputes match criteria from lake facts or rank criteria from daily
leaderboard snapshots. Its persisted analysis timezone defaults to UTC.

The snapshot carries evidence and presentation intent: sample sizes, Wilson
intervals, comparison deltas, rolling or cumulative transforms, annotations,
trends, stacking, bump charts, calendar heatmaps, and sparklines. Browser hover,
crosshairs, zoom, and brushing are interaction only; they do not alter archived
results.
