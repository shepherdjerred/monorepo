---
id: scout-arena-aram-rank-labels
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-05-16_scout-common-denominator.md
source_marker: false
---

# Fix Arena/ARAM worst-pairing rank labels to show global leaderboard rank

## What

The weekly Common Denominator update (Scout for LoL) builds Arena and ARAM "Worst Pairings" sections by reversing the bottom three pairings — but the rank labels are taken from the start of the bottom slice, not the global leaderboard. With 100 qualified pairings, the worst entry currently displays as rank 98 instead of rank 100.

Bonus: `ServerPairingStatsSchema` documents `individualStats` as "solo games where no other tracked player is present", but the implementation records single-player stats across all games where that player appears. Schema and behavior should agree.

## Why it's open

The originating session was an inspection-only review of the Common Denominator feature. The bugs are real but were not fixed in-place because (a) no decision yet on whether the feature is expected to evolve further, (b) no dedicated tests exist for `calculatePairingStats`, `findSurrenderLeaders`, `generateAbbreviatedSection`, or the weekly formatting path.

## Remaining

- [ ] Assign each reversed bottom-three entry its true global leaderboard rank instead of incrementing from `length - 2` after reversal.
- [ ] Make the `individualStats` schema documentation agree with the actual all-games calculation.
- [ ] Add focused tests for `calculatePairingStats`, bottom-three ordering/ranks, and weekly Arena/ARAM message formatting.
- [ ] Run Scout backend tests, typecheck, lint, and affected repository verification.

## Comment Log

- 2026-07-27 — Board audit reproduced the contradiction: `weekly-update.ts`
  reverses the bottom three while assigning ranks upward from `length - 2`, and
  `pairing-stats.ts` says solo-only while `calculate-pairings.ts` uses all games.

## References

- Originating log: `packages/docs/logs/2026-05-16_scout-common-denominator.md`
- Scheduler: `packages/scout-for-lol/packages/backend/src/league/cron.ts`
- Calculations: `packages/scout-for-lol/packages/backend/src/league/tasks/pairing/calculate-pairings.ts`
- Message builder: `weekly-update.ts` in the same directory tree
