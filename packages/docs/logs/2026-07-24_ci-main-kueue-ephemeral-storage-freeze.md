---
id: 2026-07-24-ci-main-kueue-ephemeral-storage-freeze
type: log
status: in-progress
board: false
---

# CI on main frozen — Kueue ClusterQueue missing ephemeral-storage coverage

## Goal

Get CI on `main` green. Investigating why the current main build (#6046,
`02e5f7691`) — like #6042 before it (stuck ~15h) — never scheduled a pod: its
first job sat `reserved` indefinitely.

## Diagnosis

The Buildkite agent-stack-k8s runs each CI job as a k8s Job gated by Kueue. The
`buildkite` ClusterQueue showed **20 pending workloads, 0 admitted**, with all
quota free (0 used) and `Active: True`. Describing a pending workload gave the
smoking gun:

```
couldn't assign flavors to pod set main: resource ephemeral-storage unavailable in ClusterQueue
Resource Requests: cpu 1850m, ephemeral-storage 6Gi, memory 3712Mi
```

**Root cause.** PR #1610 (CI concurrency, "Track 2.5: cap CI pod
ephemeral-storage") added an `ephemeral-storage` **request** to every
`.buildkite/pipeline.yml` step/dind container, but the Kueue `buildkite`
ClusterQueue's `resourceGroups[0].coveredResources` stayed `["cpu","memory","pods"]`
— it never added `ephemeral-storage`. Kueue refuses to admit a workload that
requests a resource its ClusterQueue does not cover, so **every** CI workload
was rejected → all builds frozen.

This is a **deadlock**, not a sync lag: the fix ships via cdk8s → the `apps`
Helm chart (chartmuseum) → ArgoCD, but the `helm push` + `argocd-sync` steps only
run on a green main build — which can't happen while the queue is frozen. And the
git source (`kueue-config.ts`, already on main from #1610) is itself missing the
coverage, so even a successful sync would not have fixed it.

Confirmed the ClusterQueue is owned by the `apps` ArgoCD app (a chartmuseum chart
rendered from cdk8s), with `automated` sync but **selfHeal off** — so a live
patch persists until the next chart sync.

## Fix

**1. Immediate unblock (live patch).** Added `ephemeral-storage` to the live
ClusterQueue's covered resources so Kueue could admit workloads again:

```bash
kubectl patch clusterqueue buildkite --type=merge -p '{"spec":{"resourceGroups":[{
  "coveredResources":["cpu","memory","pods","ephemeral-storage"],
  "flavors":[{"name":"default","resources":[
    {"name":"cpu","nominalQuota":"7500m"},
    {"name":"memory","nominalQuota":"16Gi"},
    {"name":"pods","nominalQuota":"10"},
    {"name":"ephemeral-storage","nominalQuota":"100Gi"}]}]}]}}'
```

(CPU/memory/pods left at the live values — the old 7.5/16/10, since #1610's raise
to 12/20/20 had likewise never synced.) Immediately after: ClusterQueue
`admitted: 6, pending: 0`, pods scheduling, build #6046 progressing past its
`select` job. Deadlock broken.

**2. Durable fix (code).** `packages/homelab/src/cdk8s/src/resources/kueue-config.ts`
adds `ephemeral-storage` to `coveredResources` with a `100Gi` nominalQuota
(deliberately generous — CPU/memory gate concurrency first; ~6 heavy pods × 6Gi ≈
36Gi, so 100Gi never binds and sits far under the node's multi-TiB capacity).
Regression guard added in `kueue-config.test.ts`. When this merges, a main build
renders the chart with the coverage and argocd-sync converges the live queue
(bumping CPU/memory/pods to #1610's 12/20/20 at the same time).

## Session Log — 2026-07-24

### Done

- Root-caused the main-CI freeze to the Kueue `buildkite` ClusterQueue missing
  `ephemeral-storage` coverage while pods request it (introduced by #1610).
- Live-patched the ClusterQueue to unblock admission; verified builds resumed
  (#6046 progressing).
- Durable code fix in `kueue-config.ts` + regression test.

### Remaining

- Open PR (branch `fix/kueue-eph-storage-quota`); drive its build green and merge.
- Confirm a post-merge main build's argocd-sync converges the live queue and CI
  stays green (the live patch becomes redundant then).

### Caveats

- The live `kubectl patch` diverges the `apps` ArgoCD app to OutOfSync until the
  fixed chart syncs; selfHeal is off so it will not revert on its own.
- If any main build syncs the `apps` chart **before** this fix merges, it would
  revert the live patch (no ephemeral-storage coverage) and re-freeze CI. This
  fix should land promptly. The helm/argocd lanes are change-gated, so a build
  that doesn't touch cdk8s won't re-sync the queue.
