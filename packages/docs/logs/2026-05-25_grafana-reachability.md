# Grafana Reachability Check

## Status

Complete

## Context

Investigated why `https://grafana.tailnet-1a49.ts.net` was unreachable on 2026-05-25.

## Findings

- Local Tailscale is up and MagicDNS is enabled, but `grafana.tailnet-1a49.ts.net` does not resolve from the current machine.
- `tailscale status` no longer lists a `grafana` tailnet node, which matches the cluster-side removal of the Grafana ingress.
- The `prometheus` namespace is stuck `Terminating` with `deletionTimestamp: 2026-05-25T20:51:48Z`.
- The namespace contains no pods, services, PVCs, events, Tailscale tunnel bindings, or Zalando Postgres resources.
- The parent `apps` ArgoCD sync pruned the `prometheus` namespace, `apps-grafana-ingress`, and the separate `grafana` Application during a manual sync to chart `2.0.0-2965`.
- The namespace was prune-eligible because it was still tracked as an `apps` resource: `argocd.argoproj.io/tracking-id: apps:/Namespace:argocd/prometheus`.
- Commit `ba5310e90` removed `createGrafanaApp(chart)` from the parent apps chart. That old standalone Grafana app had created the tracked `prometheus` namespace and `apps-grafana-ingress`; Grafana itself moved into `kube-prometheus-stack`, but namespace ownership did not move with it.
- Namespace finalization is blocked because `v1beta1.metrics.k8s.io` is unavailable: the APIService points at `service/prometheus-adapter` in the deleted `prometheus` namespace.
- `grafana-db` synced chart `2.0.0-2965`, but Argo now reports it `Missing` because its target namespace is terminating.
- The `prometheus` Application cannot currently recover the stack. Its last sync failed with a structured-merge diff error from duplicate `AUTH_TOKEN` entries in the `grafana-image-renderer` container env.
- The live `prometheus` Application still shows `grafana.ini.database.ssl_mode: disable`; the checked-out source has `ssl_mode: require`, so the published/live app spec has not converged to the local Postgres TLS fix.
- The PVC objects are gone from the terminating `prometheus` namespace, but the backing PVs are retained and `Released`, not deleted:
  - `pvc-08c23bab-9a81-4206-b98a-6eac907eacb3` -> `prometheus/...prometheus-db...-0` (256Gi)
  - `pvc-1bc805de-0008-4272-80c3-9cbfbe8ee24c` -> `prometheus/...alertmanager-db...-0` (8Gi)
  - `pvc-4748fade-ae7e-40f6-bf53-76e5218e2681` -> `prometheus/storage-prometheus-grafana-0` (10Gi)
  - `pvc-d1e39724-258b-47b2-91e0-cd52f5ed7b0a` -> `prometheus/pgdata-grafana-postgresql-0` (32Gi)
- Recovery branch `codex/recover-prometheus-grafana` adds the missing desired state:
  - `packages/homelab/src/cdk8s/src/cdk8s-charts/apps.ts` explicitly creates the `prometheus` namespace.
  - `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts` recreates the `apps-grafana-ingress` Tailscale ingress.
  - `packages/homelab/src/cdk8s/src/misc/cloudflare-tunnel.ts` renders `disableDNSUpdates`.
  - `packages/homelab/src/cdk8s/src/resources/argo-applications/grafana-values.ts` removes the duplicate image-renderer `AUTH_TOKEN` env source.

## Session Log - 2026-05-25

### Done

