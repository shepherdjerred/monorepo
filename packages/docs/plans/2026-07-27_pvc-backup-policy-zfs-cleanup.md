---
id: pvc-backup-policy-zfs-cleanup
type: plan
status: in-progress
board: true
verification: agent
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

- [ ] Implement and test the policy source, synthesis integration, and admission enforcement.
- [ ] Repair and deploy the multi-node orphan audit.
- [ ] Align live PVC labels through GitOps and an exact guarded backfill.
- [ ] Verify the newest backup and R2 object set.
- [ ] Quarantine confirmed orphan datasets and record the seven-day hold.
- [ ] Re-audit after the hold and obtain human approval before final deletion.
