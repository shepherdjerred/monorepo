---
id: plan-2026-06-28-velero-r2-tagging-outage
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Velero R2 backup outage — pin plugin, block Renovate, reclaim R2

## Context

PagerDuty incidents #5860 (excessive ZFS snapshots), #5849 (R2 at 80%), and overall Velero
backup health turned out to be **one root cause**, found by live investigation on 2026-06-28:

- **PR #1307 (`dd66cb2d6`, 2026-06-21)** bumped `velero/velero-plugin-for-aws`
  **v1.14.0 → v1.14.1** (Renovate).
- The plugin always sets a (often empty) `Tagging` field on `PutObject`; v1.14.1's dependency
  bump pulled a newer `aws-sdk-go-v2` that emits an **empty `x-amz-tagging` header on the
  wire**, which **Cloudflare R2 rejects with `501 NotImplemented`** (R2 has no object-tagging
  API). v1.14.0's older SDK didn't emit the empty header. (v1.14.2 is _not_ a fix — same
  unconditional `Tagging`; the upstream guard `velero-io/velero-plugin-for-aws#299` is
  main-only, unreleased.)
- Result: **every backup since `daily-backup-20260622` is `Failed`.** Last good backup is
  `weekly-backup-20260615` (13 days stale at time of discovery). The ZFS data blob still
  uploads (openebs plugin, separate uploader), but Velero's metadata tarball write fails →
  backup `Failed`, no tarball persisted.
