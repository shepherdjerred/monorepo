---
id: roborock-dock-alert-polarity-verification
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/completed/2026-07-25_roborock-saros-fleet-migration.md
source_marker: false
---

# Verify Roborock dock and water alert polarities

PR #1645 is deployed, all expected sensor series exist, and a real
`RoborockVacuumProblem` alert reached PagerDuty as incident #6834. The four
physical dock and water conditions have only been observed at their healthy
value.

## Remaining

- [ ] On a representative Saros dock, physically induce dirty-water-full,
      clean-water-empty, cleaning-fluid-low, and water-shortage one at a time.
- [ ] Confirm each corresponding metric changes from `0` to `1` and its named
      Roborock alert fires after five minutes.
- [ ] Restore each condition and confirm the metric returns to `0` and the alert
      resolves.

## Comment Log

- 2026-07-27 — Split from the completed fleet implementation because sensor
  polarity verification requires physical fault simulation.
