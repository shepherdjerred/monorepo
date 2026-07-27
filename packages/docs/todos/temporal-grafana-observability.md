---
id: temporal-grafana-observability
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Expand Temporal Grafana dashboard + alerts to server/SDK golden signals

## What

Temporal already has **some** observability — expand it to cover Temporal
server + SDK golden signals.

What exists today:

- Dashboard: `packages/homelab/src/cdk8s/grafana/temporal-dashboard.ts`
  (registered in `src/resources/grafana/index.ts`) — focused on app/business
  panels (data-dragon version checks, PR-review bot, activity failures, scrape
  health).
- Alerts: `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts`
  (`TemporalWorkflowActivityFailing`, `TemporalScheduledWorkflowFailingDaily`,
  `TemporalCheckAndSkipNeverExecuted`, `Temporal{Worker,Server}MetricsDown`,
  `TemporalHaEventBridgeDisconnected`).
- Metrics: ServiceMonitors on server (`:9090`) and worker (`:9464` SDK, `:9465`
  app) — see `src/resources/temporal/server.ts` + `worker.ts`.

## What's missing

The existing dashboard is business-metric-centric, not Temporal-platform-centric.
Add golden-signal coverage:

- **Workflow/activity task latencies** (schedule-to-start, execution latency),
  task-queue **backlog** + poll success rate.
- **Persistence** latency/error rate, **sticky cache** hit rate, shard /
  membership health.
- Worker saturation (task slots in use, poller counts).
- Corresponding alerts: high task latency, growing backlog, persistence errors,
  worker saturation.

## Remaining

- [ ] Inventory the exact server and SDK metric names currently scraped on
      ports 9090 and 9464, then add panels for schedule-to-start/execution
      latency, task-queue backlog/polling, persistence, sticky cache,
      membership, and worker slot saturation.
- [ ] Add recording or alerting rules with explicit thresholds and runbook links
      for sustained latency, growing backlog, persistence errors, and worker
      saturation; test the rendered PromQL.
- [ ] Deploy to beta/prod and record one live query per dashboard row plus an
      Alertmanager rule evaluation proving the metrics are not empty.

## References

- Dashboard pattern: cdk8s + Grafana Foundation SDK → ConfigMap
  (`homelab_grafana_dashboard: "1"` label, auto-discovered by the sidecar).
- Alert pattern: `PrometheusRule` CRDs under `.../monitoring/monitoring/rules/`.

## Comment Log

### 2026-07-27 — in-progress board audit

- Retained as active. Existing dashboard and alerts cover application health
  and scrape availability, not the requested Temporal platform golden signals.
