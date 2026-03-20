# Decision: Reduce Dagger Engine Disk Write Amplification

> **Note (2026-03-19):** Dagger has been removed from the CI pipeline entirely. This decision record is kept for historical context.

**Date:** 2026-02-24
**Status:** Proposed
**Triggered by:** PagerDuty Incident #3042 — 130+ MB/s sustained writes to nvme1n1

## Context

On 2026-02-24 at ~04:53 UTC, the `node_disk_written_bytes_total` alert fired for `nvme1n1` on torvalds (100.102.88.89). The alert reported 130.2 MB/s sustained writes, peaking at 177 MB/s over a 35-minute window.

### Investigation Summary

**What happened:**

- 10 concurrent Buildkite job pods connected to the single Dagger engine simultaneously
- Each ran `dagger call ci`, creating separate BuildKit sessions on the shared engine
- System load spiked to **587 on 32 cores** (18x overloaded)
- The Dagger engine's 1 TiB ZFS-backed PVC on `zfspv-pool-nvme` (nvme1n1) absorbed all the I/O

**Disk write breakdown:**

- **202 GB** total raw writes to nvme1n1 in one hour
- **43 GB** of temporary BuildKit layer data (peak usage: 888 GB, baseline: 845 GB)
- **~43 GB** of GC deletes as sessions ended (Dagger GC cleaned up unreferenced layers)
- **~116 GB** of ZFS write amplification (copy-on-write with `compression=off`, `recordsize=128k`, concurrent random I/O)
- Net growth: only **30 GB** (815 GB -> 845 GB)

**Timeline from Dagger engine metrics:**

| Time (UTC) | Disk Used | Sessions | Cache Entries | Load |
| ---------- | --------- | -------- | ------------- | ---- |
| 05:01      | 881 GB    | 10       | 235,056       | 204  |
| 05:04      | 874 GB    | 10       | 235,129       | 397  |
| 05:11      | 871 GB    | 9        | 211,295       | 587  |
| 05:14      | 885 GB    | 9        | 211,300       | 304  |
| 05:23      | 888 GB    | 3        | 71,097        | 94   |
| 05:24      | 886 GB    | 0        | 0             | 39   |
| 05:25      | 845 GB    | 0        | 0             | 20   |

### Root Cause

No concurrency control on Dagger engine access. The existing plan doc (`packages/docs/plans/buildkite.md`) already identifies: _"One Dagger engine pod (K8s) means all `dagger call` must be serialized."_ But serialization was never implemented.

Additionally, the ZFS storage class has `compression=off`, meaning every byte of container layer data generates 1:1 physical writes plus ZFS copy-on-write overhead.

## Current Configuration

**Dagger engine:**

- Helm chart: `dagger-helm` v0.19.11 (custom patched image)
- Storage: 1 TiB PVC on `zfs-ssd` storage class
- GC: `maxUsedSpace=800GB`, `reservedSpace=100GB`, `minFreeSpace=15%`
- Currently using 845 GB of 1 TiB

**ZFS storage class (`zfs-ssd`):**

- Pool: `zfspv-pool-nvme` (Samsung 990 PRO 4TB NVMe)
- `compression=off`, `dedup=off`, `recordsize=128k`, `shared=yes`

**Buildkite pipeline:**

- No `concurrency` or `concurrency_group` settings
- 2-3 steps per build, all calling into the same Dagger engine
- Multiple builds can run in parallel with no limits

## Proposed Changes

### 1. Serialize Dagger access across builds

Add concurrency control to every Dagger-calling Buildkite step:

```yaml
# .buildkite/pipeline.yml — add to every dagger step:
concurrency: 1
concurrency_group: "dagger-engine"
```

This is the most impactful fix and the simplest to implement. The full pipeline rewrite in `packages/docs/plans/buildkite.md` adds this properly across all generated steps.

**Impact:** Eliminates concurrent session thrash entirely (~10x reduction in peak I/O)

### 2. Create a dedicated build-cache storage class

Rather than modifying the shared `zfs-ssd` class, create a `zfs-ssd-buildcache` class optimized for Dagger's workload:

**File:** `src/cdk8s/src/misc/storage-classes.ts`

