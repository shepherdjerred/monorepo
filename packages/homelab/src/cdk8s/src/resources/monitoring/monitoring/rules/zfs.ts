import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";
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
            description: escapePrometheusTemplate(
              "ZFS ARC hit rate on {{ $labels.instance }} is low: {{ $value | humanizePercentage }} (should be >85%)",
            ),
            summary: "ZFS ARC hit rate is low - performance impact expected",
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
            description: escapePrometheusTemplate(
              "ZFS ARC hit rate on {{ $labels.instance }} is critically low: {{ $value | humanizePercentage }} (should be >85%)",
            ),
            summary:
              "ZFS ARC hit rate is critically low - severe performance impact",
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
            description: escapePrometheusTemplate(
              "ZFS ARC metadata usage on {{ $labels.instance }} is high: {{ $value | humanize }} bytes (>75% of ARC)",
            ),
            summary: "ZFS ARC metadata usage is high",
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
            description: escapePrometheusTemplate(
              "ZFS ARC on {{ $labels.instance }} has high eviction rate: {{ $value }}/s - may indicate memory pressure",
            ),
            summary: "High ZFS ARC eviction rate detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_zfs_arc_deleted[5m]) > 1000",
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
            description: escapePrometheusTemplate(
              "ZFS L2ARC on {{ $labels.instance }} is experiencing IO errors: {{ $value }} errors",
            ),
            summary: "ZFS L2ARC IO errors detected - check L2ARC device health",
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
            description: escapePrometheusTemplate(
              "ZFS L2ARC on {{ $labels.instance }} has write errors: {{ $value }} errors",
            ),
            summary:
              "ZFS L2ARC write errors detected - L2ARC device may be failing",
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
            description: escapePrometheusTemplate(
              "ZFS L2ARC on {{ $labels.instance }} has checksum errors: {{ $value }} errors - data integrity concern",
            ),
            summary: "ZFS L2ARC checksum errors detected",
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
            description: escapePrometheusTemplate(
              "ZFS memory pressure on {{ $labels.instance }} is high: throttle count {{ $value }}",
            ),
            summary: "High ZFS memory pressure detected",
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
            description: escapePrometheusTemplate(
              "ZFS on {{ $labels.instance }} is under memory pressure: need_free={{ $value | humanize }} bytes",
            ),
            summary: "ZFS memory reclaim active - system under memory pressure",
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
            description: escapePrometheusTemplate(
              "ZFS ABD on {{ $labels.instance }} has frequent page allocation retries: {{ $value }}/s - memory pressure indicator",
            ),
            summary: "High ZFS ABD page allocation retries",
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
            description: escapePrometheusTemplate(
              "ZFS hash collisions on {{ $labels.instance }} are high: {{ $value }}/s - may impact performance",
            ),
            summary: "High ZFS hash collisions detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(node_zfs_arc_hash_collisions[5m]) > 1000",
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          alert: "ZfsHashChainLengthHigh",
          annotations: {
            description: escapePrometheusTemplate(
              "ZFS hash chain max length on {{ $labels.instance }} is high: {{ $value }} - performance degradation possible",
            ),
            summary: "ZFS hash chain length is high",
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
            description: escapePrometheusTemplate(
              "ZFS L2ARC rebuild on {{ $labels.instance }} has errors - check L2ARC device health and logs",
            ),
            summary: "ZFS L2ARC rebuild errors detected",
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
            description: escapePrometheusTemplate(
              "ZFS L2ARC on {{ $labels.instance }} is aborting operations due to low memory: {{ $value }} aborts",
            ),
            summary: "ZFS L2ARC low memory aborts detected",
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
            description: escapePrometheusTemplate(
              "ZFS on {{ $labels.instance }} is skipping evictions frequently: {{ $value }}/s - potential lock contention",
            ),
            summary: "High ZFS eviction skips - potential lock contention",
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
            description: escapePrometheusTemplate(
              "ZFS L2ARC on {{ $labels.instance }} has frequent write lock retries: {{ $value }}/s - performance impact",
            ),
            summary: "High ZFS L2ARC write lock retries",
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
            description: escapePrometheusTemplate(
              "ZFS ARC size on {{ $labels.instance }} is below minimum: {{ $value | humanize }} bytes is less than configured minimum",
            ),
            summary: "ZFS ARC size is below configured minimum",
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
            description: escapePrometheusTemplate(
              "ZFS reports system free memory on {{ $labels.instance }} is critically low: {{ $value | humanize }} bytes",
            ),
            summary: "ZFS system free memory is critically low",
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
