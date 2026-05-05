# Velero Orphan-Snapshot Pathology — Prevention Options Analyzed

**Date:** 2026-05-05
**Status:** Decided — detection + manual remediation only; auto-prune and self-healing deferred.

## Summary

While remediating Bugsink's "PVC 100% full" outage, we discovered a cluster-wide pattern of orphan ZFS snapshots and orphan R2 objects from a prior Velero re-deployment (~2026-03-15). 807 local snapshots (~33 GiB) and ~30,000 R2 objects (~2.3 TB) had no matching live `velero.io/v1/Backup` CR. This doc captures the prevention options analyzed, the decision made, and the rationale.

## Background

The cluster runs Velero with the `openebs.io/zfspv-blockstore` provider for incremental ZFS snapshot backups (`incrBackupCount: 15`). Backups are scheduled at 6h / daily / weekly / monthly cadences with TTLs of 72h / 168h / 720h / 2160h respectively, totalling ~26 retention slots per volume.

**Normal lifecycle:** A Velero `Backup` CR is created by a `Schedule`. The plugin creates a ZFS snapshot, ships data (full or incremental delta) to R2 under `s3://homelab/zfspv-incr/backups/<backup-name>/`, and Velero records metadata under `s3://homelab/torvalds/backups/<backup-name>/`. When the Backup CR's TTL expires, Velero's deletion controller invokes the plugin's finalizer, which deletes the local ZFS snapshot AND the R2 chain object.

**Failure mode discovered:** When Velero is re-deployed (helm uninstall + reinstall, ArgoCD app re-creation, etc.), the existing Backup CRs may be removed without their finalizers running because the Velero controller is gone during the gap. The local ZFS snapshots and R2 objects are then orphan with no owner — no Backup CR references them, so the new Velero deployment never garbage-collects them.

The new Velero's built-in `BackupSyncController` re-imports backups from the BackupStorageLocation's metadata prefix (`torvalds/backups/`), but it does NOT inspect the plugin's data prefix (`zfspv-incr/`). The plugin's storage state is invisible to Velero's reconciliation.

**Cluster impact observed (pre-cleanup):**

| Storage                        | Count                   | Size               | Earliest orphan |
| ------------------------------ | ----------------------- | ------------------ | --------------- |
| Local ZFS snapshots            | 807 across 33 datasets  | ~33 GiB            | 2026-02-01      |
| R2 objects under `zfspv-incr/` | ~30,000 of 31,755 total | ~2.3 TB of 2.55 TB | 2026-01-26      |

Bugsink's PVC was the first to wedge because it had a small 8 GiB quota and snapshots accounted for 5+ GiB of that. The same pattern affected ~30 PVCs to varying degrees and was the dominant cause of the persistent `R2StorageExceedingLimit` alert.

## Prevention Options Considered

### Option 1: Detection + manual remediation (DECIDED)

Automated daily check that flags orphans; humans run a documented runbook to remove them.

**Components:**

- Temporal workflow (`velero-orphan-audit`) on a daily schedule
- Activities: list ZFS snapshots, list Velero Backup CRs, list R2 prefixes, compute orphan diffs
- Emit Prometheus metrics for orphan counts and bytes
- Log to Bugsink when orphans found
- Prometheus alert rules paging via existing PagerDuty pipeline
- Remediation runbook documenting `zfs destroy` + `aws s3 rm` procedure

**Pros:**

- Operationally safe — no automated destruction of recoverable state
- Detection covers ANY future cause of orphan accumulation, not just re-deploy
- Builds on existing patterns (Temporal workflows, Prometheus rules, PD)
- Cheapest to implement (~1 day)

**Cons:**

- Reactive — orphans live until a human acts
- Requires human availability when alerts fire
- Doesn't prevent the underlying re-deploy mistake

### Option 2: ArgoCD `Prune=false` annotation on Backup-class CRs

Annotate `velero.io/v1/Backup`, `BackupStorageLocation`, `VolumeSnapshotLocation` resources with `argocd.argoproj.io/sync-options: Prune=false` so ArgoCD never auto-deletes them when the Velero `Application` is re-synced.

**Pros:**

- Eliminates the most likely re-deploy failure mode (ArgoCD pruning Backup CRs)
- Cheap (a few annotations in cdk8s source)

**Cons:**

- Doesn't help if Velero is uninstalled outside of ArgoCD (manual `kubectl delete app`, `helm uninstall`)
- Still requires the finalizer to run during legitimate Backup deletions; doesn't change finalizer mechanics

**Decision:** Worth doing alongside Option 1, but not sufficient alone. Tracked as a follow-up.

