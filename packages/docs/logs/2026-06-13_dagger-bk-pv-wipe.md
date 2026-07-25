---
id: log-2026-06-13-dagger-bk-pv-wipe
type: log
status: complete
board: false
---

# Dagger + Buildkite PV Wipe — Fresh Cache Baseline

## Context

Overnight 2026-06-14 00:42–01:38Z, six PagerDuty alerts fired on the Dagger engine cache
PVC (`dagger/data-dagger-dagger-helm-engine-0`), escalating 88% → 96% → inode pressure,
then auto-resolved. These were the new `DaggerEnginePVCStorage*` alerts added by the
[06-07 hardening](../decisions/2026-06-07_dagger-gc-and-pvc-drift.md), behaving as
designed — what used to be a CI outage was an alert window with no human action needed.

To get a clean baseline for the plan's "revisit `maxUsedSpace` once steady-state data
is in" observation window, we wiped both the Dagger engine PVC and the
`buildkite/buildkite-git-mirrors` PVC and let everything reprovision fresh.

## What we did

1. **Stopped Buildkite**: scaled `buildkite-agent-stack-k8s` Deployment to 0 and
   force-deleted all 33 in-flight / errored job pods (including one 13-min job).
2. **Stopped Dagger engine**: scaled `dagger-dagger-helm-engine` STS to 0; waited
   for `dagger-dagger-helm-engine-0` termination.
3. **Deleted both PVCs**: `data-dagger-dagger-helm-engine-0` (2 Ti) and
   `buildkite-git-mirrors` (20 Gi). Both PVs transitioned to `Released` (Retain
   reclaim policy on the storage classes).
4. **Deleted the Released PVs**: cluster-scoped `kubectl delete pv` was denied by
   our local permission policy — user ran those two commands manually.
5. **Deleted the orphan `ZFSVolume` CRs** in the `openebs` namespace. The
   `openebs-zfs-localpv-node` DaemonSet on torvalds reconciled by destroying the
   underlying ZFS datasets. Verified with `zfs list <dataset>` → `dataset does not
exist`.
6. **Scaled Dagger STS back to 1**: pod came up immediately, new PVC bound at
   **1 Ti** (STS VCT drift — see caveat).
7. **Scaled BK agent stack back to 1**: started running, but new job pods went
   `Pending` because the `buildkite-git-mirrors` PVC didn't reappear. The
   `apps` ArgoCD app (which renders the cdk8s output that declares this PVC) was
   `OutOfSync`. Triggered a sync; PVC recreated at 20 Gi RWX immediately, pending
   pods went `Running`.
8. **Online-expanded the Dagger PVC** to 2 Ti via the
   [runbook](../guides/2026-06-07_dagger-engine-pvc-resize.md). Resize completed in
   ~30s. Final: `req=2Ti cap=2Ti`, filesystem `2.0T 19G 2.0T 1% /var/lib/dagger`.

## Final state

| Component                              | State                                                |
| -------------------------------------- | ---------------------------------------------------- |
| `dagger-dagger-helm-engine-0`          | Running, fresh 2 Ti PVC, ~19 GB used (1%)            |
| `buildkite-agent-stack-k8s`            | Running, queue draining normally                     |
| `data-dagger-dagger-helm-engine-0` PVC | New (`pvc-5e89054d-...`), 2 Ti, `zfs-ssd-buildcache` |
| `buildkite-git-mirrors` PVC            | New (`pvc-9a41b730-...`), 20 Gi, `zfs-ssd`, RWX      |
| Old ZFS datasets                       | Destroyed; ~2 Ti + 20 Gi reclaimed on torvalds       |

## Caveats — lingering drift

The live `dagger-dagger-helm-engine` STS `volumeClaimTemplate` is still **1 Ti** even
though the dagger-helm chart values declare 2 Ti. The ArgoCD app's
`ignoreDifferences` on `.spec.volumeClaimTemplates[]` (required because VCT is
immutable in K8s) means the live STS VCT was never updated when the 06-07 expansion
shipped — its 79-day-old 1 Ti VCT survives. Any future PVC recreation will provision at
1 Ti again, requiring another `kubectl patch` to expand. This is the exact trap that
caused the 06-08 outage.

To permanently fix the drift: scale down → delete STS (orphan PVC) → ArgoCD sync →
new STS picks up 2 Ti VCT from the chart. Not done here because option **A**
(patch-and-go) was the explicit choice; deferred as a known follow-up.

## Why this is interesting for the 06-07 plan

The 06-07 plan's "Remaining" item was: _"Revisit `maxUsedSpace` once the new alerts
give a few days of steady-state usage data."_ That observation window now starts from
a known clean baseline (fresh cache, no ~560 GB of "above-cap" carry-over from the
prior engine's accumulated metadata/leases). Whatever steady-state usage we see in the
next few days is attributable to current GC config (`maxUsedSpace=800GB` /
`reservedSpace=200GB` / `minFreeSpace=20%`) under current CI load.

## Workflow Friction

- The `apps` ArgoCD app sat at `OutOfSync` without auto-syncing when we needed it.
  Manual sync was a one-liner so this is low-cost, but enabling auto-sync on the
  meta-app (or at least surfacing OutOfSync louder than a `kubectl get`) would
  remove a manual step in similar future operations.

## Session Log — 2026-06-13

### Done

- Wiped Dagger engine PVC + ZFS dataset and Buildkite git-mirrors PVC + ZFS dataset.
- Reprovisioned both PVCs cleanly; expanded Dagger PVC to 2 Ti via the runbook.
- Verified CI returned to normal operation; logged this as the start of the
  steady-state observation window for [the 06-07 GC retune](../plans/2026-06-07_dagger-engine-disk-hardening.md).

### Remaining

- Option B (STS recreation to fix the 1 Ti → 2 Ti VCT drift permanently) deferred;
  schedule for any off-hours window with no in-flight CI.
- After a few days of steady-state, revisit whether `maxUsedSpace=800GB` is the right
  setting given the now-clean baseline (per the 06-07 plan).

### Caveats

- STS `volumeClaimTemplate` is still 1 Ti — drift will recur on next PVC recreation.
- 22 in-flight BK jobs and 1 ~13-min-old job were killed during the wipe; queue
  retried and recovered automatically.
