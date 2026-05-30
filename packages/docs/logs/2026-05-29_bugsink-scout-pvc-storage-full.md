# bugsink + scout ZFS volumes full — expansion remediation

## Status

Complete (relief shipped + verified live; GitOps reconcile pending PR #966 merge)

## Summary

PagerDuty had ~16 flapping High-urgency Homelab incidents. Triage against the live
`torvalds` cluster found the only **actively-broken** ones: two `zfs-ssd` volumes pinned at
**100% / 0B free / 0% free inodes**, both unable to write. Two distinct root causes:

| Volume                                    | Quota | Live (REFER) | Snapshots (USEDSNAP) | Avail | Cause                                                                                                                                                 |
| ----------------------------------------- | ----- | ------------ | -------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pgdata-bugsink-postgresql-0` (`bugsink`) | 8G    | 1.15G        | **6.85G**            | 0B    | 22 _legitimate_ retained Velero ZFS snapshots; Postgres block-churn diverges each 30–600 MB, so retention overhead alone fills the quota on a tiny DB |
| `scout-storage-claim` (`scout-prod`)      | 8G    | **7.77G**    | 242M                 | 0B    | Genuine data growth — `/data/db.sqlite` reached 7.77G                                                                                                 |

Not the 2026-05-05 orphan-snapshot issue (already remediated): snapshot counts are at the
healthy ~26/dataset retention target and every snapshot has a matching Velero backup CR (27 CRs).

## Fix

`zfs-ssd` supports online volume expansion (`allowVolumeExpansion: true`; expansion is a ZFS
quota bump, no pod restart). Per operator direction, expanded **out-of-band via kubectl** for
immediate relief, then reconciled the cdk8s source so ArgoCD stays Synced:

- bugsink → **32Gi**: `kubectl patch postgresql bugsink-postgresql -n bugsink --type merge -p '{"spec":{"volume":{"size":"32Gi"}}}'` (Zalando operator runs `storage_resize_mode: pvc` → patches PVC → CSI resizes). Source: `packages/homelab/.../resources/postgres/bugsink-db.ts:49`.
- scout → **24Gi**: `kubectl patch pvc scout-storage-claim -n scout-prod --type merge -p '{"spec":{"resources":{"requests":{"storage":"24Gi"}}}}'`. Source: `packages/homelab/.../resources/scout/index.ts:65` (`ZfsNvmeVolume` storage). Shared `createScoutDeployment` → scout-beta also bumps to 24Gi (harmless; reconciles on sync).

## Verified live (post-expansion)

- bugsink: PVC 32Gi (no resize conditions), ZFS quota 32G / **24G avail**, `df` 5% used, inodes 1%.
- scout: PVC 24Gi, ZFS quota 24G / **16G avail**, `df` 33% used.
- Prometheus: **0 firing** storage alerts (PVCStorageHigh / Bugsink critical / KubePersistentVolumeFillingUp / InodesFillingUp).
- PagerDuty: **0 open** incidents; storage incidents (#5256–5259) resolved.
- ArgoCD: bugsink + scout-prod **Healthy**; scout-prod **OutOfSync** (live 24Gi vs git 8Gi) — autosync is **OFF** on both, so no revert risk; PR #966 merge reconciles git → Synced.
- Pre-commit suite green (homelab typecheck, 247 tests, helm lint).

## Out of scope (other incidents triaged, not actively broken)

- 5× `VeleroLargePVCMayImpactBackups` — noisy warnings; the rule queries
  `kube_persistentvolumeclaim_resource_requests_storage_bytes > 200Gi` but can't read
  `velero.io/backup` labels, so it fires for every >200Gi PVC (media/dagger/seaweedfs/prometheus)
  even backup-excluded ones.
- HA-entities-unavailable and Temporal `anthropic` rate-limit — addressed by
  `packages/docs/plans/2026-05-24_pagerduty-remediation.md`.

## Session Log — 2026-05-29

### Done

- Expanded both full volumes out-of-band via kubectl: bugsink 8Gi→32Gi (via Postgresql CR), scout 8Gi→24Gi (via PVC). Verified online resize completed (ZFS quota + `df` + inodes).
- Reconciled cdk8s source: `resources/postgres/bugsink-db.ts:49` (32Gi) and `resources/scout/index.ts:65` (24Gi); typecheck + synth confirm `bugsink.k8s.yaml` size 32Gi, `scout-prod.k8s.yaml` storage 24Gi.
- Opened PR #966 (branch `fix/expand-bugsink-scout-pvcs`); full pre-commit suite passed.
- Verified clearance: Prometheus 0 firing storage alerts, PagerDuty 0 open incidents.

### Remaining

- Merge PR #966 → ArgoCD scout-prod returns to Synced (and bugsink stays Synced); confirm post-merge.

### Caveats

- scout `db.sqlite` will keep growing — expansion only defers the problem. Needs a retention/`VACUUM` strategy (follow-up).
- bugsink snapshot overhead (~7G) scales with DB churn; 32Gi gives ~24G headroom but watch if the DB grows materially.
- `VeleroLargePVCMayImpactBackups` remains noisy (can't see exclusion labels) — candidate for tuning.
- ArgoCD autosync is OFF on these apps; the out-of-band expansion will not be reverted, but the GitOps source is only authoritative after PR #966 merges.
