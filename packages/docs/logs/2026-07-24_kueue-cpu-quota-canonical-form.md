---
id: 2026-07-24-kueue-cpu-quota-canonical-form
type: log
status: in-progress
board: false
---

# Kueue ClusterQueue cpu quota — use canonical "12" to stop a phantom ArgoCD OutOfSync

## Goal

Follow-up to the ephemeral-storage freeze fix (#1618). After that merged, the
`buildkite` ClusterQueue converged on values but the `apps` ArgoCD app stayed
`OutOfSync`/`Progressing`, and main build #6053's `:argo: sync + wait` failed —
first on a transient `etcdserver: request timed out` during the ClusterQueue
apply (leaving a sync operation wedged ~44m), then, after terminating that op and
re-syncing, on a permanent diff.

## Diagnosis

`argocd app diff apps` showed exactly ONE remaining difference across the whole
app:

```
===== kueue.x-k8s.io/ClusterQueue /buildkite ======
<         nominalQuota: "12"        # live (Kueue/API-server normalised)
>         nominalQuota: 12000m      # desired (chart, from #1610/#1618)
```

Kueue stores the cpu `nominalQuota` as the canonical Quantity `"12"`, but the
chart wrote the equivalent-but-non-canonical `"12000m"`. ArgoCD diffs the raw
strings, so this is a **permanent phantom OutOfSync**: the app-of-apps sync never
reaches Synced, so every `argocd-sync` CI step's `tree-health-wait apps` (which
requires Synced/Healthy) times out and fails. Introduced latent by #1610's
`7500m → 12000m` bump; only surfaced now that the chart finally synced.

## Fix

`packages/homelab/src/cdk8s/src/resources/kueue-config.ts`: cpu `nominalQuota`
`"12000m" → "12"` (the form the API server stores). The other quotas already use
canonical forms (`"20Gi"`, `"20"`, `"100Gi"`) — the argocd diff confirmed cpu was
the only drift.

Operational steps taken alongside (live cluster): terminated the wedged apps sync
operation (`argocd app terminate-op apps`); the freed auto-sync had already
applied the correct ClusterQueue values (12 CPU / 20Gi / 20 pods / 100Gi eph), so
the queue admits normally — only the cosmetic cpu-string diff remained, which this
chart change removes for good.

## Session Log — 2026-07-24

### Done

- Diagnosed the residual `apps` OutOfSync to a cpu Quantity canonicalisation diff
  (`"12000m"` chart vs `"12"` live) that wedges argocd-sync.
- Changed the chart to the canonical `"12"`.

### Remaining

- Open PR, merge; confirm the post-merge main build's `argocd-sync` reaches
  Synced/Healthy and goes green (this is the last blocker to a durably green main).

### Caveats

- The earlier `etcdserver: request timed out` was transient (single-node etcd
  under load from the 15h backlog); it recurred once and cleared on retry. Watch
  for it if argocd-sync flakes again.
