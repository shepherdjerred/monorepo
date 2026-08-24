---
title: Turn a report into a chart
description: Pick a render kind that suits your data, map outputs to chart channels, and style the result.
sidebar:
  order: 7
---

Any report can render as a chart by ending its query with `RENDER <kind>` and
configuring it with `WITH (...)`. A query with no `RENDER` clause renders as a
table.

![A Scout report rendered as a horizontal bar chart, ranking ten players by damage to champions.](../../../assets/report-bar-chart.png)

## Pick a kind that suits the shape of your data

- **Ranking a handful of things** → `bar_chart`, or `leaderboard` for text with
  mentions.
- **Change over time** → `line_chart` or `area_chart`, grouped by
  `DATE_TRUNC('day' | 'week' | 'month', …)`.
- **Parts of a whole** → `donut_chart`, and only when rows are few and actually
  sum to something meaningful.
- **Two dimensions at once** → `heatmap`, grouped by two dimensions.
- **Comparing two numbers per row** → `scatter_chart`.
- **One headline number** → `kpi_card`, with no `GROUP BY` at all.
- **Comparing several normalized outputs** → `radar_chart`, three to eight of
  them.
- **The shape of a distribution** → `histogram` for counts per bucket,
  `box_plot` for a five-number summary per group.

Every kind and what it requires is in [Render kinds and
options](/docs/reference/scoutql-render/).

## Map outputs to the chart

`WITH (...)` binds your query's outputs to chart channels:

```scoutql
SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY champion
ORDER BY games DESC
LIMIT 10
RENDER bar_chart WITH (y = games, orientation = horizontal)
```

- `y` is the numeric series — up to eight of them, as `y = (a, b)`.
- `x` is the horizontal channel; it defaults to the grouping.
- `value` is the cell value for a heatmap.
- `size` sizes scatter points.

A name inside `WITH (...)` must be one the `SELECT` produced. That is checked
when the query compiles, so a chart no longer renders empty because `y` pointed
at nothing — it refuses to save instead.

## Chart a trend

Group by a truncated timestamp rather than a player or champion, and echo the
same expression in the `SELECT` so the bucket has a name to plot and sort by:

```scoutql
SELECT DATE_TRUNC('week', game_creation_at) AS week,
       COUNT(*) AS games,
       AVG(win::INT) AS win_rate
FROM match_participants
WHERE queue IN ('solo', 'flex')
  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER line_chart WITH (y = win_rate, x_axis = 'Week', smooth = true)
```

Note `ORDER BY week ASC` — a time chart sorted by value reads as noise.

## Compare against the previous period

Add `compare = previous_period` to overlay the equally long span immediately
before the window. It needs the stated window and the time bucket to line the
two runs up:

```scoutql
SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 28 DAY
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER line_chart WITH (y = games, compare = previous_period)
```

## Chart two dimensions

A heatmap needs exactly two groupings and a value:

```scoutql
SELECT COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY champion, team_position
ORDER BY games DESC
RENDER heatmap WITH (value = games, series = team_position)
```

## Show one number

```scoutql
SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate, kda() AS kda
FROM match_participants
WHERE queue = 'solo'
  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
RENDER kpi_card WITH (y = (games, win_rate, kda))
```

No `GROUP BY` means one grand-total row, which is what a KPI card displays.

## Chart a distribution

A histogram buckets a numeric column and counts rows per bucket. Divide to
assign the bucket, multiply to restore its real starting value:

```scoutql
SELECT FLOOR(game_duration_seconds / 300) * 300 AS bucket, COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY FLOOR(game_duration_seconds / 300) * 300
ORDER BY bucket ASC
RENDER histogram WITH (x = bucket, y = games)
```

## Style it

```scoutql
SELECT AVG(win::INT) AS win_rate
FROM match_participants
WHERE queue = 'solo'
  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY champion
ORDER BY win_rate DESC
LIMIT 10
RENDER bar_chart WITH (
  y = win_rate,
  title = 'Ranked win rate',
  subtitle = 'Last 30 days',
  y_axis = 'Win rate',
  theme = lol_dark,
  palette = colorblind,
  labels = percent,
  legend = none
)
```

- `theme` — `lol_dark`, `lol_light`, `minimal_dark`, `minimal_light`.
- `palette` — `ranked`, `categorical`, `team`, `gold`, `colorblind`. Use
  `colorblind` for anything the whole server reads.
- `colors = (#rrggbb, …)` — up to eight custom colors, contrast-corrected for
  the theme.
- `labels` — `auto`, `show`, `hide`, `value`, `percent`.
- `sort` — reorders the chart visually without changing the query's rows.

Strings inside `WITH (...)` are single-quoted, like everywhere else in the
language.

## Keep charts readable

Reports return at most 25 rows, and far fewer is usually better: a bar chart
with 25 categories is unreadable in a Discord message. Set an explicit `LIMIT`
of about 10 and let `ORDER BY` decide what matters.

## Related

- [Render kinds and options](/docs/reference/scoutql-render/)
- [Query recipes](/docs/how-to/scoutql-recipes/)
- [ScoutQL reference](/docs/reference/scoutql/)
- [Schedule reports and deliver them](/docs/how-to/schedule-reports/)
