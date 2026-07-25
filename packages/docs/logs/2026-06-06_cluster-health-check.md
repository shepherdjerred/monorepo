---
id: log-2026-06-06-cluster-health-check
type: log
status: complete
board: false
---

# Cluster Health Check — ArgoCD / K8s / Talos

## Summary

Read-only health sweep of the `torvalds` homelab cluster across Talos, Kubernetes, and ArgoCD. Overall verdict: **healthy**. The large `Error`/`Completed` pod list is stale garbage from node reboots, not active failures.

## Findings

### Talos — healthy

- `talosctl health` passes all checks (etcd healthy/consistent, apid, kubelet, control-plane static pods + components ready, no diagnostics).
- v1.13.3 client/server; kernel 6.18.33; containerd 2.2.4. Certs expire 2027-04-26.
- Node uptime ~12.4h → rebooted ~12h ago (clean).

### Kubernetes — healthy

- Node `torvalds` Ready, no Memory/Disk/PID pressure. K8s v1.36.1.
- Every Deployment has desired replicas available; every StatefulSet fully ready. No genuinely degraded workload.

### ArgoCD — healthy

- 60/60 apps Healthy; 58/60 Synced.
- 2 OutOfSync, both Healthy (benign drift): `apps` (3 minecraft child-apps + 2 one-shot Jobs) and `prometheus` (`Secret/prometheus-grafana-image-renderer`).

### Noise (cosmetic)

- ~167 stale terminated pods (`Error`/`Completed`/`ContainerStatusUnknown`) in three age buckets (~12h, ~4d14h, ~8d) = three node reboots. Single-node cluster never hits pod-GC threshold (12,500), so they accumulate. Verified each has a healthy Running sibling.
- ~195 `Completed` Buildkite pods = normal ephemeral CI.

### Minor real items

- `redlib`: only true crashlooper (27 restarts/12h, currently Running/Ready). Cause is upstream Reddit 403/rate-limit on startup, not infra.
- Root cause of clutter = 3 node reboots in 8 days (likely Renovate-driven Talos/k8s upgrades; unconfirmed).

## Drift investigation & correction — 2026-06-06

User confirmed selfHeal-off + manual-prune is intentional. Investigated both OutOfSync apps and corrected/ignored each.

### `apps` → 3 minecraft Applications (`group: ""` drift) — CORRECTED

- Root cause: chart **already desires** `group: ""` on the Service `ignoreDifferences` entry; live `minecraft-shuxin/sjerred/tsmc` Application CRs had lost the `group` field and (selfHeal off) never got re-applied. `minecraft-bettermc` and helper-based instances had it and were Synced.
- Fix: one-time surgical manual sync of the 3 Application resources via the `apps` parent (`argocd app sync apps --resource argoproj.io:Application:argocd/minecraft-{shuxin,sjerred,tsmc}`). Verified all 3 now have `group: ""` live; `apps` is **Synced/Healthy**. No source change needed (source was already correct).

### `prometheus` → `Secret/prometheus-grafana-image-renderer` `/data/token` — PROPERLY IGNORED

- Root cause: grafana subchart regenerates this token via `randAlphaNum` on every helm render, so it can never converge.
- Fix: added an `ignoreDifferences` entry for `Secret/prometheus-grafana-image-renderer` `/data/token` in `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts` (mirrors the existing `/data/admin-password` ignore on `prometheus-grafana`). Typechecks; renders into dist correctly. **Pending commit/PR → CI chart publish → ArgoCD pull** to take effect.

### Caveat / process note

- The two remaining `apps` resources with `null` status (`Job/dagger-zfs-tuning`, `Job/docker-config-builder`) are one-shot hook Jobs — normal, not OutOfSync.
- `dist/` is gitignored; CI rebuilds the chart from source, so only the `prometheus.ts` source edit needs committing.

## Session Log — 2026-06-06

### Done

- Verified Talos, K8s node, and ArgoCD health via `talosctl health`, `kubectl get nodes/deploy/statefulset`, and ArgoCD application status.
- Confirmed all "Error"/"Completed" pods are stale reboot leftovers with healthy Running siblings; quantified at ~167 non-buildkite + ~195 buildkite.
- Identified `redlib` crashloop as upstream Reddit rate-limiting (external).
- Confirmed NO app has sync disabled (all 60 automated; selfHeal/prune off by design). No sync windows, paused ops, or skip annotations.
- Corrected the minecraft `group: ""` drift via manual sync (`apps` now Synced/Healthy).
- Added `ignoreDifferences` for the grafana image-renderer token in `prometheus.ts` (worktree); typecheck + render verified.

### Remaining

- Commit + PR the `prometheus.ts` change so CI republishes the chart and ArgoCD ignores the renderer-token drift.
- Optional: clean up ~167 stale terminated pods.
- Optional: confirm whether the 3 reboots in 8 days were planned Talos/k8s upgrades vs unplanned.

### Caveats

- Single-node cluster: stale terminated pods will keep accumulating after each reboot until manually pruned; not a health problem.
- prometheus stays OutOfSync (harmless) until the chart change ships.
