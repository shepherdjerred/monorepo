# Scout for LoL — Fix silent scheduled-report skip + add miss-schedule alert

## Status

In Progress. Implementation complete on branch `feature/scout-report-miss-alert`;
awaiting PR review + merge + ArgoCD sync to `scout-beta`. Scope confirmed: fix
both Bug A and Bug B in one PR; let the alert page once on first deploy as proof
of life; apply alerts to both `scout-beta` and `scout-prod` (single rule, the
`environment` label is global).

## Context

The `scheduled_reports` cron in `scout-beta` runs every minute, completes
in ~80–200 ms, and logs "✅ scheduled_reports completed" — but the **7
COMMON_DENOMINATOR reports have never fired on schedule**. The only entries
in `ReportRun` for them are `trigger=MANUAL`. The user just hit this in beta
and asked us to (a) fix the bug and (b) make sure we'd be paged the next
time a report misses its schedule.

### Root cause (two issues, fix both)

**Bug A — `syncSystemReports` overwrites `nextScheduledRunAt` every minute**
`packages/scout-for-lol/packages/backend/src/reports/system-reports.ts`

- `discord-dispatcher.ts:13` calls `syncSystemReports({ prisma })` _before_
  `runDueReports({ prisma })` on every minute tick.
- For COMMON_DENOMINATOR, the definition built at `system-reports.ts:206`
  unconditionally sets `nextScheduledRunAt = computeNextScheduledUpdateAt(COMMON_DENOMINATOR_CRON, now)`
  — no `?? existing.nextScheduledRunAt` fallback (unlike COMPETITION at
  `system-reports.ts:122` which respects `competition.nextScheduledUpdateAt`).
- `updateSystemReport` (`system-reports.ts:365`) spreads the whole definition
  into the Prisma update → `Report.nextScheduledRunAt` is rewritten on every
  sync.
