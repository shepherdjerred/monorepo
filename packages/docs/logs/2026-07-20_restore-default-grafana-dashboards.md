---
id: restore-default-grafana-dashboards
type: log
status: complete
board: false
---

# Restore default Grafana dashboards

User noticed the built-in Grafana dashboards (node exporter, kube-state-metrics, etc.)
were missing from the dashboard list and asked what happened.

Root cause: `defaultDashboardsEnabled: false` was set in
`packages/homelab/src/cdk8s/src/resources/argo-applications/grafana-values.ts` on
2026-05-22 (commit `4d828caefbbd2`, "fix(homelab): address grafana review comments"),
as part of a deliberate dashboard-noise cleanup documented in
`packages/docs/archive/completed/2026-05-22_grafana-exporter-observability-gap-closure.md`.
That same change switched the Grafana sidecar to only discover dashboards labeled
`homelab_grafana_dashboard=1`, which is why the dashboard list now only shows the
curated, purpose-built dashboards.

User decided they want the stock dashboards back, so flipped
`defaultDashboardsEnabled` back to `true`.

## Session Log — 2026-07-20

### Done

- Flipped `defaultDashboardsEnabled: false` → `true` in
  `packages/homelab/src/cdk8s/src/resources/argo-applications/grafana-values.ts:80`.
- Verified with `bunx turbo run typecheck test lint --filter=@homelab/cdk8s` (212 tests
  pass) and full `bun run verify -- --affected` (had to start OrbStack locally first —
  `check:caddyfile` needs a running Docker daemon to build the caddy-s3proxy image).
- Committed on branch `fix/restore-default-grafana-dashboards` in worktree
  `.claude/worktrees/restore-grafana-dashboards`.

### Remaining

- Open the PR (in progress as this log is written).
- Once merged and ArgoCD syncs, confirm in the live Grafana instance that the stock
  node-exporter / kube-state-metrics dashboards reappear under the default folder.

### Caveats

- This re-enables the full stock dashboard set from `kube-prometheus-stack`, not just
  node-exporter — the same "noise" the 2026-05-22 cleanup was trying to reduce comes
  back too. If that turns out to be unwanted, a narrower fix would be to import just
  the specific dashboards wanted (e.g. Node Exporter Full, grafana.com ID 1860) as
  curated dashboards tagged `homelab_grafana_dashboard=1`, following the pattern in
  `packages/homelab/src/cdk8s/grafana/`.
