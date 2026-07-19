---
id: log-2026-07-06-scout-local-webapp-core-db
type: log
status: complete
board: false
---

# Scout Local Webapp Core DB

## Context

The user wanted Scout's beta SQLite data available locally without copying the
full beta `/data/db.sqlite`, which was about 3.9 GiB.

## Session Log - 2026-07-06

### Done

- Verified the live beta backend pod `scout-beta-scout-backend-75bf9cfbdd-jxjrj`
  on context `admin@torvalds` and confirmed `/data/db.sqlite` was about 3.9 GiB.
- Created a compact SQLite copy in the pod with the full schema but only the
  app-managed UI tables copied: players, accounts, subscriptions, reports,
  report runs, seasons, competitions, participants, snapshots, permissions,
  audit rows, user/sound-pack tables, guild install rows, and bot state.
- Copied the compact DB to
  `packages/scout-for-lol/packages/backend/local-web-dev.db`; local size was
  about 608 KiB.
- Verified the local DB had no pending Prisma migrations and retained the core
  beta UI counts: `Player=28`, `Account=41`, `Subscription=28`, `Report=9`,
  `ReportRun=136`, `Season=6`, `Competition=12`,
  `CompetitionParticipant=279`, and `CompetitionSnapshot=184`.
- Left bulky derived/history tables empty locally:
  `StoredMatch`, `StoredMatchTimeline`, `StoredPrematch`,
  `MatchParticipantFact`, `PrematchParticipantFact`, and `MatchRankHistory`.
- Refreshed Scout workspace dependencies with `bun install` only; did not run
  `bun run scripts/setup.ts`.
- Started the Scout backend locally on `http://localhost:3000` with the beta
  1Password environment and started the Vite app on
  `http://localhost:5180/app/`.
- Verified `http://localhost:3000/ping` returned `pong` and the Vite app
  returned `200 OK`.

### Remaining

- None for the requested local run.

### Caveats

- The local backend uses the beta Discord token while running, so it takes over
  the beta bot gateway connection until stopped.
- The compact DB is intended for the web app management UI. Report previews,
  leaderboard refreshes, and any flow that needs historical match/report facts
  will have empty local history because the bulky fact/raw tables were not
  copied.
- Starting the backend runs Scout's normal cron jobs against the local compact
  DB, using real beta secrets.
