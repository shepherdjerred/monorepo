---
id: karma-bot-rich-leaderboards
type: todo
status: in-progress
board: true
verification: agent
disposition: active
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

## Remaining

- [ ] Extract and test deterministic leaderboard/history view models from the
      TypeORM query results, including ties, empty guilds, and long names.
- [ ] Render leaderboard and karma-over-time images with the established
      Satori/resvg stack and send them as bounded Discord attachments.
- [ ] Replace the placeholder `"true"` test script with database tally,
      rendering, and command-response coverage.

## Comment Log

### 2026-07-27 — in-progress board audit

- Retained as active. The current commands remain text-only and the package
  still lacks executable tests for either tallying or rendering.
