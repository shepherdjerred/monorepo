---
id: reference-completed-2026-06-19-alert-remediation-throttle-daily
type: reference
status: complete
board: false
---

# Throttle alert-remediation: hourly → once a day

## Context

`alert-remediation-hourly` (Temporal schedule, cron `0 * * * *`, `AGENT_TASK` queue)
fans out PagerDuty/Bugsink alerts to a `claude -p` agent every hour. Per the
2026-06-19 investigation
(`packages/docs/logs/2026-06-19_bugsink-temporal-checkin-alert-remediation-hang.md`),
**every run currently hangs to its 30-min activity timeout** (100% failure, zero
remediations, ~50 dead opus subprocesses/day, 228 duplicate Bugsink issues).

Rather than disable it outright, drop the cadence to **once a day** (08:00 PT). This
cuts the blast radius ~24× while the underlying `claude -p` startup hang is
investigated separately, and keeps the workflow live so it resumes useful work once
the hang is fixed.

## Change

`packages/temporal/src/schedules/register-schedules.ts`:

1. Renamed the `SCHEDULES` entry `id`: `alert-remediation-hourly` →
   `alert-remediation-daily`; `cronExpression` `0 * * * *` → `0 8 * * *`; memo
   "Hourly …" → "Daily … (08:00 PT)". `args` (concurrency 3, maxTurns 15) and
   `workflowExecutionTimeout: "2 hours"` unchanged.
2. Added `alert-remediation-hourly` to `DELETED_SCHEDULE_IDS`. Temporal keys
   schedules by id, so the renamed schedule is a _new_ schedule — without this the
   old hourly schedule would keep firing as an orphan. The startup delete loop
   removes it.

`packages/docs/architecture/2026-06-06_temporal-worker-and-scheduler.md`:
updated the two `alert-remediation-hourly` references (component bullet + "Notable
IDs" list) to the new id/cron. Historical `logs/` and `archive/` references left as-is.

## Verification

```bash
cd packages/temporal
bun run typecheck
bun run test            # schedules + workflow-bundle smoke test
```

Post-deploy (takes effect when the worker pod redeploys and `registerSchedules`
runs on startup): in the Temporal UI / CLI, confirm `alert-remediation-hourly` is
gone and `alert-remediation-daily` exists with spec `0 8 * * *`
(`America/Los_Angeles`). No new hourly `alert-remediation-*` executions after deploy.

## Out of scope

- Fixing the `claude -p` startup hang (separate investigation; the real bug).
- Bulk-resolving the 228 duplicate Bugsink issues (web-UI bulk action — see the
  `reference_bugsink_resolve_via_ui` memory).
- The non-firing `AlertRemediationDecisionsAllFailing` page and SIGINT/`maxIdleMs`
  observability gaps noted in the hang log.

## Session Log — 2026-06-19

### Done

- `register-schedules.ts`: renamed `alert-remediation-hourly` →
  `alert-remediation-daily`, cron `0 * * * *` → `0 8 * * *`, updated memo; added
  `alert-remediation-hourly` to `DELETED_SCHEDULE_IDS` so the orphaned hourly
  schedule is deleted on worker startup.
- Updated the two id/cron references in
  `packages/docs/architecture/2026-06-06_temporal-worker-and-scheduler.md`.

### Remaining

- Open PR, get CI green, merge.
- After the worker redeploys, verify in Temporal UI that the hourly schedule is
  gone and the daily one exists (cron `0 8 * * *`).

<!-- temporal-agent-task
{
  "title": "Verify alert-remediation-hourly is gone and alert-remediation-daily is active",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-06-21T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/plans/2026-06-19_alert-remediation-throttle-daily.md"
  },
  "prompt": "Post-deploy verification for the alert-remediation throttle change (PR #1279). Check the Temporal UI / CLI: (1) confirm that the schedule `alert-remediation-hourly` no longer exists; (2) confirm that `alert-remediation-daily` exists, is active, and has cron spec `0 8 * * *` (America/Los_Angeles). Email the result with evidence (schedule list output or UI screenshots). Do NOT edit files or mutate any system state."
}
-->

### Caveats

- Existing tests cover this transparently (`register-schedules.test.ts` keys timeout
  checks off `workflowType`, and the `DELETED_SCHEDULE_IDS` test asserts deleted ids
  aren't active — both stay green). No new test added.
- This does not fix the underlying hang; daily runs will still fail until the
  `claude -p` startup hang is resolved — it only reduces frequency/blast radius.
