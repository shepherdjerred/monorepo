---
title: Build your first scheduled report
description: Write a ScoutQL query in the dashboard, preview it against real match data, render it as a chart, and schedule it to post every week.
sidebar:
  order: 3
---

In this tutorial you will write a query in **ScoutQL** — Scout's report query
language — preview it against your server's real match history, turn it into a
chart, and schedule it to post itself to a channel every week. You will meet
`SELECT`, `FROM`, `GROUP BY`, `ORDER BY`, and `RENDER`.

You need at least one tracked player who has played recently. Reports read the
last 30 days of match history by default, so a server that has just been set up
will return empty rows.

## What you will end up with

A chart that posts itself on a schedule:

![A Scout report rendered as a horizontal bar chart titled Scheduled Report Damage, ranking ten players by damage to champions on a dark background.](../../../assets/report-bar-chart.png)

## 1. Open the report editor

Go to the [Scout dashboard](/app/), choose your server, open the **Reports**
tab, and choose **New report**.

## 2. Start from a preset

The editor opens with a categorized preset list on the left and a **Live
preview** on the right. Under **Leaderboards**, choose **Most games played**. It
loads this query into the editor:

```sql
select games, win_rate
from match_participants
group by player
order by games desc
limit 10
render leaderboard
```

Read it once before changing anything:

- `select games, win_rate` — the two numbers you want per row.
- `from match_participants` — one row per tracked player per match.
- `group by player` — collapse those rows to one per player.
- `order by games desc` — most active first.
- `limit 10` — at most ten rows.
- `render leaderboard` — display it as a ranked list.

## 3. Watch the preview

You do not have to run anything. **Live preview** re-runs the query against your
server's last 30 days as you edit and shows the rows it would post, along with
how many were returned and how many were scanned.

![The report editor's live preview showing a table of players with games and win rate, above the count of rows returned and scanned.](../../../assets/dashboard-report-live-preview.png)

This is real data, not a sample — if a player is missing, they have not played
in the window.

## 4. Change what it measures

Replace `games, win_rate` in the `SELECT` with damage:

```sql
select damage_to_champions
from match_participants
group by player
order by damage_to_champions desc
limit 10
render leaderboard
```

The preview re-ranks by total damage dealt to champions within a second or so.

Every name you can put in a `SELECT` comes from a fixed list — see the [metric
reference](/docs/reference/scoutql-metrics/) for all of them.

## 5. Turn it into a chart

Change the last line to render a bar chart, and tell it which column to plot:

```sql
select damage_to_champions
from match_participants
group by player
order by damage_to_champions desc
limit 10
render bar_chart with (y = damage_to_champions, orientation = horizontal)
```

The preview now renders the actual chart image Scout will post, with the data
table underneath it. `RENDER` picks the display kind; `WITH (...)` configures
it.

Switching presets is the fastest way to see what the other kinds look like —
the preview re-renders each one against your own data:

![Cycling through report presets while the live preview re-renders a leaderboard, a queue breakdown, a champion bar chart, and a KPI card.](/docs/demos/demo-scoutql-preview.gif)

## 6. Give it a title and a destination

Above the editor, fill in:

- **Title** — `Weekly damage leaders`.
- **Channel** — the channel the report should post to.

## 7. Schedule it

Under **Schedule**, choose the preset **Weekly — Monday midnight**, and check
that the timezone next to it is the one you want. It defaults to your browser's
timezone, and **Next 3 runs** underneath shows exactly when the report will
fire.

![The report form showing the query editor, a Query reference expander, the schedule preset with timezone, and the next three run times.](../../../assets/dashboard-report-editor.png)

## 8. Save it

Choose **Create**. The report appears in the list with its schedule and next run
time.

## 9. Run it once without waiting

Open the report and choose **Run now**.

Scout executes the query and posts the chart to the channel you picked, exactly
as the schedule will. The run is recorded in the report's history with its
status, duration, and row count — and a manual run does not disturb the
schedule.

## What you did

You wrote a ScoutQL query, previewed it against real match data, changed the
metric, rendered it as a chart, and put it on a weekly schedule.

From here:

- Learn the whole language in the [ScoutQL reference](/docs/reference/scoutql/).
- See the other eleven display kinds in [Render kinds and
  options](/docs/reference/scoutql-render/).
- Chart two dimensions at once with [Turn a report into a
  chart](/docs/how-to/chart-reports/).
