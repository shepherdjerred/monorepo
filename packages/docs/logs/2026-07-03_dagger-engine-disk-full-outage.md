# Dagger CI Engine Disk-Full Outage & Recovery

## Status

Complete (engine recovered; durable prevention still open — see Remaining)

## Summary

On 2026-07-03 (~19:20–22:35 UTC) the homelab Dagger CI engine
(`dagger-dagger-helm-engine-0`, namespace `dagger`) went hard-down. **Every**
Buildkite build across all branches failed at the Dagger `load workspace` step,
blocking ~12 open PRs. Root cause: the engine's build-cache volume filled to
**100%** and deadlocked — buildkit's garbage collector could not free space
because it needs to _write_ metadata to prune, and there was no free space to
write it. Recovered by purging the cache and ultimately **recreating the PV**
from scratch.

This was initially misdiagnosed (by the PR-babysitter orchestration) as a
transient "Dagger Cloud trace-upload blip." That blip was real but separate and
brief (~20:16–20:27 UTC); the ongoing outage was the disk-full deadlock.

## Timeline

- **~19:20 UTC** — cache hits 100%; builds begin failing at `load workspace`.
  Last known-good builds: #4872 / #4876 (~19:09–19:15 UTC).
- **~20:16–20:27 UTC** — a separate, brief dagger.cloud telemetry blip
  (`failed to emit telemetry ... trace information incomplete`; jobs exit 1
  _after_ all internal steps pass). Overlapped and muddied diagnosis.
- **20:29:55 UTC** — engine container crashes (exitCode 2) and self-restarts,
  but the PVC is still full so it comes back deadlocked.
- **~21:55 UTC** — diagnosed disk-full deadlock via engine logs + `df`.
- **~22:05 UTC** — in-place cache purge (`rm -rf worker/ + cache dbs`) +
  pod restart. Freed only to 87% (277G) because the still-running engine
  recreated `worker/` and held FDs to deleted blobs; ~1.8T orphaned cache
  remained.
- **~22:30 UTC** — disk re-filling under the cold-cache rebuild burst
  (277G → 135G in minutes); re-deadlock imminent.
- **~22:33 UTC** — operator directed a full reset: kill pod, recreate PV.
  Fresh empty volume provisioned; CI restored.

## Root cause

- The Dagger engine has **no cache GC / keep-storage limit configured**
  (no GC env vars, no GC flags on the container args — only
  `--addr tcp://0.0.0.0:8080 --addr unix:///run/dagger/engine.sock`). With no
  cap, the buildkit content store grows unbounded until the volume is 100% full.
- Once at 100%, the deadlock is self-sustaining: buildkit's GC (`Prune`) must
  write `metadata_v2.db` to prune, which fails with `disk quota exceeded`, so it
  can never reclaim space on its own.

### Evidence (engine logs)

```
level=error msg="failed to serve request"
  error="open client db: ping .../clientdbs/<id>.db...: unable to open database file: out of memory (14)"
level=error msg="gc error: write /var/lib/dagger/worker/metadata_v2.db: disk quota exceeded ..."
```

`out of memory (14)` is SQLite's `SQLITE_FULL` surfacing (can't extend the DB
file). Client-side, builds report `load workspace: . ERROR` / `unexpected EOF`
because the engine can't open its databases.

### Disk state at diagnosis

```
zfspv-pool-nvme/pvc-5e89054d-...  2.1T  2.1T  0  100%  /var/lib/dagger
```

## How to diagnose this again (runbook)

```bash
# 1. Is the engine erroring?
kubectl -n dagger get pod dagger-dagger-helm-engine-0            # restarts climbing?
kubectl -n dagger logs dagger-dagger-helm-engine-0 --since=5m \
  | grep -iE "out of memory|disk quota|load workspace.*ERROR"

# 2. Is the cache volume full?  (the smoking gun)
kubectl -n dagger exec dagger-dagger-helm-engine-0 -- df -h /var/lib/dagger

# 3. Confirm which builds are failing at load-workspace (not real code):
#    a job whose internal steps (bun install/typecheck/lint) all show ✔ but the
#    job exits 1 == infra, NOT code. A job that dies at "load workspace: ERROR"
#    before any step runs == engine down.
```

Real-vs-infra tell for the babysitter agents: **read the failed job log.**

- `load workspace: . ERROR` / `unexpected EOF` before any step → engine down.
- All steps ✔ then `exited status 1` after the `dagger.cloud` trace line →
  telemetry/trace blip (transient).
- `failed to rename .../snapshots/new-… → …: file exists` → buildkit
  snapshot-rename race under cold-cache concurrency (transient; clears as cache
  warms). Retry, don't code-fix.

## Remediation performed

