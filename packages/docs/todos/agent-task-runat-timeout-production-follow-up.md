---
id: agent-task-runat-timeout-production-follow-up
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/completed/2026-07-30_agent-task-runat-timeout-fix.md
---

# Verify the agent-task `runAt` fix in production

The durable scheduler fix is complete, but its real-server behavior and the
replacement runs require a deployed worker and cluster-authorized Temporal
access. Keep these checks visible on the active board rather than treating the
implementation plan as fully verified.

## Remaining

- [ ] After the fixed worker image deploys, submit a one-off task with
      `runAt` approximately five minutes in the future and verify it remains
      buffered, then starts and completes without a timeout.
- [ ] Run the four relevant Part 2 report-only backfill submissions from the
      originating plan, skipping the stale 2026-07-11 task.
- [ ] Verify every replacement run completes, each report email arrives, and
      `temporal-failure-watch` emits no failure alert for the replacement runs.

## Comment Log

- Split from the completed implementation plan because all checks require a
  deployed worker and privileged production access.
