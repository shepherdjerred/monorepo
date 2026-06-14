# Temporal health check — 2026-06-14

## Status

Complete

## Goal

Survey Temporal worker, server, schedules, last-14-day workflow outcomes,
Bugsink intake, and live pod logs to answer "are all workloads healthy?"

## Findings

### Pods (all Running, no recent crashes)

| Pod                        | Restarts | Last restart |
| -------------------------- | -------- | ------------ |
| `temporal-temporal-server` | 0        | 16h ago      |
| `temporal-temporal-ui`     | 0        | 16h ago      |
| `temporal-postgresql-0`    | 0        | 16h ago      |
| `temporal-redis-master-0`  | 0        | 16h ago      |
| `temporal-temporal-worker` | 0        | 10h ago      |
| `bugsink`                  | 6        | 16h ago      |
| `bugsink-postgresql-0`     | 0        | 16h ago      |

Bugsink last termination was `exit 137` (OOMKill) 16h ago. Currently using
242 MiB; stable but worth watching.

### 14-day workflow outcomes

```
Completed:        932
Failed:           120
Terminated:       184
TimedOut:          66
Running:            1   (pr-review-reaction-listener)
ContinuedAsNew:     8
```

### Breakdown of non-Completed by workflow type

| Status     | Workflow                            | Count |
| ---------- | ----------------------------------- | ----- |
| Failed     | `cancelBuildkiteBuildsWorkflow`     | 111   |
| Failed     | `agentTaskWorkflow` (homelab-audit) | 8     |
| Failed     | `prReviewPipeline`                  | 1     |
| Terminated | `alertRemediationChildWorkflow`     | 184   |
| TimedOut   | `alertRemediationSweepWorkflow`     | 63    |
| TimedOut   | `alertRemediationChildWorkflow`     | 2     |
| TimedOut   | `syncGolinks`                       | 1     |

### Per-system diagnoses

1. **alert-remediation — actively broken (top priority).**
   - Hourly sweep keeps hitting its 2h `workflowExecutionTimeout`. Children
     get Terminated en masse when the sweep dies (~25/day, steady-state for
     the full 14 days).
   - Each `runAlertRemediationAgent` activity is being SIGTERM'd at
     `startToCloseTimeout: "30 minutes"` (`workflows/alert-remediation.ts:48`).
     Worker logs show `Error: alert-remediation agent exited with code 143`
     with `durationMs: ~1834000`.
   - Of the last 30 _Completed_ child workflows, **30/30 returned
     `decision: "failed"`** — the workflow exited cleanly but the agent
     never reached a remediation decision. No PRs are being opened.
   - The latest 5 hourly sweeps: TimedOut, TimedOut, TimedOut, Completed,
     TimedOut. Today's `alert-remediation-hourly-workflow-2026-06-14T15:00:00Z`
     timed out at 17:00 with 100 events recorded.

2. **homelab-audit-daily — failed 2 days running.**
   - `runAgentTask` activity hits its 45-minute `startToCloseTimeout`
     (`schedules/register-schedules.ts:74` sets `agentTimeoutMinutes: 45`).
   - Today's run started 2026-06-14T13:30:00Z, activity timed out at
     14:15:24Z (exactly 45 min).
   - 8/14 daily runs failed in the period. The runbook agent is genuinely
     taking too long, or stalling.

3. **cancelBuildkiteBuildsWorkflow — fixed.**
   - 111 failures concentrated 2026-06-07 → 2026-06-13:
     `Error: BUILDKITE_API_TOKEN is required to cancel Buildkite builds`.
     (Matches the `feedback_no_optional_secrets.md` memory.)
   - Worker env now has `BUILDKITE_API_TOKEN` set; latest runs in the last
     10h all Completed.

4. **prReviewPipeline — isolated.** One failure on 2026-06-07
   (heartbeat timeout). Not recurring.

5. **syncGolinks — isolated.** One timeout. Schedule fires daily and the
   last 7 have succeeded.

### Schedules

All 23 schedules are scheduled and firing (2 paused by design:
`pr-review-ab-weekly-report`, `pr-review-eval-nightly`). Last-run times look
healthy except for `alert-remediation-hourly` which "completes" every hour
but always with timed-out children.

### Bugsink

- API REST endpoints other than ingest are `/api/0/projects/` →
  `Unimplemented` (matches `reference_bugsink_resolve_via_ui.md`).
- Logs show normal `ingest.tasks.digest` + nightly `tags.tasks.vacuum_*`
  jobs running cleanly.
- 6 restarts in 41h; last one was OOM (exit 137) 16h ago, all since then
  have been graceful (exit 0 or 1). Could use a small memory bump.

### Live pod log scan (24h)

`birmel`, `scout-for-lol`, `discord-plays-pokemon`, `discord-plays-mario-kart`,
`starlight-karma-bot`, `home-assistant` — all clean on the ERROR/FATAL/Exception
filter (some have unrelated high restart counts: mario-kart 11, plex 14,
starlight-karma 11, postal-worker 11, status-page 8 — outside this audit's
scope).

## Summary

**Temporal infra is healthy. Two business-level workflows are broken in
prod:**

1. `alertRemediationSweepWorkflow` — every run for at least 14 days has
   either timed out or recorded all-failed children. Bugsink alerts are not
   being acted on. Investigate why `runAlertRemediationAgent` (claude -p)
   exceeds 30 min, and whether the sweep should fan out concurrently.
2. `agentTaskWorkflow` for `homelab-audit-daily` — last two days timed out
   at the 45-min activity boundary. The audit runbook is taking too long.

Buildkite-cancel and pr-review-pipeline failures are now resolved or
isolated.

## Session Log — 2026-06-14

### Done

- Walked all Temporal pods + restart history (`kubectl describe`,
  `kubectl logs`).
- Inventoried 14-day workflow outcomes via `temporal workflow count` /
  `workflow list` per status, grouped by type.
- Inspected representative failing instances per workflow type
  (`temporal workflow show`).
- Cross-checked Bugsink intake logs and confirmed REST API is read-only
  (per existing memory).
- Confirmed `BUILDKITE_API_TOKEN` is now present in worker env (root cause
  of 111 cancel-BK failures is now fixed).
- Scanned non-temporal namespace pods for current errors.
- Wrote this log.

### Remaining

- **alert-remediation root-cause investigation** — why is the agent
  always hitting the 30-min cap? Possibilities: bugsink alert payloads are
  too large for the claude prompt, the agent is looping, or
  `--max-turns` is too high. Look at `activities/alert-remediation.ts`
  and recent agent stderr lines.
- **homelab-audit-daily timeout** — either raise `agentTimeoutMinutes`,
  trim the runbook, or have the agent return partial results before the
  cap. The audit ran successfully as recently as 2026-06-09; bisect
  changes since then.
- **Bugsink** — give the pod a higher memory limit; OOMKill 16h ago is a
  symptom even though current usage is benign.

### Caveats

- The 30 most-recent "Completed" alert-remediation children all carry
  `decision: "failed"` — they reported "Activity task timed out" as the
  decision reason. Counting only Temporal exec status would make these
  look fine; surface the `decision` field in any future health gate.
- Bugsink REST API can list projects/issues only via Sentry-compat
  ingestion endpoints; assessment here is via worker logs + intake logs,
  not direct issue queries. Use the web UI for issue triage.
- The 2h sweep workflow timeout + 30 min child activity timeout means
  even 4 sequential children exhaust the parent budget — concurrency
  fan-out is probably needed regardless of agent runtime.
