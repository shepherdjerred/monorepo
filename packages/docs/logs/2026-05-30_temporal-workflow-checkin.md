---
id: log-2026-05-30-temporal-workflow-checkin
type: log
status: complete
board: false
---

# Temporal Workflow Check-In — 2026-05-30

## Scope

Checked Temporal workflow and schedule status for the prior week window starting `2026-05-23T00:00:00-07:00`.

## Evidence

- `kubectl get pods -n temporal -o wide`
- `kubectl exec -n temporal deploy/temporal-temporal-worker -- temporal --address temporal-temporal-server-service:7233 --namespace default workflow list --limit 1000 --query "StartTime >= '2026-05-23T00:00:00-07:00'"`
- `kubectl exec -n temporal deploy/temporal-temporal-worker -- temporal --address temporal-temporal-server-service:7233 operator namespace describe --namespace default`
- `kubectl exec -n temporal deploy/temporal-temporal-worker -- temporal --address temporal-temporal-server-service:7233 --namespace default schedule list`
- `kubectl logs -n temporal deployment/temporal-temporal-worker --since=36h`

## Findings

The Temporal namespace retains closed workflow history for only 24 hours and archival is disabled:

```text
Config.WorkflowExecutionRetentionTtl  24h0m0s
Config.HistoryArchivalState           Disabled
Config.VisibilityArchivalState        Disabled
```

Exact retained workflow executions in the queried window: 38.

| Status           | Count |
| ---------------- | ----: |
| Completed        |    34 |
| Continued as new |     1 |
| Running          |     1 |
| Failed           |     1 |
| Timed out        |     1 |

Retained non-green executions:

| Workflow                                               | Status    | Root Cause                                                                                                                                                                             |
| ------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-review-eval-nightly-workflow-2026-05-30T11:00:00Z` | Failed    | `simple-git` rejected `GIT_ASKPASS`: `Use of "GIT_ASKPASS" is not permitted without enabling allowUnsafeAskPass` in `prReviewEvalLoadCorpus`.                                          |
| `homelab-audit-daily-workflow-2026-05-30T13:30:00Z`    | Timed out | `runAgentTask` exceeded its 90 minute `startToCloseTimeout`, retried once, then hit the 2 hour workflow execution timeout. Logs show the Claude subprocess was killed on cancellation. |
| `pr-review-reaction-listener`                          | Running   | Expected long-running listener. Previous run continued as new normally.                                                                                                                |

Schedule recent-actions extend farther back than retained workflow history, but only as a bounded recent summary. Within those recent actions:

- `homelab-audit-daily`: 1 failed and 4 timed out from May 26-30.
- `pr-review-eval-nightly`: 5 failed from May 26-30.
- `pr-review-ab-weekly-report`: failed on May 25, but exact history is expired.
- `bugsink-housekeeping`: failed on May 29 because Bugsink Postgres refused connections; May 30 completed and Bugsink pods/endpoints are currently healthy.
- `scout-data-dragon-weekly-refresh`: failed once and was terminated once on May 23; May 30 completed.
- `good-morning-weekday-early`: two terminated recent actions on May 25-26; exact histories are expired, and later morning routines completed.

## Fixes Needed

1. Fix `prReviewEvalLoadCorpus` fixture cloning. Replace the `simple-git().env({ GIT_ASKPASS })` clone/fetch path with the repo's existing `Bun.spawn(["git", ...])` askpass pattern, or explicitly configure `simple-git` with the supported unsafe askpass opt-in if keeping that library.
2. Fix the daily homelab audit runtime. The current report-only Claude task does not reliably finish within the 90 minute activity window. Either bound the run much harder, split the audit into smaller scheduled sections, switch to a faster provider/model, or increase the activity/workflow timeout only after making partial-report behavior reliable.
3. Increase Temporal default namespace retention if weekly check-ins should be exact. The namespace init code still says `--retention 72h`, but the live namespace is `24h`; either update/reconcile the namespace to at least `168h` or enable archival.
4. Investigate `pr-review-ab-weekly-report` from code/logs, not Temporal history, because the May 25 execution has expired.
5. Treat `bugsink-housekeeping` as recovered unless it recurs; latest run completed and current Bugsink Postgres endpoint is healthy.

## Session Log — 2026-05-30

### Done

- Queried live Temporal via `kubectl exec` from the worker pod after confirming the tailnet gRPC service is not exposed and `kubectl port-forward` cannot attach to the server because it does not listen on loopback.
- Summarized retained workflow executions and schedule recent-actions for the last-week window.
- Identified root causes for the currently retained failed and timed-out workflows.
- Verified Bugsink housekeeping recovered on the next run.

### Remaining

- Implement the PR eval fixture clone fix in `packages/temporal/src/activities/pr-review-eval/load.ts`.
- Rework `homelab-audit-daily` so it produces a bounded partial report before Temporal cancellation.
- Reconcile Temporal namespace retention to match the desired weekly audit horizon.
- Investigate the expired May 25 `pr-review-ab-weekly-report` failure from code or external logs if needed.

### Caveats

- Exact workflow history older than 24 hours is not available from Temporal because archival is disabled.
- Schedule recent-actions are useful for older statuses but retain only a small action window and can show stale `RUNNING` statuses after the corresponding workflow history has expired.
