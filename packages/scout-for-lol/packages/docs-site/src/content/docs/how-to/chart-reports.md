---
title: Turn a report into a chart
description: Pick a render kind that suits your data, map columns to chart channels, and style the result.
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
- **Change over time** → `line_chart` or `area_chart`, grouped by `day`, `week`,
  or `month`.
- **Parts of a whole** → `donut_chart`, and only when rows are few and actually
  sum to something meaningful.
- **Two dimensions at once** → `heatmap`, grouped by two dimensions.
- **Comparing two numbers per row** → `scatter_chart`.
- **One headline number** → `kpi_card` with `GROUP BY all`.
- **Comparing several normalized metrics** → `radar_chart`, three to eight of
  them.

All twelve are listed in [Render kinds and
options](/docs/reference/scoutql-render/).

## Map columns to the chart

`WITH (...)` binds your query's outputs to chart channels:

```sql
select games, win_rate
from match_participants
group by champion
during last 30 days
order by games desc
limit 10
render bar_chart with (y = games, orientation = horizontal)
```

- `y` is the numeric series — up to eight of them, as `y = (a, b)`.
- `x` is the horizontal channel; it defaults to the grouping column.
- `value` is the cell value for a heatmap or a KPI card.
- `size` sizes scatter points.

A chart that renders empty or wrong is nearly always a `y` bound to something
the query does not actually output — check that the name in `WITH` appears in
the `SELECT`.

## Read the evidence

Scout reports describe matches Scout has ingested for tracked players. They do
not describe every League match or the whole ranked ladder. Rates and derived
values show their game basis as **Based on N games**. When fewer than 10 games
support a rate, Scout adds: **Fewer than 10 games — treat this rate as
indicative only.**

## Chart a trend

Group by a time dimension rather than a player or champion:

```sql
select games, win_rate
from match_participants
where queue in (solo, flex)
group by week
during last 30 days
order by week asc
render line_chart with (y = win_rate, x_axis = "Week", smooth = true)
```

Note `order by week asc` — time charts read wrong when sorted by value, which is
the default.

## Chart two dimensions

A heatmap needs two grouping dimensions and a value:

```sql
select games
from match_participants
group by champion, team_position
during last 30 days
order by games desc
render heatmap with (value = games, series = team_position)
```

## Show one number

```sql
select games, win_rate, kda
from match_participants
where queue in (solo)
group by all
during last 30 days
render kpi_card
```

`GROUP BY all` collapses everything to a single row, which is what a KPI card
displays.

## Style it

```sql
render bar_chart with (
  y = win_rate,
  title = "Ranked win rate",
  subtitle = "Last 30 days",
  y_axis = "Win rate",
  theme = lol_dark,
  palette = ranked,
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

## Keep charts readable

Reports return at most 25 rows, and far fewer is usually better: a bar chart
with 25 categories is unreadable in a Discord message. Set an explicit `LIMIT`
of about 10 and let `ORDER BY` decide what matters.

## Related

- [Render kinds and options](/docs/reference/scoutql-render/)
- [ScoutQL reference](/docs/reference/scoutql/)
- [Schedule reports and deliver them](/docs/how-to/schedule-reports/)
