---
id: temporal-workflow-failure-pagerduty-alerts
type: plan
status: in-progress
board: false
---

# Temporal workflow failure → PagerDuty alerts (detail-rich)

## Context

Temporal workflow failures already page PagerDuty today, but only through
threshold-based Prometheus rules on the `activity_task_fail` counter
(`packages/homelab/.../monitoring/rules/temporal.ts`, e.g.
`TemporalWorkflowActivityFailing` needs >5 failures in 30m,
`TemporalScheduledWorkflowFailingDaily` needs ≥2 in 48h). Two problems with
that as an "any failure" mechanism:

1. **It's threshold/rate-based, not per-failure.** A workflow that fails once
   and never again (or fails twice, 47 hours apart) may never page.
2. **No per-failure detail.** Prometheus alert annotations can only template
   from label values on the series, and `activity_task_fail` only carries
   `namespace`/`workflowType`/`activityType` — no error message, no
   workflow/run id, no link to the specific failed execution. Putting the
   actual failure message on the metric as a label isn't viable (unbounded
   cardinality).

The ask: **every failed execution**, with the actual error and a direct
link, in one alert definition — not per-workflow Prometheus rules to
hand-maintain.

That requires reading the failure out of Temporal itself (workflow history),
which Prometheus/Alertmanager can't do. So this plan adds a **polling
Temporal workflow** — the same shape as the existing
`review-signals-collect` schedule (poll a source of truth every N minutes,
no persisted checkpoint, rely on idempotent identity for safe overlap) — that
lists recently-failed workflow executions via the visibility API, pulls the
structured failure (type, message, stack) via `handle.result()`, and posts
one detail-rich alert per execution to Alertmanager, which already has a
`pagerduty` receiver wired up (`severity =~ "critical|warning"` routes there
— see `packages/homelab/.../argo-applications/prometheus.ts:280-329`). This
reuses the existing PD integration key/receiver — no new PagerDuty service or
routing key needed. It mirrors the one place in this repo that already does
exactly this trick for a non-Prometheus source:
`packages/temporal/src/event-bridge/xcode-cloud-webhook.ts` (builds a
synthetic `AlertmanagerAlert` and POSTs to Alertmanager's `/api/v2/alerts`).

**Decided:** no exclusion list — literally any failed/timed-out workflow
execution pages, including `prReview`/`prSummary`. Revisit with an exclusion
list later if that proves too noisy.

## Design

**Failure definition:** `ExecutionStatus IN ("Failed", "TimedOut")`.
Excludes `Terminated`/`Cancelled` (deliberate operator actions, not
malfunctions).

**Cadence / lookback / dedup — stateless, like `review-signals-collect`:**
No checkpoint is persisted. Each poll queries executions that closed in the
last **15 minutes**, on a **5-minute** cron (3× overlap so a single missed
tick or worker restart can't create a gap). The same failed execution will
typically be seen by 2-3 consecutive polls — this is safe and intentional:
Alertmanager identifies an alert by its label set, so as long as every poll
of the _same_ execution produces the _same_ labels (`alertname`,
`workflowType`, `taskQueue`, `workflowId`, `runId`), Alertmanager just
extends the same firing alert / PagerDuty incident rather than re-paging.
`startsAt` = poll time, `endsAt` = poll time + TTL, so the alert
auto-resolves in Alertmanager if polling ever stops seeing it (matches the
`xcode-cloud-webhook.ts` `buildAlert` TTL trick exactly). TTL default: 6h,
matching `XCODE_CLOUD_ALERT_TTL_SECONDS`'s existing rationale ("keeps a
failure visible across a workday without lingering") — new env var
`TEMPORAL_FAILURE_ALERT_TTL_SECONDS`, optional, same parse/validate pattern
as `readTtlMs()` in `xcode-cloud-webhook.ts:246-258`.

**Getting the actual failure detail:** `client.workflow.list({ query })`
(the visibility API) returns `workflowId`/`runId`/`type`/`taskQueue`/`status`/
`closeTime` per execution but _not_ the failure payload. For each match,
call `client.workflow.getHandle(workflowId, runId).result()` — since the
execution is already closed as Failed/TimedOut, this rejects immediately
with `WorkflowFailedError` (`@temporalio/client`), whose `.cause` is the
structured `TemporalFailure` (`ApplicationFailure`/`ActivityFailure`/
`TimeoutFailure`/etc. from `@temporalio/common`) carrying `.name`, `.message`,
and `.stack`. This is what makes the alert "specific" — the same
type/message/stack you'd see in the Temporal UI.

**One alert per failed execution**, posted via the existing
`AlertmanagerAlert`/`AlertPoster`/`createAlertmanagerPoster` machinery,
**extracted** from `xcode-cloud-webhook.ts` into a new shared module
`src/lib/alertmanager.ts` (pure types + the `fetch`-based poster; second
consumer justifies pulling it out of `event-bridge/`). `xcode-cloud-webhook.ts`
switches to importing from there instead of defining its own copy.

Alert shape:

- `labels`: `{ alertname: "TemporalWorkflowFailed", severity: "warning", workflowType, taskQueue, workflowId, runId }`
- `annotations.summary`: `Temporal workflow {workflowType} failed: {failureType}: {message, truncated}`
- `annotations.description`/`message`: workflowId, runId, taskQueue, closeTime, failure type, full message, a trimmed stack excerpt
- `generatorURL`: `https://temporal-ui.tailnet-1a49.ts.net/namespaces/default/workflows/{workflowId}/{runId}/history` — a direct link to the failed run, not just "check the Temporal UI"

**Partial-failure tolerance:** mirror `observe-review-signals.ts`
(`observeOnePr`) — a single execution's `.result()`/detail-extraction
failing is caught, logged, Sentry-captured, and skipped; it does not fail
the whole poll. If **every** match in a non-empty batch fails to resolve,
the activity throws (so Temporal retries and the underlying condition
surfaces via the existing generic `activity_task_fail` alerts as a
fallback).

## Files

- **`src/lib/alertmanager.ts`** (new) — `AlertmanagerAlert` type, `AlertPoster`
  type, `createAlertmanagerPoster(baseUrl)`, moved out of
  `src/event-bridge/xcode-cloud-webhook.ts` (which then imports from here).
- **`src/shared/workflow-failure-alert.ts`** (new) — pure alert builder,
  no I/O: `buildWorkflowFailureAlert(execution, failure, now, ttlMs): AlertmanagerAlert`.
  Kept pure/testable like `src/shared/review-signals.ts`, and safe to import
  from workflow code per the pattern documented in this package's `CLAUDE.md`
  and enforced by `src/workflows/bundle.test.ts`.
- **`src/activities/workflow-failure-watch.ts`** (new) — the I/O activity:
  `createTemporalClient()` (`#client.ts`, already handles connection reuse),
  `client.workflow.list({ query: 'ExecutionStatus IN ("Failed","TimedOut") AND CloseTime > "<lookback ISO>"' })`,
  per-execution `getHandle(...).result()` catch → build alert via the shared
  helper → `createAlertmanagerPoster(Bun.env["ALERTMANAGER_URL"])`. Exported
  as `workflowFailureWatchActivities = { async pollWorkflowFailures() {...} }`,
  registered in `src/activities/index.ts` (one import + one spread line,
  same pattern as `observeReviewSignalsActivities`).
- **`src/workflows/workflow-failure-watch.ts`** (new) — thin `proxyActivities`
  wrapper, no logic, matching every other workflow file's shape.
- **`src/workflows/index.ts`** — add the aliased-import + thin wrapper export
  (`pollWorkflowFailuresWorkflow`), same pattern as
  `observeReviewSignalsWorkflow` (lines 61-65, 252-256).
- **`src/schedules/register-schedules.ts`** — new `SCHEDULES` entry:
  `id: "temporal-failure-watch"`, `workflowType: "pollWorkflowFailuresWorkflow"`,
  `cronExpression: "*/5 * * * *"`, `taskQueue: TASK_QUEUES.DEFAULT`,
  `overlap: ScheduleOverlapPolicy.SKIP`, `workflowExecutionTimeout: "3 minutes"`,
  `memo` describing it.
- **`src/observability/metrics.ts`** — one new counter,
  `temporalFailureWatcherAlertsTotal` (`labelNames: ["workflowType"]`),
  incremented per alert posted, same style as `haEventBridgeStartFailuresTotal`.
  (The watcher's _own_ failures are already covered by the existing generic
  `activity_task_fail`-based Prometheus rules — no special-casing needed, and
  since it's on a tight 5-min `SKIP`-overlap schedule it's self-healing: a
  later successful poll re-observes and reports its own earlier failed run.)
- **`packages/temporal/CLAUDE.md`** — document the new schedule + confirm
  `ALERTMANAGER_URL` is now used by two features (Xcode Cloud webhook +
  this watcher).

## Tests

- `src/shared/workflow-failure-alert.test.ts` — pure builder, fixed clock,
  table-driven cases (Failed vs TimedOut, message truncation, stack
  trimming), mirroring the fixture/golden style in
  `xcode-cloud-webhook.test.ts`.
- `src/activities/workflow-failure-watch.test.ts` — inject a fake Temporal
  client (`list`/`getHandle().result()`) and a `capturingPoster()` (same
  helper style as `xcode-cloud-webhook.test.ts:61-68`); cover: multiple
  failures → multiple alerts, one execution's detail-fetch throwing → skipped
  - others still posted, all executions throwing → activity throws.
- Workflow-bundle smoke test (`src/workflows/bundle.test.ts`) must still
  pass — confirms nothing Node/client-only leaked into the workflow sandbox
  import graph.

## Verification

1. `bunx turbo run typecheck test lint --filter=@shepherdjerred/temporal`.
2. Local dry run against a real dev Temporal server (port-forward
   `TEMPORAL_ADDRESS` to `localhost:7233`), trigger a workflow that will
   fail, then invoke the new workflow directly via a small one-off script to
   confirm the visibility query matches and the failure detail extraction
   produces a sane message/stack.
3. Once merged, watch for the first real `TemporalWorkflowFailed` alert in
   Alertmanager and confirm it reaches PagerDuty with the expected
   summary/description/link.

## Remaining

- [x] Extract `AlertmanagerAlert`/`AlertPoster`/`createAlertmanagerPoster` into `src/lib/alertmanager.ts`; repoint `xcode-cloud-webhook.ts`
- [x] Add pure builder `src/shared/workflow-failure-alert.ts` + tests
- [x] Add activity `src/activities/workflow-failure-watch.ts` + metric + tests; register in `src/activities/index.ts`
- [x] Add workflow wrapper + `SCHEDULES` entry; confirm `bundle.test.ts` passes
- [x] Update `packages/temporal/AGENTS.md`; run focused verify
- [ ] Open PR via git-spice (draft), then promote to ready once CI is green
- [ ] Operator follow-up (not agent-doable from this environment): local dry run against a live dev Temporal server (`TEMPORAL_ADDRESS=localhost:7233` port-forward) to confirm the visibility query and failure-detail extraction against a real failed execution, before/alongside the first live poll after merge

## Session Log — 2026-07-30

### Done

- Explored existing PagerDuty/Alertmanager wiring (`packages/homelab/.../argo-applications/prometheus.ts`, `.../monitoring/rules/temporal.ts`) and the one existing non-Prometheus Alertmanager producer (`xcode-cloud-webhook.ts`).
- Confirmed the Temporal TS SDK client APIs needed (`client.workflow.list`, `getHandle().result()` → `WorkflowFailedError.cause`) and the repo's activity/workflow/schedule/metrics registration patterns via a targeted Explore pass.
- Asked and resolved the one open design fork with the user (no exclusion list — page on every failure).
- Wrote and got approval for this plan in `~/.claude/plans/precious-exploring-stearns.md`, now mirrored here.
- Set up worktree `.claude/worktrees/temporal-failure-alerts` on branch `feature/temporal-failure-alerts`.
- Implemented every file in the Files section above:
  - `src/lib/alertmanager.ts` (new), `xcode-cloud-webhook.ts`/`.test.ts` repointed to it.
  - `src/shared/workflow-failure-alert.ts` + `.test.ts` (6 tests).
  - `src/activities/workflow-failure-watch.ts` + `.test.ts` (6 tests), registered in `src/activities/index.ts`.
  - `src/workflows/workflow-failure-watch.ts`, registered in `src/workflows/index.ts`.
  - `temporal-failure-watch` schedule entry (cron `*/5 * * * *`, `TASK_QUEUES.DEFAULT`, `workflowExecutionTimeout: "8 minutes"`).
  - `temporalFailureWatcherAlertsTotal` counter in `src/observability/metrics.ts`.
  - `register-schedules.test.ts`: added `pollWorkflowFailuresWorkflow` to `WORKFLOWS_WITHOUT_LONG_SLEEPS`.
  - `packages/temporal/AGENTS.md`: new "Temporal workflow failure → PagerDuty alerts" section, `ALERTMANAGER_URL`/`TEMPORAL_FAILURE_ALERT_TTL_SECONDS` env docs, Structure diagram + Schedules section updated for the file split below.
- **Unplanned but required**: adding the new counter/schedule entry pushed both `src/observability/metrics.ts` and `src/schedules/register-schedules.ts` over the repo's 500-line ESLint `max-lines` cap (both were already right at the boundary). Root-caused and fixed rather than suppressed, following the existing in-repo precedent (`pr-review-metrics.ts` already sits beside `metrics.ts` the same way):
  - Split the Glitter Discord corpus metrics out of `metrics.ts` into a new sibling `src/observability/metrics-glitter.ts`; updated the 6 consumer files' imports (no re-export from `metrics.ts` — confirmed by hitting `custom-rules/no-re-exports` on the first attempt, then fixing).
  - Split the declarative `SCHEDULES` array + its supporting types/data out of `register-schedules.ts` into a new sibling `src/schedules/schedule-definitions.ts`; updated `register-schedules.test.ts`'s import.
- Full package verification green: `bunx turbo run typecheck lint test --filter=@shepherdjerred/temporal` — 6/6 tasks, 781 tests pass, 0 fail, 0 lint errors (249 pre-existing duplication warnings, unrelated to this change).

### Remaining

- Commit, open a draft PR via git-spice, and watch Buildkite CI to green before requesting review.
- The live-cluster dry run noted above — needs an operator with `TEMPORAL_ADDRESS` port-forward access, which this environment does not have.

### Caveats

- The `custom-rules/no-code-duplication` warnings for `jsonLog`/`requiredEnv`-style boilerplate in the new activity/lib files match this package's existing convention (dozens of other activities carry the same warning) — left as-is, consistent with how the rest of the package already lives with them.
- `temporalUiExecutionUrl` hardcodes the Temporal UI's Tailscale hostname (`https://temporal-ui.tailnet-1a49.ts.net`) rather than reading it from an env var — matches how the same URL is already referenced as a fixed constant in this file's own docs (no existing env var parameterizes it anywhere else in the package).
- No exclusion list, per the user's explicit choice — `prReview`/`prSummary` and other per-invocation-failure workflows will page on every single failure. If this turns out to be too noisy in practice, the fix is a small, config-driven exclusion list (mirroring `CHECK_AND_SKIP_WORKFLOWS` in `packages/homelab/.../monitoring/rules/temporal.ts`) inside `pollWorkflowFailuresOnce`, not a redesign.
