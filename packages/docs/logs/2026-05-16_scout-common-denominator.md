---
id: log-2026-05-16-scout-common-denominator
type: log
status: complete
board: false
---

# Scout Common Denominator Review

## Findings

- The "Common Denominator" feature is Scout for LoL's weekly pairing update. It runs from `packages/scout-for-lol/packages/backend/src/league/cron.ts` every Sunday at 18:00 UTC and is gated by the `common_denominator_enabled` flag for `MY_SERVER`.
- The update builds ranked, Arena, and ARAM pairing stats from S3 match data in `packages/scout-for-lol/packages/backend/src/league/tasks/pairing/calculate-pairings.ts`, then posts a Discord message from `weekly-update.ts`.
- Ranked output includes highest surrender rate, most games together, and a top/bottom leaderboard. Arena and ARAM output include abbreviated best/worst pairings.
- There are no dedicated tests for `calculatePairingStats`, `findSurrenderLeaders`, `generateAbbreviatedSection`, or the weekly message formatting path.

## Caveats

- The Arena/ARAM "Worst Pairings" section reverses the bottom three pairings but still labels ranks from the start of the bottom slice. With 100 qualified pairings, the worst entry would display as rank 98 instead of 100.
- `ServerPairingStatsSchema` documents `individualStats` as "solo games where no other tracked player is present", but the implementation records single-player stats across all games where that player appears.

## Session Log - 2026-05-16

### Done

- Loaded the League of Legends and TypeScript skills.
- Searched local recall for prior Scout for LoL context.
- Inspected the Common Denominator scheduler, feature flag, debug command, weekly message builder, pairing calculation, and S3 match query path.
- Added this session log at `packages/docs/logs/2026-05-16_scout-common-denominator.md`.

### Remaining

- Fix the Arena/ARAM worst-pairing rank labels if the displayed ranks should reflect global leaderboard rank.
- Add focused tests around pairing calculation and weekly message formatting if this feature is expected to evolve.

### Caveats

- No production code was changed in this pass.
- No verification suite was run because the work was inspection plus documentation only.
