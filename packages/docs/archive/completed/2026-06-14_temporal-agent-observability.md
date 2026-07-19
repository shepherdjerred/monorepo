---
id: reference-completed-2026-06-14-temporal-agent-observability
type: reference
status: complete
board: false
---

# Temporal: schedule fix + agent observability uplift

## Context

Three issues from the 2026-06-14 health check, all in `packages/temporal`:

| #   | Surface                         | Symptom                                                                                                                                                                          | Root cause we actually have evidence for                                                                                                                                                                                |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pokeemerald-wasm-monthly`      | User wants weekly cadence                                                                                                                                                        | n/a — trivial cron change                                                                                                                                                                                               |
| 2   | `homelab-audit-daily`           | `runAgentTask` wall-clock exits at 45-min `startToCloseTimeout` 2 days running. **Zero `agent stderr` log lines** during the entire window.                                      | Unknown. The activity has no internal wall-clock kill, no last-state capture, and `claude -p --output-format json` is normally silent on stderr — so "no stderr" doesn't prove a hang vs. real work. We can't tell yet. |
| 3   | `alertRemediationSweepWorkflow` | Same shape: 30-min activity wall-clock exits, zero stderr, 30/30 recent children carry `decision: "failed", reason: "Activity task timed out"`. We discovered this 14 days late. | Unknown for the same reason. Also: no `alert_remediation_*` metrics or alerts exist, so the failure rate was silent.                                                                                                    |

Existing observability surface (per `packages/temporal/src/observability/`):

- `jsonLog` + `emitOtel` → stdout + OTLP → Loki (with `traceId`/`spanId`/`workflow`/`activity`/`attempt` fields)
- `withSpan` wrapper around OTel; `OTLP_ENDPOINT` → Tempo
- Prom-client `Registry` named `temporal_worker_app_*` on `:9465`
- `captureWithContext` Sentry helper used in `runAgentTask` but **not** in `runAlertRemediationAgent`
- PrometheusRule group `temporal-workflow-failures` + Grafana dashboard `Temporal - Workflows`

The newest activity, `runPrSummaryPipeline` (`packages/temporal/src/activities/pr-review/summary.ts`), already uses all of the above well. The older two `claude -p` activities — `runAgentTask` (homelab-audit) and `runAlertRemediationAgent` — haven't been brought up to that bar. **Bring them up.** Then add alerts + dashboard panels so future regressions page.

## Approach

Single PR. No timeout raises. Three buckets:

### A. Trivial schedule changes

- **Pokemon → weekly** — `packages/temporal/src/schedules/register-schedules.ts:179-190`: cron `"0 6 1 * *"` → `"0 6 * * 1"`, id `pokeemerald-wasm-monthly` → `pokeemerald-wasm-weekly`, memo + adjacent comment lose "monthly" framing. Rename in `packages/docs/architecture/2026-06-06_temporal-worker-and-scheduler.md`. **Operator step** (PR description): one-time `temporal schedule delete --schedule-id pokeemerald-wasm-monthly`.
- **Alert-remediation `maxTurns` 80 → 15** — `packages/temporal/src/shared/alert-remediation.ts:30` default + explicit `maxTurns: 15` at the schedule args (`register-schedules.ts:146-152`). Defense-in-depth; not the primary fix.
- **Drop `WebFetch` from alert-remediation allowed tools** — `packages/temporal/src/activities/alert-remediation-command.ts:10`. Smallest attack surface for the most plausible hang vector.

### B. Bring `runAgentTask` and `runAlertRemediationAgent` up to `summary.ts` observability bar

Apply the same pattern (`packages/temporal/src/activities/pr-review/summary.ts:112-129, 263-272`) to both:

