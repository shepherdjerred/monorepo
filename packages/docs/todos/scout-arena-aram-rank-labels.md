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

- [ ] `generateAbbreviatedSection` (or wherever the rank label is computed) shows the global leaderboard rank for each entry in the Arena/ARAM "Worst Pairings" section.
- [ ] The `individualStats` schema docstring matches the actual implementation (or the implementation is changed to match the docstring).
- [ ] Focused tests added for `calculatePairingStats` and the weekly message formatter that lock in the rank-label behavior.

## References

- Originating log: `packages/docs/logs/2026-05-16_scout-common-denominator.md`
- Scheduler: `packages/scout-for-lol/packages/backend/src/league/cron.ts`
- Calculations: `packages/scout-for-lol/packages/backend/src/league/tasks/pairing/calculate-pairings.ts`
- Message builder: `weekly-update.ts` in the same directory tree