### Option 3: Kyverno policy preventing dangerous deletions

Block `velero.io/v1/Backup` CR deletions that would strip finalizers; block `argoproj.io/Application` updates that delete velero while pending Backup CRs exist; block `velero.io/v1/CustomResourceDefinition` removals.

**Pros:**

- Hard guardrails against the most common human errors
- Works regardless of how the deletion is initiated (kubectl, helm, ArgoCD)

**Cons:**

- Operationally annoying when you DO want to drain backups intentionally — requires a documented bypass procedure
- Kyverno policy authoring + maintenance overhead
- Doesn't help with plugin-level failures during normal operation

**Decision:** Deferred. Detection covers the same blast radius with less ongoing friction.

### Option 4: Self-healing init container (Velero pod)

Custom init container that runs before Velero starts, lists ZFS snapshots + Backup CRs + R2 objects, deletes orphans before Velero accepts traffic.

**Pros:**

- Catches the re-deploy moment specifically — orphans never observable

**Cons:**

- **Race with `BackupSyncController`** — Velero recreates Backup CRs from R2 metadata ~1 minute after startup. If the init container runs first, it sees an empty CR list and would conclude EVERYTHING is orphan. Mitigation requires reading R2 metadata directly to identify "live" backups, duplicating Velero's own logic.
- **Recovery scenarios become destructive** — if Backup CRs were intentionally deleted (admin recovery flow), the init container auto-deletes the storage backing before recovery can proceed.
- **Init-container failures block Velero startup** — turns a backup-pipeline gap into an outage.
- ~6 hours of work, more complex than Option 1.

**Decision:** Rejected. The "speed of detection" benefit is illusory because the same logic with a 24h cadence + grace period (Option 1 + auto-prune) is just as effective with much lower operational risk.

### Option 5: Auto-prune with grace period (extension of Option 1)

Same workflow as Option 1, but with a feature flag that auto-deletes orphans older than N days (proposed: 14 days).

**Pros:**

- Bounds blast radius — orphans cleaned within N days even without human action
- Grace period preserves recovery window

**Cons:**

- Destructive automation by definition; risk if the orphan-detection logic has a bug
- Requires high confidence in the detection accuracy before enabling

**Decision:** Deferred. Build Option 1 first, run it in detection-only mode for several cycles, evaluate auto-prune as a follow-up once we trust the metrics.

### Option 6: Upstream plugin retry / verification

Patch `openebs/velero-plugin` so its `DeleteSnapshot` verifies the snapshot was actually destroyed and retries on failure. Submit upstream.

**Decision:** Out of scope. Effort vs. blast radius is poor — most orphans we observed were from re-deploy, not plugin bugs.

## Decision

**Build Option 1 (detection + manual remediation) now. Defer Options 2, 5 as tracked follow-ups. Reject Options 3, 4, 6.**

## Rationale

- The observed pathology was a **one-time event** caused by re-deploy, not an ongoing failure mode. Velero's normal deletion path works correctly when the controller is present (verified by reading deletion-controller logs).
- Detection covers all known and unknown future causes of orphan accumulation. Prevention options each cover only specific causes.
- Manual remediation is acceptable because (a) the cleanup is straightforward (`zfs destroy` per orphan, `aws s3 rm` per prefix), (b) alerts page within the existing PagerDuty pipeline, and (c) the cost of a 24-hour-old orphan is negligible (a few MB on disk).
- Self-healing's apparent benefit (faster cleanup) is offset by its operational risk during recovery scenarios. The grace-period model (Option 5) is the safer self-healing version, but only worth enabling once detection accuracy is proven.

## Follow-ups

| Item                                                                     | Priority | Notes                                       |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------- |
| Add `Prune=false` to Velero Backup-class CRs in cdk8s                    | Medium   | Cheap, eliminates ArgoCD-prune failure mode |
| Document Velero re-deploy procedure (`velero backup delete --all` first) | Medium   | Goes in `packages/docs/guides/`             |
| Evaluate auto-prune (Option 5) after Option 1 has run for N cycles       | Low      | Re-decide once detection is trusted         |
| Kyverno guardrails (Option 3)                                            | Low      | Re-evaluate if detection misses an incident |

## Cross-References

- Implementation: `velero-orphan-audit` workflow in `packages/temporal/src/workflows/`
- Alerts: `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/velero.ts`
- Runbook: `packages/docs/guides/2026-05-05_velero-orphan-snapshot-remediation.md`
- Related: 2026-05-05 homelab health audit, Issue #1 (Bugsink Postgres PVC 100% full)