- **Upgrade `jsonLog`** to the trace-context-aware dual-emission version: `console.warn` + `emitOtel`, with `traceId`/`spanId`/`workflow`/`activity`/`attempt`/`component`. Alert-remediation's `jsonLog` at `alert-remediation.ts:85-98` is the old style — replace.
- **Add `withSpan`** wrapping the body of `runAgent`/`runAgentTask`. Span attrs: `agent.provider`, `agent.model`, `agent.max_turns`, `agent.workdir`, plus alert-specific (`alert.source`, `alert.fingerprint`) or audit-specific (`audit.section_count`).
- **Step-boundary `jsonLog` calls** with `phase` + `durationMs` around each sub-step inside the child workflow (the sweep already does these implicitly via activity boundaries, but the agent body itself is a single 30-min opaque box — split it: `phase: "spawn"`, `phase: "exited"`, `phase: "parse"`).
- **Heartbeat log every 10 s** (replaces the silent `Context.current().heartbeat()` at `agent-task.ts:276-278` and `alert-remediation.ts:311-313`). Each beat carries `phase: "agent"`, `elapsedMs`, `lastStderrLine`, `lastStderrAt`, `idleMs` (now − lastStderrAt). Goes to Loki AND as a span event. This is the actual hang detector.
- **Pre-emptive SIGINT at T−90 s** before activity `startToCloseTimeout`. Pass the timeout into the activity; compute the kill deadline; `setTimeout(() => { jsonLog("warn", "agent soft-kill", { elapsedMs, lastStderrLine, idleMs }); span.addEvent("soft-kill"); proc.kill("SIGINT") }, deadlineMs)`. SIGINT lets Claude flush before Temporal's SIGTERM lands; if it doesn't exit within 60 s, the existing cancellation-signal handler upgrades to SIGTERM.
- **Sentry `captureWithContext` for alert-remediation errors** — pattern from `agent-task.ts:106-120`. Mirror into `alert-remediation.ts`; today errors throw without going to Bugsink, so a failing pattern is invisible there too.

### C. Metrics + alerts + dashboard

New metrics in `packages/temporal/src/observability/metrics.ts` (same `Registry` as the existing `agent_task_*` / `homelab_audit_*` families):

| Metric                                          | Type      | Labels                                                                  | Why                                                          |
| ----------------------------------------------- | --------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `alert_remediation_decisions_total`             | Counter   | `decision`, `outcome`, `source` (pagerduty/bugsink)                     | Would have caught "30/30 failed" inside an hour, not 14 days |
| `alert_remediation_subprocess_duration_seconds` | Histogram | `model`, `exit_code`                                                    | Wall-clock distribution per child                            |
| `alert_remediation_subprocess_exit_total`       | Counter   | `exit_code`, `signal`                                                   | SIGTERM/SIGINT vs natural exit                               |
| `alert_remediation_sweep_duration_seconds`      | Histogram | `outcome` (completed/timed_out)                                         | Sweep-level health                                           |
| `alert_remediation_sweep_alerts_total`          | Counter   | `source`, `disposition` (started/skipped_duplicate/skipped_existing_pr) | Sweep input shape                                            |
| `agent_subprocess_idle_seconds`                 | Gauge     | `workflow_type`                                                         | Longest stretch w/o stderr — the hang signal. Reset per run. |
| `agent_subprocess_soft_kills_total`             | Counter   | `workflow_type`, `reason`                                               | Explicit signal of "we sent SIGINT"                          |

New PrometheusRule entries in `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts` (extend the existing `temporal-workflow-failures` group):

- `AlertRemediationDecisionsAllFailing` — `sum(rate(alert_remediation_decisions_total{outcome="failed"}[1h])) / sum(rate(alert_remediation_decisions_total[1h])) > 0.5` for 2 h. Page.
- `AlertRemediationSweepTimingOut` — `increase(alert_remediation_sweep_duration_seconds_count{outcome="timed_out"}[2h]) > 0`. Page.
- `HomelabAuditFailedTwoDays` — `increase(homelab_audit_subprocess_exit_total{exit_code!="0"}[48h]) >= 2`. Page.
- `AgentSubprocessSoftKill` — `increase(agent_subprocess_soft_kills_total[1h]) > 0`. Ticket (not page) — soft-kill is a leading indicator, not necessarily an outage.

