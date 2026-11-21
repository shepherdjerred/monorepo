import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import { getZfsAdvancedRuleGroups } from "./zfs-advanced.ts";

export function getZfsMonitoringRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // ZFS ARC (Adaptive Replacement Cache) monitoring
    {
      name: "zfs-arc-monitoring",
      rules: [
        {
          alert: "ZfsArcHitRateLow",
          annotations: {
            summary: "ZFS read cache hit rate is low",
            description: escapePrometheusTemplate(
              'ZFS ARC cache hit rate on {{ $labels.instance }} is {{ $value | printf "%.1f" }}% (below the 85% target), increasing disk read I/O and latency. Check for uncached large sequential scans or workloads exceeding the ARC size cap.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(rate(node_zfs_arc_hits[5m]) / (rate(node_zfs_arc_hits[5m]) + rate(node_zfs_arc_demand_data_misses[5m]) + rate(node_zfs_arc_demand_metadata_misses[5m]))) * 100 < 85",
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          alert: "ZfsArcHitRateCritical",
          annotations: {
            summary: "ZFS read cache hit rate is critically low",
            description: escapePrometheusTemplate(
              'ZFS ARC cache hit rate on {{ $labels.instance }} dropped to {{ $value | printf "%.1f" }}% (below 70%), causing heavy disk read thrashing and degraded storage latency. Inspect memory- or I/O-intensive workloads thrashing the cache and review ARC sizing.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(rate(node_zfs_arc_hits[5m]) / (rate(node_zfs_arc_hits[5m]) + rate(node_zfs_arc_demand_data_misses[5m]) + rate(node_zfs_arc_demand_metadata_misses[5m]))) * 100 < 70",
          ),
          for: "10m",
          labels: { severity: "critical" },
        },
        // Removed ZfsArcSizeNearLimit alert - ARC filling to capacity is normal/expected behavior
        // ZFS ARC is designed to use available memory as cache and releases it when needed
        {
          alert: "ZfsArcMetadataHigh",
          annotations: {
            summary: "ZFS cache metadata is using over 75% of cache",
            description: escapePrometheusTemplate(
              "ZFS ARC metadata is consuming {{ $value | humanizePercentage }} of the total ARC target on {{ $labels.instance }}, crowding out cached file data and hurting read performance. Check for excessive snapshot counts or workloads scanning millions of small files.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(node_zfs_arc_arc_meta_used / node_zfs_arc_c) > 0.75",
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
        {
          alert: "ZfsArcEvictionHigh",
          annotations: {
            summary: "ZFS read cache is thrashing heavily",
            description: escapePrometheusTemplate(
              'ZFS ARC on {{ $labels.instance }} is evicting {{ $value | printf "%.0f" }} entries/s, indicating severe cache thrashing that can increase CPU overhead and disk reads. Inspect workloads scanning datasets larger than ARC and check ZfsArcHitRateLow.',
            ),
          },
          // The ARC is deliberately right-sized (16Gi, 2026-07-10) and runs pinned at
          // cap, so steady eviction is normal operation — not memory pressure. Only
          // sustained extreme churn is signal; ZfsArcHitRateLow is the "cache too
          // small" canary.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_zfs_arc_deleted[5m]) > 10000",
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
      ],
    },

    // ZFS L2ARC (Level 2 ARC) monitoring
    {
      name: "zfs-l2arc-monitoring",
      rules: [
        {
          alert: "ZfsL2ArcIOErrors",
          annotations: {
            summary: "ZFS secondary cache disk has I/O errors",
            description: escapePrometheusTemplate(
              'ZFS L2ARC on {{ $labels.instance }} recorded {{ $value | printf "%.0f" }} I/O error(s) in the last hour, degrading cache reads and indicating possible cache-device failure. Check zpool status, SMART health, and kernel logs for the L2ARC device.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(node_zfs_arc_l2_io_error[1h]) > 0",
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "ZfsL2ArcWriteErrors",
          annotations: {
            summary: "ZFS secondary cache disk has write errors",
            description: escapePrometheusTemplate(
              'ZFS L2ARC on {{ $labels.instance }} recorded {{ $value | printf "%.0f" }} write error(s) in the last hour, preventing cache population and signaling possible L2ARC device failure. Inspect zpool status and SMART metrics for the L2ARC drive and remove or replace it if faulty.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(node_zfs_arc_l2_writes_error[1h]) > 0",
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "ZfsL2ArcChecksumErrors",
          annotations: {
            summary: "ZFS secondary cache disk has checksum errors",
            description: escapePrometheusTemplate(
              'ZFS L2ARC on {{ $labels.instance }} detected {{ $value | printf "%.0f" }} bad checksum(s) in the last hour, forcing fallback reads from primary pool disks. Check SMART health and cabling on the L2ARC device and replace it if errors persist.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(node_zfs_arc_l2_cksum_bad[1h]) > 0",
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
      ],
    },

    // ZFS Memory and Resource monitoring
    {
      name: "zfs-memory-monitoring",
      rules: [
        {
          alert: "ZfsMemoryPressureHigh",
          annotations: {
            summary: "ZFS cache is under memory pressure",
            description: escapePrometheusTemplate(
              'ZFS on {{ $labels.instance }} is throttling operations due to host memory pressure ({{ $value | printf "%.1f" }} throttles/s), increasing storage latency. Check node memory usage, pod memory limits, and ARC size pressure on the host.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_zfs_arc_memory_throttle_count[5m]) > 10",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "ZfsMemoryReclaim",
          annotations: {
            summary: "ZFS cache is shrinking to free host memory",
            description: escapePrometheusTemplate(
              "ZFS ARC on {{ $labels.instance }} needs to free {{ $value | humanize1024 }}B to satisfy kernel memory demand, shrinking cache capacity and potentially stalling allocations. Inspect top memory-consuming pods on the node and check for OOM or memory leak activity.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_zfs_arc_arc_need_free > 0",
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          alert: "ZfsAbdPageAllocRetries",
          annotations: {
            summary: "ZFS buffer memory allocations are retrying",
            description: escapePrometheusTemplate(
              'ZFS scatter-buffer page allocations on {{ $labels.instance }} are retrying {{ $value | printf "%.1f" }} times/s, signaling kernel memory pressure or fragmentation that slows I/O. Check available host RAM and memory-intensive workloads on the node.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_zfs_abd_scatter_page_alloc_retry[5m]) > 50",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
      ],
    },

    // ZFS Performance and Efficiency monitoring
    {
      name: "zfs-performance-monitoring",
      rules: [
        {
          alert: "ZfsHashCollisionsHigh",
          annotations: {
            summary: "ZFS cache lookup collisions are high",
            description: escapePrometheusTemplate(
              'ZFS ARC hash lookups on {{ $labels.instance }} are colliding {{ $value | printf "%.0f" }} times/s, adding CPU overhead to cache lookups. Check workload I/O concurrency and ZFS ARC hash table sizing if storage latency is elevated.',
            ),
          },
          // Threshold history: the old 1000/s threshold was routinely exceeded even
          // under the oversized 48Gi ARC (30d: p50 36/s, p95 5.1k/s, max 13.5k/s) —
          // raising the ARC to quell this alert demonstrably did not work, so the
          // threshold now sits above the observed 30d max instead (~1.5x). Collisions
          // are a perf-noise signal, not data risk.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_zfs_arc_hash_collisions[5m]) > 20000",
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          alert: "ZfsHashChainLengthHigh",
          annotations: {
            summary: "ZFS cache lookup chains are unusually long",
            description: escapePrometheusTemplate(
              "The longest ZFS ARC hash chain on {{ $labels.instance }} reached {{ $value }} entries, which can slow cache lookups under heavy I/O. Review ZFS module hash-table parameters and check ARC hash collision rates if read latency rises.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_zfs_arc_hash_chain_max > 20",
          ),
          for: "20m",
          labels: { severity: "warning" },
        },
      ],
    },

    // ZFS Health and Availability monitoring
    {
      name: "zfs-health-monitoring",
      rules: [
        {
          alert: "ZfsL2ArcRebuildErrors",
          annotations: {
            summary: "ZFS secondary cache failed to rebuild",
            description: escapePrometheusTemplate(
              "ZFS L2ARC metadata rebuild on {{ $labels.instance }} encountered I/O, checksum, or header errors in the last hour, leaving the secondary cache degraded or offline. Check zpool status, kernel logs, and SMART health for the L2ARC device.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(node_zfs_arc_l2_rebuild_io_errors[1h]) > 0 or increase(node_zfs_arc_l2_rebuild_cksum_lb_errors[1h]) > 0 or increase(node_zfs_arc_l2_rebuild_dh_errors[1h]) > 0",
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "ZfsL2ArcLowMemoryAborts",
          annotations: {
            summary: "ZFS secondary cache writes paused due to low RAM",
            description: escapePrometheusTemplate(
              'ZFS L2ARC on {{ $labels.instance }} aborted {{ $value | printf "%.0f" }} feed cycle(s) in the last hour due to low system memory, preventing secondary cache warm-up. Check host memory pressure and pod RAM usage on the node.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(node_zfs_arc_l2_abort_lowmem[1h]) > 0",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "ZfsEvictSkipHigh",
          annotations: {
            summary: "ZFS cache evictions are stalling on locks",
            description: escapePrometheusTemplate(
              'ZFS ARC on {{ $labels.instance }} is skipping {{ $value | printf "%.0f" }} buffer evictions/s due to held locks over the last hour, indicating lock contention under heavy I/O. Check for stalled disk operations or runaway metadata workloads on the node.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_zfs_arc_evict_skip[5m]) > 100",
          ),
          for: "1h",
          labels: { severity: "warning" },
        },
        {
          alert: "ZfsL2ArcWriteLockRetries",
          annotations: {
            summary: "ZFS secondary cache writes are contending on locks",
            description: escapePrometheusTemplate(
              'ZFS L2ARC feed threads on {{ $labels.instance }} are retrying locks {{ $value | printf "%.1f" }} times/s, indicating contention between ARC eviction and L2ARC writes. Check I/O concurrency and L2ARC device latency on the host.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_zfs_arc_l2_writes_lock_retry[5m]) > 10",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
      ],
    },

    // ZFS Critical System Integration monitoring
    {
      name: "zfs-system-integration",
      rules: [
        {
          alert: "ZfsArcSizeBelowMinimum",
          annotations: {
            summary: "ZFS read cache shrunk below its minimum size",
            description: escapePrometheusTemplate(
              "ZFS ARC target size on {{ $labels.instance }} shrunk to {{ $value | humanize1024 }}B, below zfs_arc_min, indicating severe host memory exhaustion. Inspect node memory usage immediately and relieve pod memory pressure before OOM kills occur.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_zfs_arc_c < node_zfs_arc_c_min",
          ),
          for: "10m",
          labels: { severity: "critical" },
        },
        {
          alert: "ZfsSystemMemoryLow",
          annotations: {
            summary: "Host free memory for ZFS is critically low",
            description: escapePrometheusTemplate(
              "ZFS reports only {{ $value | humanize1024 }}B of free system memory above its reserve on {{ $labels.instance }} (below 256 MiB), risking kernel stalls or OOM kills. Check node memory consumers immediately and evict or resize runaway pods.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_zfs_arc_arc_sys_free < 268435456", // Less than 256MB
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
      ],
    },

    ...getZfsAdvancedRuleGroups(),
  ];
}
