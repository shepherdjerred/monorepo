# ZFS Pool Fragmentation — Accepted Tradeoff on SSD Pools

**Date:** 2026-05-05
**Status:** Decided — raise alert thresholds, accept moderate fragmentation as a property of the workload.

## Summary

Both ZFS pools (`zfspv-pool-nvme`, `zfspv-pool-hdd` — note: misnamed, the "hdd" pool is actually SATA SSDs) accumulate fragmentation over time as a natural consequence of copy-on-write semantics. The `zfspv-pool-nvme` pool was at 61% at the 2026-05-05 audit, which fired both `ZfsPoolHighFragmentation` (50%) and `ZfsPoolFragmentationHigh` (50%, duplicate alert) — but neither the existing `zfs-maintenance` Temporal workflow (autotrim + scrub) nor any other affordable mitigation will reduce that number. This doc explains why we're raising the thresholds and accepting the metric.

## Background

ZFS is copy-on-write: every write goes to a fresh block, and old blocks become free only when no live state (or live snapshot) references them. Over time on a busy pool, free space gets distributed across many small holes between live blocks, which is exactly what `zpool list -o fragmentation` measures.

Important: **ZFS's `fragmentation` percentage is about free-space layout, not about whether file data is contiguous on disk**. A 60% fragmentation reading means "60% of the free space exists in fragments smaller than the optimal allocation size", not "60% of files are slow to read".

### Why the existing workflow doesn't help

`packages/temporal/src/activities/zfs-maintenance.ts` runs weekly and does two things:

| Operation        | What it actually does                                                                | Effect on fragmentation |
| ---------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| `zpool scrub`    | Re-reads all data to verify checksums; repairs corrupted blocks if redundancy exists | None                    |
| `zpool autotrim` | Sends TRIM commands to the SSD for unused blocks; helps the controller's GC          | None on the ZFS layer   |

Neither rewrites live data, neither moves blocks, neither defragments anything. They were the right operations for "verify the pool is healthy and tell the SSD what's free", but not for fragmentation.

### What WOULD reduce fragmentation

Real defragmentation requires re-writing the data into a fresh dataset:

1. `zfs send <pool>/<dataset>@snap | zfs receive <pool>/<dataset>-new`
2. Swap mountpoints, delete old dataset.

This is operationally expensive: every consumer of the dataset must be paused, the send/receive throughput is bounded by the pool's read+write rate, and you need ~2× the dataset's storage temporarily. For a homelab cluster with ~30 backed-up volumes (some hundreds of GiB), it's a multi-hour off-hours operation per volume.

## Performance impact at observed fragmentation

The fragmentation values right now (HDD pool: 22%, NVMe pool: 61%) are well-tolerated for the cluster's workload because:

- Both pools are SSDs (NVMe and SATA SSD). On HDDs, free-space fragmentation is bad because seeking between holes costs latency. On SSDs, random and sequential I/O cost roughly the same — fragmentation has minimal observable impact.
- The hot workloads (Postgres for Bugsink/Plausible/Temporal/Grafana, Prometheus TSDB, ClickHouse) are all small enough that ARC + page cache absorb most reads.
- Write performance might degrade as the free-space holes shrink — but the cluster's bottleneck is upstream (network or upload bandwidth), not local write speed.

The point at which fragmentation IS performance-relevant on SSDs:

- **>85%** fragmentation: writes start hunting for free space; sustained write throughput drops measurably.
- **>95%**: the allocator may fail to find contiguous space for large block writes; ENOSPC errors on a non-full pool.

## Decision

1. **Keep the existing `zfs-maintenance` weekly workflow as-is** — it does useful work (scrub + autotrim), just not for fragmentation.
2. **Raise alert thresholds** so 60–70% on an SSD pool doesn't page:
   - `ZfsPoolHighFragmentation`: `> 50%` → `> 80%` (warning, sustained 1d)
   - `ZfsPoolCriticalFragmentation`: `> 70%` → `> 90%` (critical, sustained 1d)
3. **Drop the duplicate alert** `ZfsPoolFragmentationHigh` in `zfs-advanced.ts` — `zfs-maintenance.ts` already covers the same ground with better thresholds.
4. **If fragmentation crosses 80% on either pool**, re-evaluate: at that point either (a) start scheduling per-volume `zfs send/receive` rotations during low-traffic windows, or (b) plan a pool replacement (drain → destroy → recreate → restore from Velero).

## Why not lower thresholds and accept the noise

- The alerts page through PagerDuty. Repeatedly paging on a metric we've decided not to act on trains the operator to ignore PD, which destroys the value of the channel for genuine pages.
- Documenting the accepted state in a decision doc is the auditable trail; the alerts should match the documented action threshold.

## Cross-References

- Workflow: `packages/temporal/src/activities/zfs-maintenance.ts`, schedule `zfs-maintenance-weekly` runs every Sunday at 03:00 PT
- Alert rules: `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/zfs-maintenance.ts`
- Related: 2026-05-05 homelab health audit (Issue #5)
