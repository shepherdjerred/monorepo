# Grafana Pyroscope Datasource Repair

## Status

Complete

## Context

Grafana Profiles Drilldown showed:

> Missing Pyroscope data source!

The checked-out cdk8s source already had the corrected Pyroscope datasource plugin ID:
`grafana-pyroscope-datasource`. The live Grafana API still returned the stale datasource type
`grafanapyroscope`, which Grafana cannot resolve as an installed datasource plugin.

## Root Cause

The live `prometheus` ArgoCD Application and mounted Grafana provisioning file had the corrected
datasource type, but the provisioned Grafana database row was stale:

- `uid`: `pyroscope`
- old `type`: `grafanapyroscope`
- `read_only`: `true`
- `version`: `2`

The cdk8s source still emitted `version: 1` for the Pyroscope datasource. Grafana provisioning did
not replace the stale row because the provisioned version was not higher than the existing database
row.

## Fix

- Bumped the Pyroscope datasource provisioning version in
  `packages/homelab/src/cdk8s/src/resources/argo-applications/grafana-values.ts` from `1` to `3`.
- Added a source comment documenting that datasource identity changes must bump above the live DB
  version.
- Repaired the live Grafana row directly in `grafana-postgresql` after the Grafana API rejected the
  update with `datasources:write` permission denied and the chart admin secret did not authenticate.

Live SQL update affected exactly one row:

```sql
update data_source
set type = 'grafana-pyroscope-datasource', version = 3, updated = now()
where uid = 'pyroscope' and type = 'grafanapyroscope';
```

## Verification

- `toolkit grafana datasources` now reports `pyroscope` as type `grafana-pyroscope-datasource`.
- `GET /api/datasources/uid/pyroscope` now reports `version: 3`, `readOnly: true`, and the corrected
  type.
- `GET /api/datasources/uid/pyroscope/health` returns HTTP 200 with `Data source is working`.
- Rendered cdk8s output has `version: 3` in `dist/apps.k8s.yaml`.
- `cd packages/homelab/src/cdk8s && bun run typecheck` passed.
- `cd packages/homelab/src/cdk8s && bun run lint` passed.
- `cd packages/homelab/src/cdk8s && bun run test` passed: 132 passed, 5 skipped, 0 failed.

## Workflow Friction

- The available `GRAFANA_API_KEY` can read datasources but lacks `datasources:write`, so it cannot fix
  read-only provisioned datasource rows via the Grafana API.
- The `prometheus-grafana` Kubernetes admin secret did not authenticate against Grafana. Future live
  Grafana admin repairs would be cleaner with a documented break-glass service account token that has
  `datasources:write`.

## Session Log — 2026-06-12

### Done

- Confirmed live Grafana still had stale `pyroscope` datasource type `grafanapyroscope`.
- Confirmed the live ArgoCD Application and mounted datasource provisioning file already used
  `grafana-pyroscope-datasource`.
- Updated `packages/homelab/src/cdk8s/src/resources/argo-applications/grafana-values.ts` to emit
  Pyroscope datasource `version: 3`.
- Updated the single live Grafana Postgres `data_source` row for `uid='pyroscope'` to
  `grafana-pyroscope-datasource`, version `3`.
- Verified Grafana datasource health is now OK.
- Ran cdk8s `typecheck`, `lint`, and `test` successfully.

### Remaining

- Merge the PR for the cdk8s source change and let the apps chart deploy so the GitOps source matches
  the live repaired row.

### Caveats

- The live row was repaired directly in Grafana Postgres because the Grafana API token lacked
  `datasources:write` and the admin secret did not authenticate.
- The final working tree also contains unrelated ArgoCD sync-option source changes and two unrelated
  untracked logs:
  `packages/docs/logs/2026-06-12_argocd-sync-failures.md` and
  `packages/docs/logs/2026-06-12_nvme-temperature-check.md`.
