---
id: temporal-grafana-observability
status: active
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

## Done when

- Dashboard panels cover Temporal server + SDK golden signals (not just business
  metrics).
- Alerts fire on the key SLO breaches above.
- "etc." — optional Loki log panels / runbook links wired into the dashboard.

## References

- Dashboard pattern: cdk8s + Grafana Foundation SDK → ConfigMap
  (`homelab_grafana_dashboard: "1"` label, auto-discovered by the sidecar).
- Alert pattern: `PrometheusRule` CRDs under `.../monitoring/monitoring/rules/`.
