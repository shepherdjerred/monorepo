---
title: Reclaim a released volume
description: Destroy the storage left behind when a retired service's PersistentVolumeClaim is deleted, and prove the dataset is actually gone.
sidebar:
  order: 12
---

Retiring a service deletes its PersistentVolumeClaim, but not its storage. Every
ZFS storage class in the cluster uses `reclaimPolicy: Retain`, so deleting a
claim only moves its PersistentVolume to `Released`. The OpenEBS `ZFSVolume`
resource and the ZFS dataset holding the data both survive, indefinitely and
invisibly.

They accumulate. Once more than five sit around for a day, the
`ReleasedPVsAccumulating` alert fires. That alert is the usual reason you are
reading this page.

Do this only for volumes belonging to a service that is genuinely gone. The data
is not recoverable afterwards unless you copy it somewhere first.

## 1. Find the candidates

```bash
kubectl get pv -o json | jq -r '
  .items[] | select(.status.phase == "Released")
  | "\(.metadata.name)  \(.spec.claimRef.namespace)/\(.spec.claimRef.name)  \(.spec.capacity.storage)"'
```

Capacity here is nominal. The datasets are thin provisioned, so a volume listed
as 50Gi may hold nothing at all — check what is really allocated before you
decide anything is worth preserving:

```bash
NODE_POD=$(kubectl -n openebs get pod -l role=openebs-zfs,app=openebs-zfs-node \
  --field-selector spec.nodeName=torvalds -o jsonpath='{.items[0].metadata.name}')
kubectl -n openebs exec "$NODE_POD" -c openebs-zfs-plugin -- \
  env PATH=/usr/local/sbin:/usr/sbin:/sbin:/usr/bin:/bin \
  zfs list -H -o name,used -r zfspv-pool-nvme zfspv-pool-hdd
```

## 2. Prove each candidate is really orphaned

For every volume, confirm all of the following. If any check cannot be run —
an empty listing, a failed command — stop. An unavailable check is not a pass.

- The phase is exactly `Released` and the reclaim policy is `Retain`.
- No live PersistentVolumeClaim matches `claimRef`, by name or by uid.
- No Pod in any namespace mounts that claim.
- The claim is absent from `pvc-backup-policy.json`. That catalog is the
  declared-desired inventory, so if it still names the claim, the volume is
  supposed to exist and you are about to delete something live.

## 3. Delete the ZFSVolume first, then the PersistentVolume

Order matters, and getting it backwards is the failure this page exists to
prevent. The dataset is destroyed by exactly one thing: the
`zfs.openebs.io/finalizer` on the `ZFSVolume` resource. Delete the
PersistentVolume first and that finalizer never runs — you are left with a
dataset that no Kubernetes object points at, findable only by listing the whole
pool.

```bash
PV=pvc-...
kubectl -n openebs delete zfsvolume "$PV" --timeout=120s
```

Then prove the dataset is gone. This is the step that matters, and it must fail:

```bash
kubectl -n openebs exec "$NODE_POD" -c openebs-zfs-plugin -- \
  env PATH=/usr/local/sbin:/usr/sbin:/sbin:/usr/bin:/bin \
  zfs list -H -o name zfspv-pool-nvme/$PV
# expected: "dataset does not exist"
```

If that command succeeds, the dataset is still there. Stop — do not delete the
PersistentVolume, or you will create the orphan described above.

Only once the dataset is confirmed gone:

```bash
kubectl delete pv "$PV"
```

Agents cannot run that last command; the harness blocks PersistentVolume
deletion. A human has to do it.

Work one volume at a time, starting with the emptiest as a canary.

## When the finalizer hangs

Almost always the node agent, not ZFS. Check that the `openebs-zfs-node` pod on
the volume's `spec.ownerNodeID` is Running and Ready, then read its logs. Common
causes, in order: the agent is not ready; the dataset is still mounted; a
snapshot or clone depends on it; a `zfs holds` entry.

Wait a minute first — the destroy is retried on the agent's reconcile loop.
Then clear the stale mount, or destroy the blocking snapshot by exact name, or
restart the agent pod.

**Never strip the finalizer to make the deletion go through.** That converts a
stuck resource into an orphaned dataset and is how the original mess was made.
If the agent is genuinely unrecoverable, destroy the dataset yourself inside the
node pod by exact, non-recursive name, confirm it is gone, and only then clear
the finalizer.

## 4. Check the invariant

Live PersistentVolumes, `ZFSVolume` resources, and datasets should be the same
set — not merely the same count.

```bash
kubectl get pv -o json | jq -r '.items[].metadata.name' | sort > /tmp/a
kubectl get zfsvolumes -n openebs -o json | jq -r '.items[].metadata.name' | sort > /tmp/b
diff /tmp/a /tmp/b
```

Comparing datasets needs care on two axes. Run the listing on **every** node,
not just `torvalds` — volumes are node-local, and checking one node reports a
false shortfall. Use `zfs list -d 1` so that any quarantine copies, which also
contain `/pvc-`, are not counted.

Finally, `kubectl get pv` should show nothing outside `Bound`, and
`ReleasedPVsAccumulating` resolves on the next scrape.

## Related

- [How the homelab is put together](/explanation/homelab/overview/)
- [What the alerts mean](/explanation/homelab/alerts/)
