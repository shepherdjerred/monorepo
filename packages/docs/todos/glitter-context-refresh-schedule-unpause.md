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
step. This TODO splits out only that privileged production mutation as its
own operator-gated item.

This TODO covers the unpause toggle itself and nothing else. The V2
data-PR merge, PR #1834 closure, and merged-main/production consumer smoke
checks that gate the unpause are deterministic and stay agent-verified in the
parent plan's own checklist. Likewise, the post-unpause schedule-state and
observability verification is a deterministic check, not a privileged
mutation, so it stays with the agent-owned parent plan (see its
`## Implementation` entry that hands off here and resumes after the operator
acts) rather than being duplicated in this blocked TODO.

## Remaining

- [ ] As an operator, once the parent plan's pre-unpause gates are green (V2
      data PR merged, PR #1834 closed as superseded, merged-main and
      production consumer smoke checks passed — verified in
      `packages/docs/plans/2026-07-27_glitter-corpus-live-rollout.md`),
      unpause `glitter-context-refresh-weekly` in the Temporal Web UI
      (`https://temporal-ui.tailnet-1a49.ts.net` → Schedules → pause toggle;
      see `packages/temporal/AGENTS.md`).
- [ ] Mark this TODO complete once the unpause is confirmed live; the parent
      plan owns verifying the schedule's next action, observability, and
      archival afterward.

## Comment Log

- 2026-07-31 — Filed from the live rollout plan and credentials TODO (Codex P2
  review finding on PR #1836: the schedule unpause was bundled into agent
  verification instead of routed to the operator boundary the schedule config
  test already requires).
- 2026-07-31 — Trimmed this TODO to the unpause toggle only; moved the
  deterministic pre-unpause gate confirmation and post-unpause
  schedule/observability verification back to the agent-owned parent plan so
  routine checks don't sit behind the operator boundary (Codex P2 finding on
  PR #1836).
