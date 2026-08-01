---
id: glitter-context-refresh-schedule-unpause
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/plans/2026-07-27_glitter-corpus-live-rollout.md
source_marker: false
---

# Operator unpause for the Glitter weekly context-refresh schedule

## Context

`packages/temporal/src/schedules/register-schedules.test.ts:281-287`
(`preserves the operator unpause after acceptance`) asserts that
`glitter-context-refresh-weekly` only transitions from `paused: true` to
`paused: false` through an explicit operator action — the schedule
configuration itself never flips it. The live rollout plan
(`packages/docs/plans/2026-07-27_glitter-corpus-live-rollout.md`) and the
credentials TODO (`packages/docs/todos/glitter-corpus-worker-credentials.md`)
previously routed straight from agent-verified post-merge smoke checks into
"deliberately unpause the schedule" as if it were another agent-completable
step. This TODO splits that privileged production mutation out as its own
operator-gated item so the parent documents cannot present it as agent-
verifiable.

## Remaining

- [ ] Confirm the V2 data PR (tracked in
      `packages/docs/plans/2026-07-29_glitter-style-card-v2.md`) is merged,
      PR #1834 is closed as superseded, and merged-main plus production
      consumer smoke checks are green.
- [ ] As an operator, unpause `glitter-context-refresh-weekly` in the Temporal
      Web UI (`https://temporal-ui.tailnet-1a49.ts.net` → Schedules → pause
      toggle; see `packages/temporal/AGENTS.md`).
- [ ] Verify the schedule's next scheduled action and clean
      corpus/context-refresh observability after the unpause.
- [ ] Mark this TODO complete and archive it alongside the parent plan and
      credentials TODO.

## Comment Log

- 2026-07-31 — Filed from the live rollout plan and credentials TODO (Codex P2
  review finding on PR #1836: the schedule unpause was bundled into agent
  verification instead of routed to the operator boundary the schedule config
  test already requires).
