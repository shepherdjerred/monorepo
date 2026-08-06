---
id: reference-completed-2026-05-22-grafana-exporter-observability-gap-closure
type: reference
status: complete
board: false
---

# Grafana, Exporter, and Observability Gap Closure

## Summary

Fill dashboard gaps by fixing the real source for each class of failure: broken PromQL, missing or renamed metrics, bad imported dashboard variables, unaesthetic imported dashboards, renderer auth, and Scout observability coverage.

Live checks on 2026-05-22 showed Prometheus, Loki, and Tempo datasources healthy; Prometheus had 46 active targets, no unhealthy active targets, and no `up == 0`. Scout beta/prod were both scraped and Loki had recent Scout logs. The implementation therefore treats broken exporters as missing/stale metric coverage unless target-specific checks prove otherwise.

## Implementation Plan

- Fix first-party dashboard correctness:
  - Repair invalid PromQL in PR Review Bot and ZFS dashboards.
  - Fix Temporal service regexes to match current `temporal-*metrics-service` labels.
  - Convert expected-quiet panels to render zero instead of "No data."
  - Remove or replace panels whose metrics do not exist anymore: Kueue, HA workflow, TaskNotes HTTP, Gitckup success-rate, Velero PVC-label coverage, and stale Data Dragon panels.
  - Keep only panels with live data, validated quiet-zero behavior, or an explicit operational purpose.

- Fix imported dashboard gaps:
  - Make Grafana discover only curated first-party dashboard ConfigMaps.
  - Disable kube-prometheus-stack default dashboards and the Darwin/AIX node exporter dashboard paths.
  - Remove the dotdc Kubernetes dashboard Argo application from the apps chart.
  - Leave chart-owned ConfigMaps such as SeaweedFS in place but no longer discover them through the Grafana sidecar.

- Fix Grafana rendering:
  - Configure matching Grafana `renderer_token` and image renderer `AUTH_TOKEN`.
  - Keep the renderer callback URL internal to the cluster.
  - Verify render endpoints after deployment.

- Audit observability backends and Scout:
  - Add a read-only Grafana audit script that checks dashboard panels, PromQL errors, empty query results, and dark dashboards.
  - Validate Scout dashboard metrics, alert expressions, ServiceMonitors, Loki streams, and Tempo visibility.

## Test Plan

- Run homelab package typecheck, tests, and render/build checks.
- Run live Prometheus query validation for changed dashboard expressions.
- Run `bun run --filter='./packages/homelab/src/cdk8s' audit:grafana` with `GRAFANA_URL` and `GRAFANA_API_KEY`.
- Verify Grafana render endpoint returns images for representative first-party dashboards after deployment.