- Result: at the 18:00 UTC tick, `now=18:00:00.002`, sync recomputes
  `computeNextScheduledUpdateAt("0 18 * * 0", 18:00:00.002)` → returns
  **next Sunday 18:00 UTC** (skips today's fire because we passed it by 2 ms).
  Dispatcher then queries `nextScheduledRunAt <= now`, sees nothing due,
  silently moves on. Confirmed live at 18:00 UTC today — all 7 COMMON_DENOMINATOR
  rows had their `nextScheduledRunAt` bumped from `2026-06-14T18:00:00Z` →
  `2026-06-21T18:00:00Z` with no `ReportRun` row created.

**Bug B — `scheduler.ts:75-86` advances `nextScheduledRunAt` even when `runReport` throws before creating the `ReportRun` row**
A thrown error path silently loses one fire and leaves `lastScheduledRunAt` unchanged.
Not what bit us this time (no error logs), but a real silent-loss class the alert
needs to catch as defense-in-depth.

### Why now

User explicitly asked: "we 100% should receive an alert via PagerDuty for a
report that hasn't run for such a long time/missed its schedule." Today's bug
went undetected for a month — the COMMON_DENOMINATOR reports have been silently
broken since they were seeded on 2026-05-20. Existing alerts in
`monitoring/rules/scout.ts` only catch `scheduled_reports_failed_total` and
runtime — neither fires when the dispatcher never calls `runReport` at all.

## Approach

1. Fix Bug A by treating `nextScheduledRunAt` as scheduler state, not definition
   state — drop it from `updateSystemReport`'s payload; only set it on create
   (and on `cronExpression` change).
2. Fix Bug B by always writing `lastScheduledRunAt = now` in the scheduler regardless
   of whether `runReport` threw, so the freshness metric is truthful.
3. Add a per-report **last-successful-schedule timestamp gauge**, seeded from
   the DB at startup so the alert is meaningful on the first deploy.
4. Add a per-cron-family `PrometheusRule` that pages via PagerDuty when the
   gauge is older than the cron interval + 1h grace.
5. Extend `system-reports.integration.test.ts` and add a new
   `scheduler.integration.test.ts` covering both bugs and the metric.

## Files to change

### Backend — `packages/scout-for-lol/packages/backend/`

| File                                                   | Change                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/reports/system-reports.ts`                        | In `updateSystemReport` (line 365), drop `nextScheduledRunAt` from the spread. Compare existing `cronExpression` against new one; only when it changed, set `nextScheduledRunAt = computeNextScheduledUpdateAt(definition.cronExpression, now)`. Create path is unchanged.                                                                   |
| `src/reports/scheduler.ts`                             | In `runDueReports`'s `finally{}` block, also set `lastScheduledRunAt: now` on the `Report.update` so the "we tried to fire" timestamp is truthful even when `runReport` throws before reaching `runner.ts:105`. Log the dispatched count (`logger.info` if `reports.length > 0`) so the existing "completed in Nms" line stops being opaque. |
| `src/reports/runner.ts`                                | No change — already sets `lastScheduledRunAt` and `lastRunStatus` on both success and failure paths.                                                                                                                                                                                                                                         |
| `src/metrics/report-runs.ts`                           | Add: `scoutScheduledReportLastSuccessTimestamp` (Gauge, labels: `report_id`, `system_source`, `title`). Emit unix-seconds.                                                                                                                                                                                                                   |
| `src/reports/runner.ts` (metrics call)                 | In `recordReportMetrics` on `status === "SUCCESS"`, set the gauge to `startedAt.getTime() / 1000`.                                                                                                                                                                                                                                           |
| `src/reports/schedule-metric-seed.ts` _(new)_          | `seedScheduledReportLastSuccessMetric(prisma)` — on startup, for every enabled Report, look up most recent `ReportRun` with `trigger=SCHEDULED, status=SUCCESS` and set the gauge to that `startedAt`. If none found, set to 0 (epoch) → alert fires immediately, which is correct (the report has never successfully fired on schedule).    |
| `src/index.ts` (or wherever `startCronJobs` is called) | Call `seedScheduledReportLastSuccessMetric` once after Prisma connects, before `startCronJobs`.                                                                                                                                                                                                                                              |

### Tests

| File                                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/reports/system-reports.integration.test.ts`    | Add `test("re-syncing preserves existing nextScheduledRunAt for COMMON_DENOMINATOR")`. Pattern: sync at `t1`, capture `nextScheduledRunAt`, sync again at `t2 = t1 + 1min`, assert unchanged. Add a second test for the `cronExpression`-change recompute path.                                                                                                                                                                               |
| `src/reports/scheduler.integration.test.ts` _(new)_ | (1) `runDueReports` fires for a report whose `nextScheduledRunAt <= now`, sets `lastScheduledRunAt`, advances `nextScheduledRunAt`, increments metric. (2) If `runReport` throws (mock `executeReportQuery` to throw), `lastScheduledRunAt` is still set, `nextScheduledRunAt` still advances, `lastRunStatus = FAILED`, freshness gauge **not** advanced. (3) Re-running on the next minute does NOT double-fire (next is already advanced). |

### Homelab — alert rule

`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/scout.ts`

Add a new rule group `scout-scheduled-reports-stale` inside `getScoutRuleGroups()`. Two alerts, both `severity: critical` (both page via PagerDuty under existing AlertManager config — `prometheus.ts:240,274`):

```ts
{
  name: "scout-scheduled-reports-stale",
  rules: [
    {
      alert: "ScoutScheduledReportMissedDaily",
      annotations: {
        summary: "Scout daily scheduled report has not fired",
        message: escapePrometheusTemplate(
          "Scout {{ $labels.environment }} report {{ $labels.title }} (id={{ $labels.report_id }}, source={{ $labels.system_source }}) has not successfully run on schedule for {{ $value | humanizeDuration }}. Expected daily.",
        ),
        runbook_url: "https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/reports/scheduler.ts",
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        // 25h = one day + 1h grace. system_source=COMPETITION uses 0 0 * * *.
        '(time() - scout_scheduled_report_last_success_timestamp_seconds{system_source="COMPETITION"}) > 90000',
      ),
      for: "10m",
      labels: { severity: "critical" },
    },
    {
      alert: "ScoutScheduledReportMissedWeekly",
      annotations: {
        summary: "Scout weekly scheduled report has not fired",
        message: escapePrometheusTemplate(
          "Scout {{ $labels.environment }} report {{ $labels.title }} (id={{ $labels.report_id }}, source={{ $labels.system_source }}) has not successfully run on schedule for {{ $value | humanizeDuration }}. Expected weekly Sunday.",
        ),
        runbook_url: "https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/reports/scheduler.ts",
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        // 8d1h grace. system_source=COMMON_DENOMINATOR uses 0 18 * * 0.
        '(time() - scout_scheduled_report_last_success_timestamp_seconds{system_source="COMMON_DENOMINATOR"}) > 698400',
      ),
      for: "10m",
      labels: { severity: "critical" },
    },
  ],
}
```

Re-use the existing `escapePrometheusTemplate` helper and `PrometheusRuleSpecGroupsRulesExpr.fromString` — same pattern as the 5 existing scout alerts in this file. No new wiring needed; `prometheus.ts:198-208` already imports `getScoutRuleGroups`.

## Verification

### Local — unit/integration tests

```bash
cd packages/scout-for-lol/packages/backend
bun test src/reports/system-reports.integration.test.ts
bun test src/reports/scheduler.integration.test.ts
bun run typecheck
bunx eslint src/reports/ src/metrics/ --fix
```

### Local — cdk8s lint for the new rule

```bash
cd packages/homelab
bun run typecheck
bun test  # runs the helm-template + cdk8s synth tests
```

### Live verification on `scout-beta` (after deploy)

```bash
# 1. The gauge is exposed and seeded on startup
kubectl -n scout-beta exec deploy/scout-beta-scout-backend -- \
  bun -e 'fetch("http://localhost:3000/metrics").then(r=>r.text()).then(t=>console.log(t.split("\n").filter(l=>l.includes("scout_scheduled_report_last_success")).join("\n")))'

# 2. nextScheduledRunAt stops being silently bumped past the fire window
kubectl -n scout-beta exec deploy/scout-beta-scout-backend -- bun -e '
  import { Database } from "bun:sqlite";
  const db = new Database("/data/db.sqlite", { readonly: true });
  console.log(db.query("SELECT id,title,nextScheduledRunAt,lastScheduledRunAt,lastRunStatus FROM Report").all());
'

# 3. The 7 COMMON_DENOMINATOR reports actually fire next Sunday 18:00 UTC
#    (2026-06-21). Watch logs at 18:00:00 UTC that day:
kubectl -n scout-beta logs -f deploy/scout-beta-scout-backend | grep -E "ReportDispatch|Posting|runReport"
# expect: "[ReportDispatch] Posting 7 scheduled report(s)"

# 4. Confirm new alerts are loaded in Prometheus
kubectl -n prometheus exec sts/prometheus-prometheus-kube-prometheus-prometheus-0 -- \
  wget -qO- http://localhost:9090/api/v1/rules | jq '.data.groups[] | select(.name=="scout-scheduled-reports-stale")'

# 5. Synthetic alert test: temporarily nudge one Report.lastScheduledRunAt
#    far back to confirm the alert routes to PagerDuty. (Coordinate with on-call
#    before doing this — it pages.)
```

## Rollout

Single PR. Lands on `main` → Dagger CI builds and pushes the scout image →
`versions.ts` commit-back updates the digest → ArgoCD auto-syncs to
`scout-beta` within minutes. Same image promotes to `scout-prod` on the
normal cadence. No DB migration required (no schema changes — we're only
fixing how an existing column is written).

## Risk / non-goals

- The alert will fire immediately on first deploy for the 7 COMMON_DENOMINATOR
  reports (gauge = 0 because they've never had a successful SCHEDULED run). That
  is correct behaviour and clears the moment the next Sunday 18:00 UTC fire
  succeeds. If user wants to suppress the initial page, we can guard the seed
  with `time() - seeded > 24h` in the alert expression — adds noise to the rule
  for limited value. Default: let it page once so the fix is visibly proven.
- We are NOT redesigning the dispatcher to use a job queue (Temporal etc.). The
  per-minute polling loop stays; we're just making it work correctly.
- We are NOT adding a synthetic-fire endpoint for testing in prod. The alert
  test in step 5 above uses a one-off SQLite nudge.
