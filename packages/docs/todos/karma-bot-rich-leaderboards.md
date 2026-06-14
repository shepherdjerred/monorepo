---
id: karma-bot-rich-leaderboards
status: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Karma bot: embedded images, graphs, and rich leaderboards

## What

Enhance `packages/starlight-karma-bot` with image/graph rendering — the
leaderboard and history are plain text today.

Current state:

- Commands: `/karma give`, `/karma leaderboard` (text, bold for top 3),
  `/karma history` (last ~10 transactions).
- Storage: SQLite via TypeORM (`packages/starlight-karma-bot/src/db/index.ts`,
  `glitter.sqlite`), per-guild per-user.
- **No image/graph/leaderboard rendering**, and **no tests** (the test script is
  `"true"`).

## Approach

Reuse the proven render stack from `packages/scout-for-lol/packages/report/`:
`satori` (JSX→SVG) + `@resvg/resvg-js` (SVG→PNG) + `echarts`. Render the
leaderboard / karma-over-time as an image and send it as a Discord embed
attachment. Scout's `competition-chart` color/palette logic is a good reference.

## Done when

- Leaderboard rendered as an image/chart embed (not plain text).
- Karma-over-time graphs and richer history views.
- Tests added (replace the `"true"` test script with real coverage of the karma
  tally + render path).
