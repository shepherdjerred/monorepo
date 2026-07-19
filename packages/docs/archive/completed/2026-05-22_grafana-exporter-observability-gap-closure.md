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

## Session Log — 2026-05-22

### Done

- Repaired repo-owned dashboard PromQL and stale metric families across PR Review Bot, ZFS, Temporal, Buildkite, TaskNotes, Gitckup, Velero, SMART, AI Provider Health, and Scout for LoL dashboards.
- Hid/remediated imported dashboard noise by switching Grafana sidecar discovery to `homelab_grafana_dashboard=1`, disabling kube-prometheus-stack default dashboards, removing the dotdc Kubernetes dashboard app from generation, and deleting the legacy Grafana Argo app.
- Added renderer auth/internal callback configuration and verified `/render/d/...` returns PNGs for AI Provider Health, Scout, Buildkite, and ZFS dashboards.
- Added `packages/homelab/src/cdk8s/scripts/grafana-dashboard-audit.ts` plus `audit:grafana`, and added dashboard query health coverage in `packages/homelab/src/cdk8s/grafana/dashboard-query-health.test.ts`.
- Seeded Scout AI provider metric labels at zero for future backend images and zero-backed dashboard panels that are expected to be quiet.
- Applied the dashboard/monitoring changes to the cluster. Final live Grafana audit: 10 dashboards, 248 panels, 246 queries, 0 PromQL errors, 0 empty queries, 0 dark dashboards.
- Verified Prometheus target state: 46 scraped targets and 0 down targets; Scout beta/prod each have `up=1`.
- Verified Loki ingestion with recent logs from Scout prod and Prometheus namespaces, and verified Tempo service discovery over 24h includes `scout-backend`, `temporal-worker`, and Dagger services.

### Remaining

- Scout AI provider zero-label seeding in `packages/scout-for-lol/packages/backend/src/metrics/` will take effect when the Scout backend image is next built and deployed; the live dashboard is already healthy because the panels are zero-backed.
- SeaweedFS still owns a chart-created dashboard ConfigMap with the old `grafana_dashboard` label, but Grafana no longer discovers that label, so it is hidden from the visible dashboard set.

### Caveats

- A full `bun run up` after the final edits timed out while reading unrelated Postal resources from the Kubernetes API; a targeted `kubectl apply -f rendered/apps.k8s.yaml` succeeded afterward and updated the relevant dashboard ConfigMaps.
- Existing PodSecurity warnings are still emitted for several legacy workloads during apply; they were not introduced by this dashboard work.

## Session Log — 2026-05-23

### Done

- Addressed Greptile's Velero dashboard comment by zero-backing the "Healthy Schedules" stat panel with `or on() vector(0)`.
- Addressed Greptile's renderer token comment by moving Grafana renderer token configuration to the existing `prometheus-secrets` Secret via `envValueFrom`, wiring both Grafana's `renderer_token` and the image renderer `AUTH_TOKEN` to `GRAFANA_RENDERER_TOKEN`.
- Added a concealed `GRAFANA_RENDERER_TOKEN` field to the 1Password item backing `prometheus-secrets`.
- Split Grafana Helm values into `packages/homelab/src/cdk8s/src/resources/argo-applications/grafana-values.ts` to keep `prometheus.ts` under the lint line-count limit.
- Resolved the `origin/main` merge conflicts in Scout scheduled-report dashboard panels and Prometheus Grafana values, preserving the zero-backed four-stat Scout row while taking main's shared `BLACKBOX_MODULES` extraction.
- Re-ran homelab lint, typecheck, tests, and cdk8s render after the merge resolution.
- Fixed Scout Data Dragon champion-name normalization for URL-encoded names such as `Nunu%20&%20Willump`, which unblocked Scout report tests after merging `origin/main`.
- Pushed merge-resolution commit `5dc0dfc34` to PR #869 and verified Buildkite build #2696 passed.
- Rechecked PR #869 after the push: GitHub reports it is mergeable, and the only Greptile P2 review threads are resolved and outdated.

### Remaining

- None for the requested CI, merge-conflict, and P3-or-higher review-comment loop.

### Caveats

- The filtered `render` script is not exposed at `packages/homelab`; render was run from `packages/homelab/src/cdk8s`.
- Parallel homelab verification can race Bun's subpackage installs; rerunning typecheck and test sequentially passed.
- PR #869 is still a draft, so pr-review-bot and CodeRabbit skipped full review until it is marked ready.