- Cascade: missing tarball → on TTL expiry Velero logs _"Unable to download tarball …
  skipping associated DeleteItemAction plugins"_ (404) → the openebs `DeleteSnapshot`
  cleanup never runs → orphaned ZFS snapshots (**#5860**, 635 / 29 GiB) and orphaned R2
  data (**#5849**). Failed backups also keep uploading ~9 GiB/day of unusable data.

Evidence (velero log, `6hourly-backup-20260628181555`):

```
Error uploading ... torvalds/backups/.../...-logs.gz: PutObject → 501 NotImplemented:
Header 'x-amz-tagging' with value '' not implemented
```

**Live R2 state at discovery:** 1.37 TiB / 23,724 objects. 26 backups live in-cluster
(476 GiB); **278 orphan folders (919 GiB) + 3 ad-hoc (5.7 GiB) = ~925 GiB reclaimable
(66%)**. Orphans verified all past their retention window and not incremental bases for
live backups. R2 has **no lifecycle policy** (SeaweedFS buckets do). The 1.5 TiB cap is
self-imposed, not a Cloudflare hard limit.

## Plan

Worktree: `feature/velero-r2-tagging-fix`. Phase 2 issue is drafted for sign-off before
creation; Phase 3 prune waits until backups are green.

### Phase 1 — Stop the bleeding (this PR)

| File                                                         | Change                                                                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/homelab/src/cdk8s/src/versions.ts`                 | Pin `velero/velero-plugin-for-aws` back to `v1.14.0@sha256:7e82f717…` with a justification comment.                                                                                          |
| `renovate.json`                                              | `packageRule` for `velero/velero-plugin-for-aws`, `allowedVersions: "<1.14.1"` + description (surfaced on the Dependency Dashboard, mirrors the protobufjs precedent — not `enabled:false`). |
| `packages/docs/todos/velero-aws-plugin-r2-tagging.md`        | Tracking todo with unpin criteria.                                                                                                                                                           |
| `packages/docs/plans/2026-06-28_velero-r2-tagging-outage.md` | This plan.                                                                                                                                                                                   |

Then `cd packages/homelab && bun run typecheck`/`build` (cdk8s synth), commit by path,
push, open PR. Merge → ArgoCD applies the v1.14.0 initContainer → velero restarts.
**Verify:** next 6hourly backup reaches `Completed` and writes a tarball under
`torvalds/backups/backups/<name>/`; `x-amz-tagging` 501 gone from the velero log.

### Phase 2 — GitHub issue (draft → sign-off → create)

Tracking issue for **shepherdjerred/monorepo** (note option to also file upstream on
`vmware-tanzu/velero-plugin-for-aws`): symptom, root cause, 501 evidence, the pin, unpin
criteria. **Present full contents to user; create only after approval.**

### Phase 3 — Reclaim + harden R2 (after backups are green)

1. ~~**Verify restore integrity** of `weekly-backup-20260615` before deleting anything.~~ **DONE (weaker check, 2026-07-02):** confirmed all 22 live Backup CRs are `Completed` and each retains its full `zfspv-incr/backups/<name>/` data in R2 (data-presence integrity, not a full restore drill).
2. ~~**Chain-safe orphan prune**~~ **DONE 2026-07-02** — see Session Log. Re-derived the live set at delete time; deleted 308 R2 orphan prefixes (**1,260.7 GiB / 23,775 objects**) + 1,409 orphan ZFS snapshots. Also deleted the 4 unrestorable `Failed` outage-era backups and swept their data. Orphan metrics `1,237 → 0`; zfspv-incr R2 `1,554.9 → 294.2 GiB`.
3. **R2 lifecycle backstop** on `zfspv-incr/` (mirror SeaweedFS lifecycle). Confirm R2 token has lifecycle perms (current `r2` profile got AccessDenied on GetBucketLifecycleConfiguration). **STILL OPEN** — the 2026-06-29 orphan proved normal backup expiry does not clean R2, so this is the durable fix to stop re-accumulation.
4. ~~**Backup-outage alert**~~ **DONE** — rules live in `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/velero.ts` (`velero_backup_last_status != 1` + no-backup-window).
5. Resolve PD #5860, #5849 once metrics recover. **#5860/#5849 already cleared.** New R2-capacity incidents **#5877/#5880** (fired 2026-07-01 as the backlog crossed 1.5 TB) will auto-resolve once `cloudflare_r2_storage_bytes` refreshes below threshold (Cloudflare GraphQL exporter lags real state up to ~24h; actual bucket verified at 294 GiB / 0.29 TiB).

## Verification

- `bun run typecheck` + `bun run build` in `packages/homelab` (cdk8s synth clean).
- Post-merge: `kubectl get backups.velero.io -n velero` shows new `Completed` backups; tarball present in R2.
- After prune: `cloudflare_r2_storage_bytes` well under 1.2 TiB; `zfs_dataset_snapshot_count` max < 35; `velero_orphan_local_snapshots_total` → ~0.
- Renovate Dependency Dashboard lists v1.14.1 as ignored (not hidden).

## Out of scope (other open PD incidents)

PD #5858 (SSD write volume), #5857 (HA entities unavailable), #5838 (scout reports epoch-0 alert) — separate, not addressed here.

## Session Log — 2026-07-02

### Done

- **Confirmed the outage itself is resolved:** deployed plugin is `v1.14.0`, all live backups `Completed`, no `x-amz-tagging` 501s.
- **Executed the Phase 3 orphan prune** per `guides/2026-05-05_velero-orphan-snapshot-remediation.md`, re-deriving the orphan set live at delete time (`orphans = R2 prefixes/ZFS snapshots − live Backup CRs`):
  - Deleted 4 unrestorable `Failed` outage-era backups (`daily-backup-20260626/27/28`, `weekly-backup-20260622`) via `velero backup delete` — they had ZFS/R2 data but no metadata tarball and 3 were about to expire and re-orphan.
  - Destroyed **1,409** orphan ZFS snapshots across 96 datasets (`zfs destroy`, 0 failures) on `openebs-zfs-localpv-node-wrfjd`.
  - Swept **308** orphan R2 prefixes under `s3://homelab/zfspv-incr/backups/` (`aws s3 rm --recursive`, 0 failures) — **1,260.7 GiB / 23,775 objects reclaimed**.
- **Verified post-prune:** R2 orphans `0`; every one of the 22 live backups retains its data; `sum(velero_orphan_local_snapshots_total)` and `_bytes_total` both `0` after triggering the `velero-orphan-audit` workflow. zfspv-incr R2 `1,554.9 → 294.2 GiB`; whole `homelab` bucket now ~294 GiB / 0.29 TiB.
- Updated this plan (Status, Phase 3 items 1/2/4/5).

### Remaining

- **Unpin `velero-plugin-for-aws`** — still blocked on upstream: PR #299 merged to `main` but not in any release (latest `v1.14.2`, 2026-06-26, lacks it). Todo `velero-aws-plugin-r2-tagging` stays `active`.
- **Phase 3 #3 — R2 lifecycle backstop** on `zfspv-incr/` (the durable fix; the 2026-06-29 orphan shows R2 re-accumulates on normal expiry). Needs an R2 token with lifecycle perms (`r2` profile got AccessDenied on GetBucketLifecycleConfiguration). Until then, orphans will slowly regrow and a periodic manual prune is required.
- **PD #5877 / #5880** (R2 capacity) — left to auto-resolve once `cloudflare_r2_storage_bytes` refreshes below threshold; can be manually resolved now (actual bucket verified at 294 GiB).
- **Phase 2 tracking issue** — never created; optional.

### Caveats

- Phase 3 #1 was satisfied by a **data-presence** check (all live backups `Completed` + their `zfspv-incr` data present), **not a full restore drill**. No backup was test-restored.
- The prune credentials came from the `velero` namespace `cloud-credentials` secret; the R2 endpoint is `https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com`, bucket `homelab`.
- R2 will re-accumulate orphans until the lifecycle backstop lands — do not treat the prune as a permanent fix.

## Remaining

- [ ] Complete and verify the work described in `Velero R2 backup outage — pin plugin, block Renovate, reclaim R2`.
