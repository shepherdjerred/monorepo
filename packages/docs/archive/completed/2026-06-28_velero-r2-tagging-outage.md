---
id: plan-2026-06-28-velero-r2-tagging-outage
type: plan
status: complete
board: false
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
2. **R2 lifecycle backstop** on `zfspv-incr/` (mirror SeaweedFS lifecycle). Confirm R2 token has lifecycle perms (current `r2` profile got AccessDenied on GetBucketLifecycleConfiguration). **STILL OPEN** — the 2026-06-29 orphan proved normal backup expiry does not clean R2, so this is the durable fix to stop re-accumulation.
3. ~~**Backup-outage alert**~~ **DONE** — rules live in `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/velero.ts` (`velero_backup_last_status != 1` + no-backup-window).
4. Resolve PD #5860, #5849 once metrics recover. **#5860/#5849 already cleared.** New R2-capacity incidents **#5877/#5880** (fired 2026-07-01 as the backlog crossed 1.5 TB) will auto-resolve once `cloudflare_r2_storage_bytes` refreshes below threshold (Cloudflare GraphQL exporter lags real state up to ~24h; actual bucket verified at 294 GiB / 0.29 TiB).

## Verification

- `bun run typecheck` + `bun run build` in `packages/homelab` (cdk8s synth clean).
- Post-merge: `kubectl get backups.velero.io -n velero` shows new `Completed` backups; tarball present in R2.
- After prune: `cloudflare_r2_storage_bytes` well under 1.2 TiB; `zfs_dataset_snapshot_count` max < 35; `velero_orphan_local_snapshots_total` → ~0.
- Renovate Dependency Dashboard lists v1.14.1 as ignored (not hidden).

## Out of scope (other open PD incidents)

PD #5858 (SSD write volume), #5857 (HA entities unavailable), #5838 (scout reports epoch-0 alert) — separate, not addressed here.

## Historical follow-up state

- Complete and verify the work described in `Velero R2 backup outage — pin plugin, block Renovate, reclaim R2`.
