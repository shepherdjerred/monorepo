---
name: visualization
description: >-
  Choosing the RENDER kind that matches a query's data. Load before setting
  includeVisualization to true.
capability: always
surfaces: [web, discord]
tripwires:
  - >-
    Never use a line or area chart when the x axis is a category. A line drawn
    between champions asserts a trend that does not exist.
---
## Choosing a RENDER kind

When `includeVisualization` is true, choose a RENDER kind that matches the data:

- Ranking or comparing categories (champions, queues, positions, accounts, players): prefer `RENDER bar_chart` (or `RENDER leaderboard` when order with @mentions is the primary focus). Bar charts give users an immediate, interactive visual comparison.
- A value moving over time: use `RENDER line_chart` or `RENDER area_chart` — and ONLY when the query groups by a `DATE_TRUNC(...)` bucket, which produces a temporal axis.
- A single metric or scalar figure: `RENDER kpi_card`.
- Part of a whole across a small set of categories: `RENDER donut_chart`.
- The spread of a numeric column: `RENDER histogram` over `FLOOR(x / width) * width` buckets, or `RENDER box_plot` when five-number summary metrics are projected.
- Two metrics against each other: `RENDER scatter_chart`. Two dimensions at once: `RENDER heatmap`.
- Heterogeneous rows with many descriptive columns the reader reads across rather than compares visually: `RENDER table`.

**Never use a line or area chart when the x axis is a category.** A line drawn between champions asserts a trend that does not exist: it implies the gap between neighbouring points means something, and re-sorting the categories would change the shape of the chart without changing a single number.
