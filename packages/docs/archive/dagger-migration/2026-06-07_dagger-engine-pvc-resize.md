# Runbook: Dagger Engine Cache Disk — Resize, Recovery & Maintenance Ops

## Status

Complete (living runbook)

## When to use

- Any `DaggerEnginePVCStorage*` / `DaggerEnginePVCFillPredicted` alert is firing.
- CI image pushes or `tofu apply` fail with `disk quota exceeded` / EDQUOT writing
  `/var/lib/dagger/worker/{containerdmeta,metadata_v2}.db`.
- Builds fail at `load workspace: . ERROR` / `unexpected EOF` and engine logs show
  `unable to open database file: out of memory (14)` (SQLite `SQLITE_FULL`) — the
  engine is **deadlocked at 100% full**.
- You are bumping the engine cache size in code.

## Recovery order — expand FIRST

**Online PVC expand is the first response to a full or filling disk**, including a
100%-full deadlock. It is instant (ZFS quota bump), needs no pod restart, loses no
cache, and un-deadlocks BuildKit by giving GC room to write its metadata so it can
prune on its own. Learned the hard way on 2026-07-03: the in-place purge was tried
first and failed (see below); the expand — tried last — was the only clean fix.

1. **Online expand** (below) — always try first if the pool has room.
2. **Full PV recreate** (below) — last resort, when the pool cannot back a larger
   quota or the volume is wedged beyond expansion.
3. **In-place cache purge (`rm -rf worker/ cache.db …`) — do NOT rely on it.** The
   live engine recreates `worker/` faster than `rm` deletes and holds open FDs to
   deleted blobs, so space isn't reclaimed until the process dies; under a rebuild
   burst it re-fills toward 100% immediately (2026-07-03: freed only to 87%,
   re-deadlock imminent within minutes).

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

> This drift caused the 2026-06-08 outage (code said 2 Ti, live PVC still 1 Ti) and
> bit again during the 2026-07-03 recovery: the PV recreate provisioned from the
> **live STS template, which was still 1 Ti**, silently regressing the fresh volume
> to half size. Fix the template itself with the [STS orphan-recreate op](#op-bake-the-vct-size-into-the-live-statefulset).

## Procedure: online expand

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

## Procedure: full PV recreate (last resort)

Key facts that shape this:

- StorageClass `zfs-ssd-buildcache` has reclaimPolicy **Retain** → deleting the PVC
  does NOT free the ZFS dataset; you MUST also delete the openebs `ZFSVolume` CR.
- ArgoCD app `dagger` has automated sync but **selfHeal off** → a manual `scale` is
  not auto-reverted.
- The fresh PVC is provisioned from the **live STS template** — run the
  [VCT bake-in op](#op-bake-the-vct-size-into-the-live-statefulset) first or the new
  volume comes back at the stale template size.

```bash
# 1. Stop the engine cleanly
kubectl -n dagger scale statefulset dagger-dagger-helm-engine --replicas=0
kubectl -n dagger wait --for=delete pod/dagger-dagger-helm-engine-0 --timeout=90s

# 2. Delete the PVC
kubectl -n dagger delete pvc data-dagger-dagger-helm-engine-0

# 3. Retain policy leaves the dataset — delete the ZFSVolume CR to actually free the pool
kubectl -n openebs delete zfsvolume <pvc-uid>       # uid = old PVC's spec.volumeName
kubectl delete pv <pvc-uid>                          # cosmetic cleanup of the Released PV

# 4. Recreate: the STS volumeClaimTemplate provisions a fresh empty volume
kubectl -n dagger scale statefulset dagger-dagger-helm-engine --replicas=1
kubectl -n dagger wait --for=condition=Ready pod/dagger-dagger-helm-engine-0 --timeout=120s
kubectl -n dagger exec dagger-dagger-helm-engine-0 -- df -h /var/lib/dagger
```

Expect a cold cache afterward: a family of transient failures (bun `EEXIST` link
races, snapshot-rename races, heavy-render timeouts, docker OOM `exit=-1`) that
should be retried, not code-fixed. See the
[2026-07-03 post-mortem](../logs/2026-07-03_dagger-engine-disk-full-outage.md).

## Op: bake the VCT size into the live StatefulSet

One-time op after changing `storage:` in code (and required before any PV recreate).
Deleting the STS **object** with `--cascade=orphan` leaves the pod and PVC running;
ArgoCD's automated sync recreates the STS from the current manifest (with the new
VCT size), which re-adopts the orphaned pod:

```bash
# Verify the drift (live template vs code):
kubectl -n dagger get sts dagger-dagger-helm-engine \
  -o jsonpath='{.spec.volumeClaimTemplates[0].spec.resources.requests.storage}{"\n"}'

# Recreate the STS object only (pod + PVC untouched):
kubectl -n dagger delete sts dagger-dagger-helm-engine --cascade=orphan

# ArgoCD automated sync recreates it within its sync interval; to force it:
#   argocd app sync dagger
# Then re-run the jsonpath above — it must now print the code's value (e.g. 2Ti).
```

As of 2026-07-03 the live template still says **1Ti** while code says 2Ti — this op
is pending.

## Note: expansion does not lower disk usage

Expanding the PVC raises the ceiling. It does **not** reclaim cache. The engine's GC
(`gc.maxUsedSpace` in `dagger.ts`) bounds only the _reclaimable_ BuildKit cache — metadata
DBs, active leases, and in-flight exec mounts are uncounted, so total dataset usage runs
well above `maxUsedSpace` (steady state observed 2026-07: ~1.33 Ti used vs an 800 GB cap).
Keep every GC value **absolute** and comfortably below the quota; never use a `%`/default
policy (it reads pool-level free space on this quota'd ZFS dataset and is unsafe). See
[the decision record](../decisions/2026-06-07_dagger-gc-and-pvc-drift.md).

GC also cannot stop a burst: it is a reactive, rate-limited sweeper. The 2026-07-03
outage wrote ~670 GB in 100 minutes (a Renovate rebase wave rebuilding every dep
branch at once) straight through a healthy GC to a 100%-full deadlock. Prevention is
headroom + input smoothing (`prConcurrentLimit` in `renovate.json`) + the
`DaggerEnginePVCFillPredicted` alert, not GC tuning.

## Applying a GC config change

`gc` lives in the engine `engine.json` (ConfigMap `dagger-dagger-helm-engine-config`, mounted
at `/etc/dagger/engine.json`). The engine reads it **only at startup**, so after ArgoCD syncs
a `configJson` change you must restart the engine for it to take effect:

```bash
kubectl rollout restart statefulset/dagger-dagger-helm-engine -n dagger
```

This is a brief cache-cold CI blip — schedule off-peak.

## Pending ops checklist (2026-07-03 fixes)

Run in order once the fixes PR is merged and ArgoCD has synced the `dagger` app:

```bash
# 1. Bake 2Ti into the live STS template (see op above)
kubectl -n dagger delete sts dagger-dagger-helm-engine --cascade=orphan
# wait for ArgoCD to recreate, then verify:
kubectl -n dagger get sts dagger-dagger-helm-engine \
  -o jsonpath='{.spec.volumeClaimTemplates[0].spec.resources.requests.storage}{"\n"}'   # → 2Ti

# 2. Load the new GC config (minFreeSpace 20% → 400GB) — off-peak
kubectl rollout restart statefulset/dagger-dagger-helm-engine -n dagger

# 3. Delete the orphaned Released PV from the 2026-07-03 recovery (data already destroyed)
kubectl delete pv pvc-5e89054d-516e-4bd0-9a8b-9b6b7b0703c2
```
