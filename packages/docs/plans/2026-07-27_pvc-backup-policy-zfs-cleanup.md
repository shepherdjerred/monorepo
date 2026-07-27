---
id: pvc-backup-policy-zfs-cleanup
type: plan
status: awaiting-human
board: true
verification: human
disposition: active
---

# Explicit PVC Backup Policy and ZFS Cleanup

## Summary

- Replace size-based backup inference with an explicit inventory for all current ZFS PVCs.
- Enforce the inventory for synthesized, Helm-managed, and future PVCs.
- Repair the multi-node Velero orphan audit and remove the redundant large-PVC alert.
- Quarantine confirmed orphan ZFS datasets for seven days before a separately gated purge.

## Backup Policy

The policy must classify every PVC by exact namespace and name, fail closed for
unknown PVCs, and apply consistent Velero labels.

- Include application configuration, databases, and user-created state.
- Exclude media libraries, caches, bulk replicated data, and less-critical
  observability data.
- Include Eufy bridge state.
- Include only the Shuxin, Sjerred, and TSMC Minecraft instances.
- Include Alertmanager and Grafana state; exclude Prometheus TSDB, Loki,
  Pyroscope, and Tempo trace data.
- Include Syncthing configuration; exclude Syncthing data.

## Monitoring

- Enumerate every Running and Ready OpenEBS ZFS node pod during the Temporal
  orphan audit.
- Inspect every imported pool on each node without hardcoded pool assumptions.
- Include node identity in orphan results and metrics.
- Remove the manually reviewed large-PVC alert after admission enforcement is
  authoritative.

## ZFS Cleanup

- Freeze and revalidate the exact orphan candidate inventory before mutation.
- Quarantine each candidate with a verified same-pool ZFS send/receive copy.
- Let OpenEBS finalizers remove CR-backed source datasets.
- Use exact, non-recursive destruction for objectless source datasets.
- Retain quarantine copies for seven days and require a fresh audit plus human
  confirmation before final deletion.

## Verification

- Assert a complete, unique policy inventory with the expected include/exclude
  counts.
- Synthesize and validate admission resources and every emitted PVC.
- Verify live labels, the newest completed Velero backup, local snapshots, and
  the exact R2 object set.
- Test multi-node audit parsing and failure modes.
- Do not perform a live restore; record restoreability as unproven.

## Remaining

- [x] Implement and test the policy source, synthesis integration, and admission enforcement.
- [x] Repair the multi-node orphan audit.
- [x] Align live PVC labels through GitOps and an exact guarded backfill.
- [x] Verify the newest backup and R2 object set.
- [x] Quarantine confirmed orphan datasets and record the seven-day hold.
- [x] Schedule the post-hold re-audit and human-gated deletion decision.

## Human Verification

- [x] Review and merge PR #1715.
- [x] Confirm Argo CD has deployed the admission policies and Temporal audit update.
- [x] Run the guarded PVC label backfill, then verify that the next completed
      backup contains the exact 45 included PVCs.
- [ ] On or after 2026-08-03 12:30 PDT, review the quarantine re-audit and
      explicitly approve or reject final deletion.

## Quarantine Hold

- Dataset root: `zfspv-pool-nvme/quarantine-2026-07-27`
- Created: 2026-07-27 12:30 PDT
- Hold expires: 2026-08-03 12:30 PDT
- Contents: 28 unmounted filesystem datasets, 17.022 GiB allocated
- Original sources: 28 unmounted datasets, 23.556 GiB allocated
- Provenance: each child stores `sjer.red:quarantine-source`,
  `sjer.red:quarantine-created`, `sjer.red:quarantine-hold-until`, and the
  verified send/receive snapshot GUID in
  `sjer.red:quarantine-snapshot-guid`.
- Source removal: 11 ZFSVolume resources were deleted through their OpenEBS
  finalizers; 17 objectless sources were destroyed by exact, non-recursive name.
- Transfer snapshots were removed after GUID verification so the quarantine does
  not create false orphan-snapshot alerts.

Post-cleanup invariants:

