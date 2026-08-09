---
id: karma-bot-rich-leaderboards
type: todo
status: in-progress
board: true
verification: agent
disposition: active
source_marker: false
---

# Karma bot: embedded images, graphs, and rich leaderboards

## What

Enhance `packages/starlight-karma-bot` with image/graph rendering — the
leaderboard and history are plain text today.

Current state:

- Commands: `/karma give`, `/karma leaderboard` (text, bold for top 3),
  `/karma history` (last ~10 transactions), plus the query surface added in
  #2043.
- Storage: SQLite via **Prisma** (`packages/starlight-karma-bot/prisma/schema.prisma`,
  client in `src/db/index.ts`, database at `DATABASE_PATH`), per-guild per-user.
  The TypeORM/`glitter.sqlite` layer was removed in #2038; read queries now live
  in `src/karma/queries.ts` and pure ranking in `src/karma/scoring.ts`.
- **No image/graph/leaderboard rendering.** The package does now have tests
  (the `"true"` placeholder script is gone).

## Approach

Reuse the proven render stack from `packages/scout-for-lol/packages/report/`:
`satori` (JSX→SVG) + `@resvg/resvg-js` (SVG→PNG) + `echarts`. Render the
leaderboard / karma-over-time as an image and send it as a Discord embed
attachment. Scout's `competition-chart` color/palette logic is a good reference.

## Remaining

- [ ] Extract and test deterministic leaderboard/history view models from the
      Prisma query results in `src/karma/queries.ts`, including ties, empty
      guilds, and long names. Dense ranking is already covered by
      `src/karma/scoring.test.ts`.
- [ ] Render leaderboard and karma-over-time images with the established
      Satori/resvg stack and send them as bounded Discord attachments.
- [ ] Add rendering and command-response coverage on top of the existing unit
      tests.

## Comment Log

### 2026-07-27 — in-progress board audit

- Retained as active. The current commands remain text-only and the package
  still lacks executable tests for either tallying or rendering.

### 2026-08-08 — Prisma migration

- Updated the storage references: the package moved from TypeORM to Prisma in
  #2038, so the previous pointers to `glitter.sqlite` and TypeORM query results
  would have led future work toward removed APIs.
