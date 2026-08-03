---
id: scout-paper-26-2-schedule-registration
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/logs/2026-08-02_main-ci-green-session.md
source_marker: false
---

# Register the Scout Paper 26.2 plugin-compatibility recheck schedule

## Problem

[`2026-08-02_main-ci-green-session.md`](../logs/2026-08-02_main-ci-green-session.md)
documents a held Paper 26.2 bump (EssentialsX core and LevelledMobs reject the
`26.x` version scheme) and carries a `temporal-agent-task` HTML block
(report-only, monthly cron, `scheduleId: scout-paper-26-2-plugin-recheck`)
meant to recheck plugin compatibility over time.

Per root `AGENTS.md` § Temporal Agent Follow-ups, that block only documents
the follow-up — `packages/temporal/scripts/schedule-agent-task.ts` has no
document watcher and only calls `startOrScheduleAgentTask` when an operator
invokes it directly. Registering the schedule therefore requires a local
operator with access to a live Temporal server (`TEMPORAL_ADDRESS=
localhost:7233`), which is out of scope for a docs-only PR to run. Without
this todo, the log closing as `status: complete` / `board: false` would leave
that operator prerequisite with no active workboard record, and the monthly
recheck would never actually run.

## Remaining

- [ ] Run, as an operator with local Temporal access:

  ```bash
  cd packages/temporal
  TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts \
    --from-doc ../../packages/docs/logs/2026-08-02_main-ci-green-session.md
  ```

- [ ] Confirm the schedule was created (Temporal Web UI, or
      `temporal schedule describe --schedule-id scout-paper-26-2-plugin-recheck`)
      and record the confirmation here.
- [ ] Archive this todo once the schedule is confirmed live and running.

## Comment Log

- 2026-08-03 — Filed from PR #1966 review feedback (chatgpt-codex-connector,
  P2): a prior revision added a "not yet registered" note directly in the log,
  but Codex correctly pointed out that a `status: complete` / `board: false`
  log gives that operator prerequisite no active workboard record. This todo
  is the tracked item that owns actually registering the schedule.