- 72 live ZFS PVs = 72 ZFSVolume resources = 72 ordinary ZFS datasets.
- No live PV is missing a dataset or ZFSVolume resource.
- No ordinary dataset or ZFSVolume resource exists without a live PV.
- Both nodes report all ZFS pools healthy.
- 1,175 retained Velero snapshots map to the 27 retained Backup resources; zero
  orphan snapshots remain.

## Backup Verification

The post-deployment verification backup is
`pvc-policy-verification-202607271952`.

- Completed in 33 minutes with 167/167 Kubernetes items and 45/45 ZFS volume
  snapshots.
- Its volume snapshot inventory exactly equals the 45 enabled policy entries:
  no expected PVC is missing and no excluded PVC is present.
- R2 contains 45 metadata objects plus 45 non-empty data objects totaling
  93,482,625,400 bytes, with no zero-byte objects or unfinished multipart
  uploads.
- Torvalds retains all 45 local snapshots for the backup; Liskov retains zero,
  matching current volume placement.
- The eight warnings are Velero `Epoll wait interrupted` messages; the backup
  has no errors and every volume snapshot completed.
- All 72 live PVCs have a valid policy label (45 enabled and 27 disabled), and
  the guarded migration dry-run reports zero remaining changes.
- Restoreability remains unproven because a live restore was intentionally not
  performed.

<!-- temporal-agent-task
{
  "title": "Re-audit PVC backup policy and ZFS quarantine hold",
  "provider": "codex",
  "mode": "report-only",
  "runAt": "2026-08-03T12:30:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/plans/2026-07-27_pvc-backup-policy-zfs-cleanup.md"
  },
  "prompt": "Read Human Verification, Quarantine Hold, and Backup Verification. Re-audit all live PVC labels, the newest completed Velero backup and exact R2 volume objects, ZFS pool health, the 72 live PV/ZFSVolume/dataset equality, retained snapshots, and every child of zfspv-pool-nvme/quarantine-2026-07-27. Confirm the hold has expired and report whether final deletion is safe. Do not delete datasets, edit files, or mutate any live system; final deletion requires explicit human approval."
}
-->

## Session Log — 2026-07-27

### Done

- Added the 72-entry explicit PVC backup policy, fail-closed admission
  enforcement, guarded live-label migration, synthesis coverage, and source
  label alignment.
- Repaired the Temporal orphan audit to inspect every ready OpenEBS node and
  every imported pool, with node-aware metrics and strict parsing.
- Removed the redundant size-based Velero alert.
- Verified affected build, typecheck, tests, lint, repository checks, server-side
  admission dry-run, the newest Velero backup, and its exact R2 object set.
- Published draft PR #1715 from commit `00e3d443c`.
- Quarantined and removed all 28 confirmed orphan source datasets, then verified
  the post-cleanup live storage invariants recorded above.
- Scheduled report-only Temporal workflow
  `agent-task-re-audit-pvc-backup-policy-and-zfs-quarantine-ho-08861eca19c3e507e05f`
  for the end of the hold.
- Merged PR #1715, deployed chart `2.0.0-6549`, and completed the guarded label
  migration to the exact 45-enabled/27-disabled policy.
- Verified post-deployment backup
  `pvc-policy-verification-202607271952` against the exact policy, R2 objects,
  and local ZFS snapshots as recorded above.
- Diagnosed main build #6567's Argo wait failure as Kubernetes defaulting three
  `matchConstraints` fields on each mutating admission policy, then added the
  canonical fields and a synthesis regression assertion.

### Remaining

- Merge and deploy the Argo canonicalization follow-up.
- After the seven-day hold, review the scheduled re-audit and obtain explicit
  human approval before deleting the quarantine root.

### Caveats

- No live restore was performed, so restoreability is not proven.
- The newly included TSMC Minecraft dataset contributes roughly 77 GB logical
  data and made the verification backup take 33 minutes.
- The quarantine datasets are intentionally retained until the human-gated
  deletion decision on or after 2026-08-03 12:30 PDT.
