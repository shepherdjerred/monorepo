---
id: agent-task-workflow-broken
status: waiting-on-verification
origin: packages/docs/logs/2026-06-14_protobufjs-v8-pr-1227.md
source_marker: false
---

# Verify `agentTaskWorkflow` recovers after PR #1230 deploys

## What

Live cluster check on 2026-06-14 ~16:40 PT (before PR #1230 deployed):

| Workflow            | Completed | Failed | Notes                                                                                                                             |
| ------------------- | --------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `agentTaskWorkflow` | **0**     | **8**  | every `homelab-audit-daily-workflow-...Z` since 2026-06-07, all `Activity task timed out` (`activity StartToClose timeout`, ~45m) |
| `prReview`          | 0         | 0      | no runs in the visible window — webhook deliveries may not be reaching the worker                                                 |
| `prSummary`         | 0         | 0      | same as `prReview`                                                                                                                |

Non-LLM workflows (`syncGolinks`, `runDnsAudit`, `runBugsinkHousekeepingWorkflow`, `runVeleroOrphanAuditWorkflow`, `alertRemediationSweepWorkflow`) all had 7–10 successful runs and zero failures in the same window — so the Temporal runtime, scheduler, and worker pod are healthy; the LLM activity layer (`runAgentTask` → `claude -p`) was the broken piece.

## PR #1230 landed minutes after this finding was filed

`f1e43e62d feat(temporal): agent-subprocess observability + schedule tuning (#1230)` ships exactly the observability uplift this todo would have asked for:

- shared `runTrackedAgentSubprocess` spawn/track/soft-kill loop used by both `runAgentTask` and `runAlertRemediationAgent`
- heartbeat-with-stderr every 10 s carrying `phase` / `elapsedMs` / `lastStderrLine` / `idleMs`
- pre-emptive `SIGINT` at T−90 s before Temporal's `SIGTERM`, with captured stderr
- trace-context-aware `jsonLog`, `withSpan` on both activities, Sentry capture for alert-remediation
- five new Prom metrics + four new PrometheusRules (`HomelabAuditFailedTwoDays`, `AlertRemediationDecisionsAllFailing`, `AlertRemediationSweepTimingOut`, `AgentSubprocessSoftKill`) + two Grafana rows

**Deliberately NOT done in #1230:** raising `agentTimeoutMinutes` / `workflowExecutionTimeout`. The next homelab-audit-daily run may still time out at ~45m — but now there will be a visible reason in the metrics, soft-kill log, and last stderr line.

## Why it's still open

The current worker pod (`temporal-temporal-worker-77f44bf844-dx7vr`, started ~3 h before #1230 merged) does **not** yet have the fix. The next deploy + the next `homelab-audit-daily` firing on cron (~13 h after this todo was filed) is the first live signal. This todo tracks that verification rather than declaring success.

## Done when

- The post-#1230 worker pod is the running revision (check image SHA on the pod).
- The next `agentTaskWorkflow` execution (`homelab-audit-daily`) either Completes, OR fails with a now-explicit reason captured in heartbeat logs (`lastStderrLine`, `idleMs`, soft-kill record). Both outcomes count — the goal is to end silent failure.
- The Grafana "Agent subprocesses" / "Alert remediation" rows populate with real data inside one sweep cycle.
- `prReview` + `prSummary` either show non-zero recent counts on a real PR, or are explicitly confirmed disabled (separately tracked — PR #1230 doesn't address the webhook bridge).
- 24-hour soak per PR #1230's test plan: zero `outcome: "failed"` in the latest 30 alert-remediation children.

## Pointers

- Tracking commit: `f1e43e62d` (PR #1230).
- Source plan PR #1230 references: `packages/docs/plans/2026-06-14_temporal-agent-observability.md`.
- Sibling health check log: `packages/docs/logs/2026-06-14_temporal-health-check.md`.
- New shared subprocess loop: `packages/temporal/src/shared/agent-subprocess.ts`.
- Alert rules: `packages/homelab/.../rules/temporal.ts`.
- The protobufjs-v8 watch (`packages/docs/todos/protobufjs-v8-watch.md`) depends on this verification — it sits on the same `agentTaskWorkflow` infra and is best-effort until the green-light criteria above are met.

## References

- Live counts captured via `kubectl -n temporal exec temporal-temporal-server-7c6b576c44-gmjjf -- temporal workflow count --query "WorkflowType=\"agentTaskWorkflow\" AND ExecutionStatus=\"<status>\""`.
- Originating session log: `packages/docs/logs/2026-06-14_protobufjs-v8-pr-1227.md`.
