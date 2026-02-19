import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

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
            description: escapePrometheusTemplate(
              "ZFS anonymous data on {{ $labels.instance }} is high: {{ $value | humanize }} bytes - may indicate poor cache efficiency",
            ),
            summary: "High ZFS anonymous data usage",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_zfs_arc_anon_data > 8589934592", // 8GB
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          alert: "ZfsAccessSkipHigh",
          annotations: {
            description: escapePrometheusTemplate(
              "ZFS access skips on {{ $labels.instance }} are high: {{ $value }}/s - potential lock contention",
            ),
            summary: "High ZFS access skips detected",
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
            description: escapePrometheusTemplate(
              "ZFS L2ARC on {{ $labels.instance }} has read/write clashes: {{ $value }} clashes",
            ),
            summary: "ZFS L2ARC read/write clashes detected",
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
            description: escapePrometheusTemplate(
              "ZFS L2ARC evict lock retries on {{ $labels.instance }}: {{ $value }}/s - performance impact",
            ),
            summary: "High ZFS L2ARC evict lock retries",
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
            description: escapePrometheusTemplate(
              "ZFS ABD SG table retries on {{ $labels.instance }}: {{ $value }}/s - memory pressure indicator",
            ),
            summary: "ZFS ABD SG table retries detected",
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
            description: escapePrometheusTemplate(
              "ZFS data buffer size on {{ $labels.instance }} is high: {{ $value | humanize }} bytes",
            ),
            summary: "High ZFS data buffer usage",
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
            description: escapePrometheusTemplate(
              "ZFS loaned bytes on {{ $labels.instance }} are high: {{ $value | humanize }} bytes - potential memory leak",
            ),
            summary: "High ZFS loaned bytes detected",
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
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is DEGRADED - one or more drives may be faulted or missing. Immediate attention required.",
            ),
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is degraded",
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
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is FAULTED - data may be at risk! Immediate action required.",
            ),
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is faulted - DATA AT RISK",
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
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is {{ $value | humanizePercentage }} full. Consider expanding or cleaning up.",
            ),
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} capacity over 80%",
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
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} is {{ $value | humanizePercentage }} full. Performance degradation likely. Expand or clean up immediately.",
            ),
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} capacity over 90%",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(1 - (zfs_zpool_free_bytes / zfs_zpool_size_bytes)) > 0.90",
          ),
          for: "10m",
          labels: { severity: "critical", category: "storage" },
        },
        {
          alert: "ZfsPoolFragmentationHigh",
          annotations: {
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} fragmentation is {{ $value }}%. High fragmentation can impact performance.",
            ),
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} fragmentation over 50%",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "zfs_zpool_fragmentation > 50",
          ),
          for: "1h",
          labels: { severity: "warning", category: "storage" },
        },
      ],
    },
  ];
}