```typescript
export const BUILDCACHE_STORAGE_CLASS = "zfs-ssd-buildcache";

new KubeStorageClass(chart, "host-zfs-ssd-buildcache", {
  metadata: { name: BUILDCACHE_STORAGE_CLASS },
  provisioner: "zfs.csi.openebs.io",
  allowVolumeExpansion: true,
  reclaimPolicy: "Retain",
  parameters: {
    fstype: "zfs",
    poolname: "zfspv-pool-nvme",
    compression: "lz4", // ~2x reduction in physical writes; ~10 GB/s, faster than NVMe
    dedup: "off",
    recordsize: "128k",
    sync: "disabled", // safe for reproducible build cache; eliminates fsync overhead
    logbias: "throughput", // avoids ZIL double-writes
  },
  volumeBindingMode: "WaitForFirstConsumer",
});
```

Then point the Dagger app at it:

**File:** `src/cdk8s/src/resources/argo-applications/dagger.ts`

```typescript
storageClassName: BUILDCACHE_STORAGE_CLASS,  // was NVME_STORAGE_CLASS
```

**Rationale for each setting:**

- `compression=lz4`: Container layers (JS, binaries, JSON, package metadata) compress 1.5-3x. LZ4 is CPU-free at NVMe speeds. Incompressible data is stored uncompressed with zero penalty.
- `sync=disabled`: BuildKit issues fsync calls that force ZIL writes. The Dagger cache is fully reproducible — losing 5 seconds of cache data in a crash just means the next build rebuilds those layers. No data durability concern.
- `logbias=throughput`: Prevents double-writes through the ZIL. Harmless if sync is disabled, helpful if it isn't.

**Impact:** ~2-3x reduction in physical bytes written per build

**Caveat:** Storage class changes only apply to new PVCs. The existing Dagger PVC must be either:

- Recreated (loses ~845 GB cache, which rebuilds over subsequent CI runs), or
- Modified in-place on the node: `zfs set compression=lz4 sync=disabled logbias=throughput zfspv-pool-nvme/pvc-7bc7b914-4c38-44bf-a1d5-bb4800b66671`

### 3. Lower GC threshold

Reduce max cache size to decrease churn during builds:

**File:** `src/cdk8s/src/resources/argo-applications/dagger.ts`

```typescript
configJson: JSON.stringify({
  gc: {
    maxUsedSpace: "600GB",    // was 800GB — more headroom for build spikes
    reservedSpace: "100GB",
    minFreeSpace: "20%",      // was 15%
  },
}),
```

Current usage is 845 GB with 800 GB limit — the GC is barely keeping up. Lowering to 600 GB gives more breathing room and reduces the amount of churn during concurrent writes + GC deletes.

**Impact:** Reduces GC write churn during builds

### 4. Set atime=off on the NVMe pool

Every file read in a container build triggers a metadata write to update access time. For builds reading thousands of files, this is pure waste.

```bash
# One-time on node (persists across reboots for ZFS):
talosctl -n torvalds shell -- zfs set atime=off zfspv-pool-nvme
```

Or add `atime: "off"` to the storage class parameters if OpenEBS ZFS CSI supports it.

**Impact:** Eliminates read-triggered metadata writes

## Impact Summary

| Fix                       | Effort                  | Write I/O Reduction           | Risk                        |
| ------------------------- | ----------------------- | ----------------------------- | --------------------------- |
| Serialize Dagger sessions | Pipeline YAML change    | ~10x (eliminates concurrency) | Low                         |
| LZ4 compression           | Storage class + zfs set | ~2-3x (fewer physical bytes)  | None                        |
| sync=disabled             | Storage class + zfs set | ~2x on top of LZ4             | Low (cache is reproducible) |
| Lower GC threshold        | Dagger config change    | Reduces churn spikes          | Low                         |
| atime=off                 | One-time node command   | Moderate                      | None                        |

Combined, these changes would reduce the per-build disk write impact from ~202 GB physical / 177 MB/s peak down to roughly ~15-30 GB physical / ~15 MB/s — effectively invisible.

## References

- PagerDuty Incident #3042
- `packages/docs/plans/buildkite.md` — Pipeline serialization plan (pre-existing)
- OpenZFS tuning guide: compression, sync, logbias recommendations
- Dagger engine GC configuration: `maxUsedSpace`, `reservedSpace`, `minFreeSpace`
- containerd ZFS snapshotter tuning: recommends `atime=off`, `compression=lz4`, `sync=disabled`
