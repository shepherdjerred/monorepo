# Runbook: Resize the Dagger Engine Cache PVC

## Status

Complete (living runbook)

## When to use

- The `DaggerEnginePVCStorageHigh` / `DaggerEnginePVCStorageCritical` alert is firing.
- CI image pushes or `tofu apply` fail with `disk quota exceeded` / EDQUOT writing
  `/var/lib/dagger/worker/{containerdmeta,metadata_v2}.db`.
- You are bumping the engine cache size in code.

## Why a manual step is required

The Dagger engine runs as a **StatefulSet** (`dagger-dagger-helm-engine`, namespace `dagger`).
Its cache PVC (`data-dagger-dagger-helm-engine-0`) is created from the STS
`volumeClaimTemplate`. In Kubernetes, **`volumeClaimTemplates` are immutable** — editing
`storage:` in
[`dagger.ts`](../../homelab/src/cdk8s/src/resources/argo-applications/dagger.ts)
changes the desired template but does **not** resize the already-bound PVC. ArgoCD also
explicitly ignores the VCT (`ignoreDifferences` on `.spec.volumeClaimTemplates[]`), so it
will never reconcile the size. The PVC must be patched out of band. The storage class
`zfs-ssd-buildcache` has `allowVolumeExpansion: true`, so this is an online expand (no pod
restart, no data loss). **Expansion only — PVCs cannot shrink.**

> This drift is exactly what caused the 2026-06-08 outage: code said 2 Ti, the live PVC was
> still 1 Ti, and it hit its ZFS quota mid-build.

## Procedure

1. **Bump the code** (keeps desired state honest for the next fresh install): set
   `storage: "<N>Ti"` in `dagger.ts` (the `statefulSet.persistentVolumeClaim.resources.requests`
   block) and merge it.
2. **Patch the live PVC** to match (online expand):

   ```bash
   kubectl patch pvc data-dagger-dagger-helm-engine-0 -n dagger --type merge \
     -p '{"spec":{"resources":{"requests":{"storage":"<N>Ti"}}}}'
   ```

3. **Confirm the resize completed** (ZFS expand is near-instant):

   ```bash
   kubectl get pvc data-dagger-dagger-helm-engine-0 -n dagger \
     -o jsonpath='req={.spec.resources.requests.storage} cap={.status.capacity.storage} conds={.status.conditions[*].type}{"\n"}'
   # Done when: req == cap == <N>Ti and conds is empty (Resizing/FileSystemResizePending cleared)
   ```

   Verify the pool can back the new size first:

   ```bash
   kubectl get zfsvolumes.zfs.openebs.io -n openebs pvc-<uid> \
     -o jsonpath='{.spec.capacity}{"\n"}'   # bytes; uid = PVC's spec.volumeName
   ```

## Note: this does not lower disk usage

Expanding the PVC raises the ceiling. It does **not** reclaim cache. The engine's GC
(`gc.maxUsedSpace` in `dagger.ts`) bounds only the _reclaimable_ BuildKit cache — metadata
DBs, active leases, and in-flight exec mounts are uncounted, so total dataset usage runs
well above `maxUsedSpace` (post-incident: ~1.06 Ti used vs an 800 GB cap). Keep
`maxUsedSpace` an **absolute** value comfortably below the quota; never use a `%`/default
policy (it reads pool-level free space on this quota'd ZFS dataset and is unsafe). See
[the decision record](../decisions/2026-06-07_dagger-gc-and-pvc-drift.md).

## Applying a GC config change

`gc` lives in the engine `engine.json` (ConfigMap `dagger-dagger-helm-engine-config`, mounted
at `/etc/dagger/engine.json`). The engine reads it **only at startup**, so after ArgoCD syncs
a `configJson` change you must restart the engine for it to take effect:

```bash
kubectl rollout restart statefulset/dagger-dagger-helm-engine -n dagger
```

This is a brief cache-cold CI blip — schedule off-peak.
