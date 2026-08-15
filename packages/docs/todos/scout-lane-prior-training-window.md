---
id: scout-lane-prior-training-window
type: todo
status: planned
board: true
verification: human
disposition: active
source_marker: false
---

# Scout lane priors are trained on a hardcoded, now-stale date window

## What

`SCOUT_LANE_PRIOR_UPDATE_CONFIG` (`packages/temporal/src/schedules/schedule-payloads.ts`)
pins the lane-prior training and holdout windows to fixed dates:

- training `2026-05-06` → `2026-05-13`
- holdout `2026-05-14` → `2026-05-16`

Every `scout-data-dragon-*` run regenerates the artifact from that same three-month-old slice
of the `scout-prod` match lake. The priors therefore never incorporate newer matches, no matter
how often the schedule fires — the regeneration is real work that produces a byte-identical
result apart from its `generatedAt` stamp.

This was invisible until 2026-08-14, because the generator had been writing to the wrong
directory since 2026-05-17 (see
`packages/docs/plans/2026-08-14_fix-scout-data-dragon-lane-prior-paths.md`) and the committed
artifact was never updated at all. With the write path fixed, the staleness becomes the
remaining issue.

## Why it is not simply "use a rolling window"

The window is a modelling decision, not a config default:

- Lane priors map champion + summoner-spell pairs to lane probabilities. A rolling window
  makes the artifact track the live meta, which is probably wanted — but it also makes every
  weekly run produce a genuine diff, so the churn suppression added in the fix above stops
  applying and each run opens a real PR.
- `evaluate-lane-priors` fails fast below `threshold: 0.95` (`eval.ts`). A rolling window can
  legitimately dip under that after a patch that shifts lane assignments, which would turn a
  data shift into a red schedule.
- The holdout must stay disjoint from training for the eval to mean anything, and the current
  seed (`scout-lane-priors-patch-cadence-v1`) encodes a specific sampling intent.

## Remaining

- [ ] Decide whether lane priors should track a rolling window, be re-pinned to a recent fixed
      window periodically, or stay pinned deliberately.
- [ ] If rolling: choose the lookback, decide how eval-threshold failures should behave
      (fail the run vs. open a PR flagged for review), and revisit the `generatedAt` churn
      suppression, which assumes a pinned window.
- [ ] If re-pinned periodically: document who moves the dates and on what trigger
      (patch cadence? season?).
- [ ] Confirm the `scout-prod` lake still retains match JSON far enough back for whatever
      window is chosen. `scout-image-gc-daily` prunes only `.png`/`.svg`, keeping JSON, but
      that has not been verified against an actual retention policy.

## Human Verification

The choice of training window changes model behaviour for every Scout report that infers
lanes, so it needs an owner decision rather than an agent default.

## Comment Log

- 2026-08-14: Filed while fixing the misdirected lane-prior write. Deliberately kept out of
  that PR — the path bug is a correctness fix with a clear right answer; this is a modelling
  decision with trade-offs.
