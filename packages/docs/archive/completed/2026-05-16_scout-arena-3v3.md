---
id: reference-completed-2026-05-16-scout-arena-3v3
type: reference
status: complete
board: false
---

# Scout Arena 3v3 Detection And Rendering

## Summary

Detect Riot's new 3v3 Arena payloads by Arena signals, even when `queueId` reports as custom, and reuse the existing Arena report/loading-screen visual assets and styling with layouts adjusted for teams of three.

## Key Changes

- Add a shared Arena resolver that treats a game as Arena when `gameMode === "CHERRY"` or queue ID is `1700`.
- Support both legacy `8 teams x 2 players` Arena and current `6 teams x 3 players` Arena.
- Keep the existing Arena report card style for postmatch teams; render Arena prematch as followed-player champion cards only because current spectator payloads do not expose reliable team membership.
- Update marketing/docs copy from fixed 16-player duo wording to current 18-player / six teams of three wording.

## Test Plan

- Backend Arena classification and grouping tests for CHERRY custom-shaped payloads, ordinary custom games, legacy 2v2 Arena, and 3v3 Arena.
- Report rendering tests for 3-player Arena post-match cards and six-team Arena loading screens.
- Targeted verification commands:
  - `bun test packages/data/src/model/loading-screen.test.ts`
  - `bun test packages/backend/src/league/model/__tests__/arena*.test.ts`
  - `bun test packages/backend/src/league/tasks/prematch/__tests__/loading-screen-builder.integration.test.ts`
  - `bun test packages/report/src/html/arena packages/report/src/html/loading-screen`
  - `bun run typecheck`

## Assumptions

- `gameMode: "CHERRY"` is the strongest Arena signal when Riot reports queue `0`.
- Reusing the current Arena art/report style is preferred over creating a new 3v3-specific visual system.
- Post-match reports keep rendering teams containing tracked players, matching current Arena behavior.

## Session Log — 2026-05-16

### Done

- Added shared Arena detection via `resolveQueueTypeFromGame` / `isArenaQueueOrMode`, and routed backend, report tooling, competition helpers, review tooling, and frontend review conversion through it.
- Updated Arena match schemas and backend grouping to support both legacy `8 x 2` and current `6 x 3`, including tracked-player `teammates`.
- Re-enabled prematch Arena loading-screen rendering for CHERRY/custom-shaped games, with 16-player and 18-player inference when `playerSubteamId` is missing.
- Adapted existing Arena loading cards with compact 3-player team cards; existing Arena post-match team cards now accept three player rows.
- Added synthetic 3v3 Arena fixtures and render tests for post-match and loading-screen output.
- Updated Arena fixture JSON and snapshots from singular `teammate` to plural `teammates`.
- Updated Scout marketing/docs/README copy for 18-player Arena while noting legacy duo reports still render.
- Verified `generate:test-template` against main's migration-based SQLite template generator.
- Verified with focused Bun tests, ESLint, and `bun run typecheck`.

### Remaining

- Pull and redact real 18-player SeaweedFS/S3 prematch and post-match payloads when credentials are available; this implementation currently includes synthetic regression fixtures.

### Caveats

- Several backend tests log a metrics/database warning about an empty local SQLite database, but the tested assertions pass.

## Session Log — 2026-05-17

### Done

- Rebased over main's migration-based SQLite template generator, which superseded the earlier Prisma schema-engine workaround.
- Completed the daily leaderboard S3 mock so chart rendering can import `loadHistoricalLeaderboardSnapshots` consistently.
- Hid the loading-screen ban row whenever the normalized `bans` array is empty, so empty ban slots no longer render for Arena or any other no-ban mode.
- Compared real 2026-05-16 and 2026-05-17 SeaweedFS prematch/postmatch Arena payloads and confirmed current prematch payloads do not expose reliable team membership.
- Changed Arena prematch data to preserve unknown subteams as `arenaTeam: null` instead of inferring teams from participant order.
- Changed the Arena prematch image to render only followed-player champion cards, with no team labels or team grouping.
- Updated the Arena prematch heading to `Champions Played` and removed the old tracked-player wording from code and docs.
- Rebasing onto current `origin/main` resolved conflicts with the new standard-lane inference work while keeping Arena prematch team inference disabled.
- Updated the Arena loading-screen fixture with `championId` values required by main's stricter loading-screen participant schema.
- Verified `bun test src/league/tasks/competition/daily-update.integration.test.ts`, backend `bun test`, and Scout `bun run --filter='./packages/*' test` pass.
- Verified `bun test src/html/loading-screen/game-header.test.tsx src/html/loading-screen` in `packages/scout-for-lol/packages/report`.
- Verified followed-player-only Arena prematch behavior with focused data/backend/report tests, ESLint, and package typechecks for `data`, `backend`, and `report`.
- Verified the rebased branch with Scout `bun run --filter='./packages/*' typecheck` and `bun run --filter='./packages/*' test`.

### Remaining

- Add redacted real 18-player SeaweedFS/S3 prematch and post-match regression fixtures if we want permanent coverage beyond the live comparison already performed.

### Caveats

- Scout frontend test script reports Playwright tests disabled, matching existing package behavior.
- Backend tests still log a metrics/database warning about an empty local SQLite database, but the assertions pass.
