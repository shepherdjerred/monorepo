# Scout Scheduled-Report Dispatcher

## Status

Complete (reference)

scout-for-lol's `runScheduledReportDispatch` runs every minute and calls `syncSystemReports` THEN `runDueReports`.

## 1. Schedule state belongs to the scheduler, not the sync

`Report.nextScheduledRunAt` / `Report.lastScheduledRunAt` are owned by `scheduler.ts`. `syncSystemReports` may upsert title/queryText/channel/cron, but must NOT overwrite next/last on update.

- **Bug (PR #1228, ~1 month silent skip):** `updateSystemReport` spread the whole definition (which included a freshly-recomputed `nextScheduledRunAt`) into the Prisma update. For COMMON_DENOMINATOR reports the recompute always returned "now + 1 cron-period," pushing the next-fire past the current minute before the dispatcher could read it. No error log, no ReportRun row, no Sentry.
- **Rule for `updateSystemReport`:** drop `nextScheduledRunAt` from the spread; only re-derive it when `existing.cronExpression !== definition.cronExpression`. (COMPETITION reports side-stepped the bug because their definition pulled `competition.nextScheduledUpdateAt ?? compute(...)`.)

## 2. Freshness alert pattern (PagerDuty via AlertManager)

The only signal that catches "the dispatcher never fires the schedule" is a per-report **last-success timestamp gauge**:

- Set on `trigger=SCHEDULED, status=SUCCESS` only (never MANUAL — a user `/run` must not silence the alert).
- Seeded from `ReportRun` history on startup (`schedule-metric-seed.ts`, called from `index.ts` before `startCronJobs`) so the alert is meaningful right after a deploy. Never-run reports get gauge=0 → alert fires on first scrape (correct).
- Gauge: `scout_scheduled_report_last_success_timestamp_seconds` (labels `report_id`, `system_source`, `title`).
- Alert rules: `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/scout.ts`, group `scout-scheduled-reports-stale`. Thresholds: COMPETITION daily 25h grace, COMMON_DENOMINATOR weekly 8d1h grace; both `severity: critical`.
- **Caveat:** labels include `title`. Renaming a report in `system-reports.ts` creates a new label series; the old one stays frozen and keeps firing until prom-client drops it or the pod restarts. Restart the pod or drop the old series after a rename.