### Attempt 1 — in-place purge (partial, do NOT rely on this alone)

```bash
kubectl -n dagger exec dagger-dagger-helm-engine-0 -- \
  sh -c 'rm -rf /var/lib/dagger/worker /var/lib/dagger/cache.db /var/lib/dagger/dagql-cache.db*'
kubectl -n dagger delete pod dagger-dagger-helm-engine-0   # release FDs
```

Only partially effective: the **live engine recreates `worker/`** during the
`rm` and holds FDs to deleted blobs, so space isn't reclaimed and ~1.8T of
orphaned cache lingers. Under a rebuild burst it re-fills toward 100% again.

### Attempt 2 — full PV recreate (the actual fix)

Key facts that shaped this:

- StorageClass `zfs-ssd-buildcache` (provisioner `zfs.csi.openebs.io`),
  reclaimPolicy **Retain** → deleting the PVC does _not_ free the ZFS dataset.
- ArgoCD app `dagger` has automated sync but **selfHeal off** → a manual
  `scale` is not auto-reverted.

```bash
# 1. Stop the engine cleanly (Argo won't fight it; selfHeal is off)
kubectl -n dagger scale statefulset dagger-dagger-helm-engine --replicas=0
kubectl -n dagger wait --for=delete pod/dagger-dagger-helm-engine-0 --timeout=90s

# 2. Delete the PVC
kubectl -n dagger delete pvc data-dagger-dagger-helm-engine-0

# 3. Retain policy leaves the dataset — delete the openebs ZFSVolume CR to
#    actually destroy the ZFS dataset and free the pool:
kubectl -n openebs delete zfsvolume pvc-5e89054d-516e-4bd0-9a8b-9b6b7b0703c2
#    (the released PV `kubectl delete pv <name>` is cosmetic cleanup; it was
#     permission-blocked in this session and left as a harmless dangling object)

# 4. Recreate: StatefulSet volumeClaimTemplate provisions a fresh empty volume
kubectl -n dagger scale statefulset dagger-dagger-helm-engine --replicas=1
kubectl -n dagger wait --for=condition=Ready pod/dagger-dagger-helm-engine-0 --timeout=120s
kubectl -n dagger exec dagger-dagger-helm-engine-0 -- df -h /var/lib/dagger
```

Result: fresh volume `1.0T total, 5.6G used, 1019G free`, engine Ready, 0 errors.

> ⚠️ **Size regression:** the recreated PVC came back at the volumeClaimTemplate
> default **1Ti**; the previous PVC had been manually expanded to **2Ti**. The
> PVC supports expansion (`allowVolumeExpansion: true`) if 2Ti is wanted back.

## Impact on PRs

No PR code was at fault. All ~12 open PRs' "failures" during the window were
infra. Babysitter agents were told to **hold** (stop retrying — futile on a full
disk), then **re-trigger** after recovery. Agents re-trigger builds with
`bk build rebuild <prior-build-number>` (a direct `bk build create` on a feature
branch is 422-rejected by pipeline branch-filtering).

## Session Log — 2026-07-03

### Done

- Diagnosed the CI-wide outage as a Dagger engine disk-full deadlock (not a
  cache blip, not any PR's code).
- Recovered the engine: in-place purge (partial) then full PV recreate via
  scale-to-0 → delete PVC → delete openebs `ZFSVolume` CR → scale-to-1.
- Restored CI; re-triggered all held PR builds on the clean engine.
- Added a `df`-based disk watchdog (background) to catch re-fill early.

### Remaining

- **Durable prevention (highest priority):** configure a cache GC / keep-storage
  limit on the Dagger engine (dagger Helm values in `packages/homelab`) so the
  cache self-prunes and can never re-deadlock. Without it this WILL recur —
  faster now on the 1Ti volume.
- **Volume size:** decide whether to expand the fresh PVC back to 2Ti
  (`kubectl -n dagger patch pvc data-dagger-dagger-helm-engine-0` /
  edit the requested storage; SC allows expansion).
- **Cleanup:** the old released PV `pvc-5e89054d-...` (2Ti, Released) is a
  harmless dangling object — `kubectl delete pv pvc-5e89054d-...` when convenient.

### Caveats

- The in-place `rm` purge is unreliable while the engine runs (it recreates
  `worker/` and holds FDs). Prefer the full scale-0 → delete-PVC → delete
  ZFSVolume → scale-1 recreate.
- reclaimPolicy is **Retain**: you MUST delete the openebs `ZFSVolume` CR (not
  just the PVC/PV) to actually free the ZFS dataset from the pool.
- Cold-cache rebuild bursts trigger transient buildkit snapshot-rename races
  (`file exists`) and are slow; these clear as the cache warms — retry, don't
  code-fix.
