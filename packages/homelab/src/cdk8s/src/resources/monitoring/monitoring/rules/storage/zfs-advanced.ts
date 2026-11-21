import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

/**
 * Advanced ZFS monitoring rule groups:
 * cache efficiency, L2ARC advanced, ABD, buffer, async ops, and pool health.
 */
export function getZfsAdvancedRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // ZFS MFU/MRU and Ghost Cache monitoring
    {
      name: "zfs-cache-efficiency",
      rules: [
        {
          alert: "ZfsAnonDataHigh",
          annotations: {
            summary: "Unwritten ZFS data in memory exceeds 12 GiB",
            description: escapePrometheusTemplate(
              "Uncommitted anonymous (dirty) ZFS data in ARC on {{ $labels.instance }} reached {{ $value | humanize1024 }}B, squeezing cached reads and signaling sustained write backpressure. Check disk write latency and heavy write workloads on the node.",
            ),
          },
          // Anonymous (dirty) data sits inside the ARC. liskov's CI pool runs
          // with an 8 GiB zfs_dirty_data_max (src/talos/liskov/patches/
          // image.yaml), so a healthy burst there reaches 8 GiB by design; the
          // alert fires only above 12 GiB, where dirty data would be
          // squeezing the 16 GiB ARC's cached reads.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_zfs_arc_anon_data > 12884901888", // 12 GiB
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          alert: "ZfsAccessSkipHigh",
          annotations: {
            summary: "ZFS cache updates are skipping under lock load",
            description: escapePrometheusTemplate(
              'ZFS ARC on {{ $labels.instance }} is skipping {{ $value | printf "%.0f" }} cache header updates/s due to lock contention, which can degrade cache eviction accuracy. Check for heavy concurrent metadata operations or slow backing storage on the host.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_zfs_arc_access_skip[5m]) > 100",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
      ],
    },

    // ZFS L2ARC Advanced monitoring
    {
      name: "zfs-l2arc-advanced",
      rules: [
        {
          alert: "ZfsL2ArcReadWriteClash",
          annotations: {
            summary: "ZFS secondary cache had read/write collisions",
            description: escapePrometheusTemplate(
              'ZFS L2ARC on {{ $labels.instance }} experienced {{ $value | printf "%.0f" }} read/write collision(s) in the last hour while evicting blocks being read. Check L2ARC device sizing and write-feed throughput if read latency increases.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(node_zfs_arc_l2_rw_clash[1h]) > 0",
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
        {
          alert: "ZfsL2ArcEvictLockRetries",
          annotations: {
            summary: "ZFS secondary cache evictions are waiting on locks",
            description: escapePrometheusTemplate(
              'ZFS L2ARC eviction on {{ $labels.instance }} is retrying locks {{ $value | printf "%.1f" }} times/s, indicating cache lock contention that can add latency. Check L2ARC churn and concurrent workload I/O on the host.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_zfs_arc_l2_evict_lock_retry[5m]) > 10",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
      ],
    },

    // ZFS ABD (Adaptive Buffer Descriptor) Advanced monitoring
    {
      name: "zfs-abd-advanced",
      rules: [
        {
          alert: "ZfsAbdSgTableRetries",
          annotations: {
            summary: "ZFS memory scatter-gather allocations are retrying",
            description: escapePrometheusTemplate(
              'ZFS ABD scatter-gather table allocations on {{ $labels.instance }} are retrying {{ $value | printf "%.1f" }} times/s, signaling kernel memory fragmentation or pressure. Check host memory utilization and slab fragmentation on the node.',
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_zfs_abd_scatter_sg_table_retry[5m]) > 10",
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
      ],
    },

    // ZFS Buffer and Object monitoring
    {
      name: "zfs-buffer-monitoring",
      rules: [
        {
          alert: "ZfsDbufSizeHigh",
          annotations: {
            summary: "ZFS open-file buffer cache exceeds 8 GiB",
            description: escapePrometheusTemplate(
              "ZFS dbuf cache on {{ $labels.instance }} is using {{ $value | humanize1024 }}B of RAM, increasing host memory overhead. Check for workloads holding large numbers of open files or datasets and monitor overall node memory.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_zfs_arc_dbuf_size > 8589934592", // 8GB
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
      ],
    },

    // ZFS Async and Advanced Operations monitoring
    {
      name: "zfs-async-operations",
      rules: [
        {
          alert: "ZfsLoanedBytesHigh",
          annotations: {
            summary: "ZFS zero-copy memory buffers exceed 4 GiB",
            description: escapePrometheusTemplate(
              "ZFS has {{ $value | humanize1024 }}B of ARC buffers loaned out to zero-copy I/O paths on {{ $labels.instance }} for over 30 minutes, pinning ARC memory. Check for stalled ZFS send/recv streams, NFS/iSCSI consumers, or hung storage I/O.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_zfs_arc_arc_loaned_bytes > 4294967296", // 4GB
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
      ],
    },

    // ZFS Pool Health monitoring (from zfs_zpool.sh collector)
    {
      name: "zfs-pool-health",
      rules: [
        {
          alert: "ZfsPoolDegraded",
          annotations: {
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is degraded",
            ),
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} on {{ $labels.instance }} is in DEGRADED state with reduced or zero fault tolerance due to a faulted or missing vdev. Run zpool status immediately, verify backups, and replace or resilver the affected drive.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'zfs_zpool{health="DEGRADED"} == 1',
          ),
          for: "0m",
          labels: { severity: "critical", category: "storage" },
        },
        {
          alert: "ZfsPoolFaulted",
          annotations: {
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is faulted",
            ),
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} on {{ $labels.instance }} is FAULTED, halting pool I/O for hosted workloads and putting unbacked-up data at risk. Inspect zpool status and kernel storage errors immediately to recover the vdevs or restore from Velero backups.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'zfs_zpool{health="FAULTED"} == 1',
          ),
          for: "0m",
          labels: { severity: "critical", category: "storage" },
        },
        {
          alert: "ZfsPoolCapacityHigh",
          annotations: {
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is over 80% full",
            ),
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is {{ $value | humanizePercentage }} full, where copy-on-write allocation begins to slow write performance. Prune unneeded snapshots or PVCs, or plan capacity expansion.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(1 - (zfs_zpool_free_bytes / zfs_zpool_size_bytes)) > 0.80",
          ),
          for: "30m",
          labels: { severity: "warning", category: "storage" },
        },
        {
          alert: "ZfsPoolCapacityCritical",
          annotations: {
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is over 90% full",
            ),
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is {{ $value | humanizePercentage }} full, causing severe copy-on-write fragmentation and risking write failures across PVCs. Prune large datasets or orphaned snapshots immediately, or expand the pool.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(1 - (zfs_zpool_free_bytes / zfs_zpool_size_bytes)) > 0.90",
          ),
          for: "10m",
          labels: { severity: "critical", category: "storage" },
        },
        // Fragmentation alerts moved to zfs-maintenance.ts with raised
        // thresholds (80% / 90% on SSD pools).
      ],
    },
  ];
}