- Loaded Grafana, Kubernetes, and Tailscale guidance before live checks.
- Searched recall for prior Grafana/homelab context and found the same-day Kubernetes pod status log.
- Confirmed current context is `admin@torvalds`.
- Queried live ArgoCD and Kubernetes state for `apps`, `prometheus`, `grafana-db`, the `prometheus` namespace, Grafana pods/services, the Grafana Postgres CR, PVCs, events, and Tailscale tunnel bindings.
- Checked the `v1beta1.metrics.k8s.io` APIService and confirmed it is unavailable because `service/prometheus-adapter` is missing.
- Checked local Tailscale status and DNS state.
- Confirmed the manual `apps` sync with prune started at `2026-05-25T20:51:34Z` and pruned the `prometheus` namespace at revision `2.0.0-2965`.
- Confirmed source history: `ba5310e90 fix(homelab): close grafana observability gaps` removed the standalone Grafana app call from `packages/homelab/src/cdk8s/src/cdk8s-charts/apps.ts`.
- Checked `zfs-ssd` and confirmed `reclaimPolicy: Retain`.
- Confirmed the retained Prometheus PVs have CSI `VolumeHandle` values matching their PV names, so they can be rebound if their stale claim references are cleared/prebound carefully.
- Temporarily disabled ArgoCD auto-sync on `apps`, `prometheus`, `prometheus-adapter`, and `grafana-db` before starting live recovery.
- Verified the recovery code with `bun run --filter='./packages/homelab' typecheck`, `bun run --filter='./packages/homelab' test`, and `bun run --filter='./packages/homelab' lint`.
- Verified rendered `dist/apps.k8s.yaml` contains the `prometheus` namespace, `apps-grafana-ingress`, `disableDNSUpdates`, `ssl_mode: require`, and no lower-case `disableDnsUpdates` / `AUTH_TOKEN` renderer env entry.

### Remaining

- Restore the monitoring namespace/app stack in the correct order:
  1. Publish the fixed `apps` chart through the normal Git/Buildkite path, or with explicitly approved ChartMuseum credentials for a manual emergency chart push.
  2. Confirm Argo sees the fixed `apps` revision before syncing.
  3. Let the `prometheus` namespace finish deletion, or explicitly resolve the stale `metrics.k8s.io` APIService/namespace finalization blocker.
  4. Before syncing the monitoring apps, clear/prebind the four retained PVs to their expected PVC names so controllers do not dynamically provision empty replacement volumes.
  5. Resync `apps`, `grafana-db`, `prometheus-adapter`, and `prometheus`.
  6. Verify `prometheus-grafana`, `prometheus-grafana` service, `apps-grafana-ingress`, and the `grafana` tailnet node return.

### Caveats

- Live mutation so far was limited to disabling auto-sync on `apps`, `prometheus`, `prometheus-adapter`, and `grafana-db`.
- The same-day earlier log showed Grafana crash-looping on Postgres TLS before the prune; the current outage is now stronger: the whole target namespace and Grafana ingress are absent.
- A manual ChartMuseum push would require credential access. The attempted cluster-secret inspection was rejected by the sandbox reviewer, so the safe publish path is Git/Buildkite unless the operator explicitly approves credentialed manual publishing.

## Session Log - 2026-05-25 Recovery

### Done

- Merged PR #949 after Buildkite PR build #2972 passed.
- Let Buildkite main build #2973 publish the fixed `apps` chart, then explicitly synced `apps` to chart revision `2.0.0-2973`.
- Deleted the stale `v1beta1.metrics.k8s.io` APIService so the terminating `prometheus` namespace could finalize.
- Recreated the `prometheus` namespace and pre-bound the four retained PVs to their original PVC names before syncing workloads.
- Restored `apps-grafana-ingress`, `apps-prometheus-ingress`, `apps-alertmanager-ingress`, Prometheus rules/dashboards, and monitoring sidecar workloads.
- Repaired Grafana PostgreSQL credentials after namespace deletion recreated the operator secret while the retained database volume kept the old password.
- Synced `prometheus-adapter` to recreate `v1beta1.metrics.k8s.io`; the APIService is available again.
- Confirmed Grafana is reachable: `curl -I https://grafana.tailnet-1a49.ts.net/login` returned `HTTP/2 200`.

### Remaining

- Publish the follow-up `grafana-db` chart fix for the Postgres operator `pg_hba` rule so Argo does not revert the live repair.
- Re-check Buildkite #2973 after version commit-back/build summary finish.

### Caveats

- The live PostgreSQL repair aligned generated secrets to retained database roles without printing secret values.
- `apps` was manually synced to `2.0.0-2973` because the Buildkite sync initially left Argo on the stale chart revision.