Grafana panels in `packages/homelab/src/cdk8s/grafana/temporal-dashboard.ts` (extend, don't replace):

- New row "Agent subprocesses": p50/p95/p99 wall-clock by workflow_type; exit-signal breakdown; soft-kill count; idle-seconds heatmap (the hang panel).
- New row "Alert remediation": decisions stacked-area over time by outcome; per-source sweep volume; per-decision PR-created count.

## Files touched

- `packages/temporal/src/schedules/register-schedules.ts` — pokemon rename/recron; alert-remediation explicit `maxTurns: 15`
- `packages/temporal/src/shared/alert-remediation.ts` — default 80 → 15
- `packages/temporal/src/activities/alert-remediation-command.ts` — drop `WebFetch`
- `packages/temporal/src/activities/alert-remediation.ts` — `jsonLog` upgrade + `withSpan` + step phases + heartbeat-with-stderr + soft-kill + Sentry capture + metric emits
- `packages/temporal/src/activities/agent-task.ts` — `withSpan` + step phases + heartbeat-with-stderr + soft-kill + metric emits (Sentry + jsonLog upgrade already present)
- `packages/temporal/src/observability/metrics.ts` — new histograms/counters/gauges (table above)
- `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts` — four new rules
- `packages/homelab/src/cdk8s/grafana/temporal-dashboard.ts` — two new rows
- `packages/docs/architecture/2026-06-06_temporal-worker-and-scheduler.md` — pokemon rename

## Verification

1. **Local** in worktree:

   ```bash
   cd packages/temporal
   bun run typecheck
   bun test                              # includes workflow-bundle smoke test
   bunx eslint . --fix

   cd ../homelab
   bun run typecheck && bun test         # cdk8s synth covers the rule + dashboard JSON
   ```

2. **Bun unit test** for the soft-kill: spawn `bun -e 'setInterval(() => {}, 1000)'` (process that never exits, never prints), wire it through the same shape as `runAgent`. Assert that within `softKillMs + 200ms`, SIGINT was sent and the worker logged a `phase: "soft-kill"` line with non-zero `elapsedMs`. Co-located with existing activity tests.

3. **Bun unit test** for metric emission: invoke a stubbed `runAgent` against a fake `claude` binary that prints a valid JSON payload to stdout; assert all four `alert_remediation_*` counters/histograms got an observation. Mirrors the existing `runAgentTask` metric tests.

4. **Post-merge** (operator steps in PR description, all read-only commands except the first):
   - `temporal schedule delete --schedule-id pokeemerald-wasm-monthly` once
   - Tail the next hourly sweep, looking for the heartbeat fields `idleMs` (grows when Claude is wedged) and the `phase=soft-kill` line (fires ~28.5 min in if the subprocess didn't exit naturally): `kubectl logs -n temporal deploy/temporal-temporal-worker -f --tail=200 | grep -E 'alert-remediation|"phase":"agent"|soft-kill|"decision":"'`
   - Open the Grafana "Temporal - Workflows" dashboard → "Alert remediation" row. We should see live decision counts inside one sweep cycle.
   - Tomorrow's `homelab-audit-daily` (06:30 PT) — same filter. Look for the first heartbeat where `idleMs` exceeds, say, 60 s; that's the suspect tool call.

5. **24-hour soak**: re-run the workflow inventory from `packages/docs/logs/2026-06-14_temporal-health-check.md`. Confirm that either (a) decisions stop carrying `outcome: "failed"`, or (b) the soft-kill log + idle-seconds gauge tell us exactly what's wedged, so the follow-up PR can address the specific tool.

## What this plan deliberately does NOT do

- **No `agentTimeoutMinutes` or `workflowExecutionTimeout` raise.** We have no evidence justifying it. The observability uplift is the prerequisite for any future timeout call.
- **No prompt rewrites.** Prompts are downstream of "what's actually hanging."
- **No Haiku / SDK rewrite.** Right follow-up once the soft-kill + heartbeat data points at a specific failure mode.
- **No schedule pausing.** Runs are bounded and now metered.

## Out of scope (the follow-up the data will inform)

- Switching `runAlertRemediationAgent` and `runAgentTask` from `claude -p` CLI to the Anthropic SDK (matches `runPrSummaryPipeline`).
- Haiku-for-triage with Opus escalation.
- Bisecting which runbook section / which tool is the long pole.
- Migrating the duplicate `jsonLog` helpers (`agent-task.ts`, `alert-remediation.ts`, `metrics.ts`, `tracing.ts`) into a single shared module under `observability/log.ts`.

## Session Log — 2026-06-14

### Done

- **Pokemon → weekly.** `packages/temporal/src/schedules/register-schedules.ts` (id `pokeemerald-wasm-monthly` → `-weekly`, cron `0 6 1 * *` → `0 6 * * 1`, memo/comment updated). Renamed references in `packages/docs/architecture/2026-06-06_temporal-worker-and-scheduler.md`, `packages/docs/archive/completed/2026-06-06_headless-pokeemerald-stream.md`, and `packages/discord-plays-pokemon/.gitignore`.
- **Alert-remediation max-turns + tool surface.** `packages/temporal/src/shared/alert-remediation.ts` default 80 → 15; explicit `maxTurns: 15` at the schedule args in `register-schedules.ts`. Dropped `WebFetch` from `CLAUDE_ALLOWED_TOOLS` in `packages/temporal/src/activities/alert-remediation-command.ts`.
- **Seven new Prom metrics** in `packages/temporal/src/observability/metrics.ts`: `alert_remediation_decisions_total{decision,outcome,source}`, `alert_remediation_subprocess_duration_seconds{model,exit_code}`, `alert_remediation_subprocess_exit_total{exit_code,signal}`, `agent_subprocess_idle_seconds{workflow_type}`, `agent_subprocess_soft_kills_total{workflow_type,reason}`. (Dropped the planned `sweep_duration_seconds` / `sweep_alerts_total` — Temporal SDK's `temporal_workflow_completed_total` + the child-level decisions metric subsume them.)
- **Shared agent-subprocess module** at `packages/temporal/src/shared/agent-subprocess.ts`: `SOFT_KILL_BEFORE_MS`, `StderrState`, `computeSoftKillDelayMs`, `runTrackedAgentSubprocess` — the spawn-stderr-heartbeat-soft-kill loop now lives in one place, used by both agent activities.
- **`runAlertRemediationAgent` observability uplift** (`packages/temporal/src/activities/alert-remediation.ts`): trace-context-aware `jsonLog` with OTel dual-emit, `captureWithContext` Sentry wrapper, `withSpan` around the run, per-step phase logs (`spawn`/`exited`/`parse`), heartbeat-with-stderr (`elapsedMs`/`lastStderrLine`/`idleMs`), pre-emptive SIGINT at T-90 s.
- **`runAgentTask` observability uplift** (`packages/temporal/src/activities/agent-task.ts`): same withSpan + step phases + heartbeat-with-stderr + soft-kill pattern, calling the shared helper.
- **Splits to satisfy max-lines**: `alert-remediation-find-pr.ts` (existingPrFromSearch + findExistingPr), `alert-remediation-email.ts` (formatOutcome + sendSweepEmail), `agent-task-side-activities.ts` (sendEmail + scheduleFollowUp + pauseSchedule + cleanup), shared dashboard helpers extracted to `packages/homelab/src/cdk8s/grafana/dashboard-panels.ts`.
- **PrometheusRules** (`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts`): `AlertRemediationDecisionsAllFailing`, `AlertRemediationSweepTimingOut`, `HomelabAuditFailedTwoDays`, `AgentSubprocessSoftKill` (info-only ticket).
- **Grafana panels** (`packages/homelab/src/cdk8s/grafana/temporal-dashboard.ts`): two new rows — "Agent subprocesses" (wall-clock p50/p95/p99, exits by signal, max idle seconds, soft-kill count) and "Alert remediation" (decisions over time, per-source volume, PRs created, failed decisions, SIGTERM count).
- **Unit tests** (`packages/temporal/src/shared/agent-subprocess.test.ts`): 10 tests covering `computeSoftKillDelayMs` boundary cases + `StderrState` idle tracking. All pass.

### Remaining

- **Operator steps post-merge** (PR description will repeat):
  - `temporal schedule delete --schedule-id pokeemerald-wasm-monthly` once (orphaned by the rename).
  - Watch the next hourly sweep + tomorrow's `homelab-audit-daily`, filtering Loki for `phase=agent` / `phase=soft-kill` / `decision=`. The heartbeat log is the actual hang detector.
- **24-hour soak**: re-run the workflow inventory from `packages/docs/logs/2026-06-14_temporal-health-check.md` and confirm zero `outcome: "failed"` decisions in the latest 30 children. If the soft-kill log fires repeatedly with the same `lastStderrLine`, that's the diagnostic capture point for the follow-up PR.

### Caveats

- The 3 `temporal integration` test failures in `bun test` require a running local Temporal dev server (not part of this PR's scope). All 538 other tests pass.
- The 15 `helm-template` test failures in `bun test` from `packages/homelab` are pre-existing per `reference_homelab_precommit_helm_template_timeout.md` — flaky on concurrent CI load, retry on real CI.
- The plan originally listed two sweep-level metrics (`alert_remediation_sweep_duration_seconds`, `alert_remediation_sweep_alerts_total`). Dropped during implementation: emitting them cleanly required either a workflow-side activity (over-engineering for what the SDK already exposes) or partial coverage gated on the email-send path. Use the SDK's `temporal_workflow_completed_total{workflow_type="alertRemediationSweepWorkflow",status}` and the per-child `alert_remediation_decisions_total{source}` instead.
- Splitting the activity files into siblings (`*-find-pr.ts`, `*-email.ts`, `*-side-activities.ts`) was forced by the 500-line cap, not by a redesign. Re-exports through the original file (`alert-remediation.ts`) would have been simpler but the `custom-rules/no-re-exports` ESLint rule forbids them; instead the one cross-file consumer (`workflows/alert-remediation.ts`) was updated to import the type from its new home.
