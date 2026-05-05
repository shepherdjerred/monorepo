import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getZfsMaintenanceRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "zfs-maintenance",
      rules: [
        // Both pools are SSDs (NVMe + SATA SSD); free-space fragmentation has
        // minimal performance impact below ~80%. The existing zfs-maintenance
        // workflow (scrub + autotrim) doesn't reduce fragmentation, and real
        // defrag (zfs send/recv into a fresh dataset) is expensive per-volume.
        // Raised thresholds to action levels per
        // packages/docs/decisions/2026-05-05_zfs-fragmentation-acceptance.md.
        {
          alert: "ZfsPoolHighFragmentation",
          annotations: {
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} fragmentation is high",
            ),
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} has {{ $value }}% fragmentation. SSD pools start showing measurable write-throughput degradation around 80%; consider per-volume zfs send/recv rotations or planning a pool replacement.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "zfs_zpool_fragmentation > 80",
          ),
          for: "1d",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ZfsPoolCriticalFragmentation",
          annotations: {
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} fragmentation is critical",
            ),
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} has {{ $value }}% fragmentation. Above ~90% on an SSD pool the allocator may fail to find contiguous space; expect ENOSPC errors despite free space available. Drain workloads and rebuild the pool from Velero backups.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "zfs_zpool_fragmentation > 90",
          ),
          for: "1d",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "ZfsScrubOverdue",
          annotations: {
            summary: escapePrometheusTemplate(
              "ZFS scrub overdue on {{ $labels.zpool_name }}",
            ),
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} has not been scrubbed in over 9 days. The weekly Temporal maintenance workflow may have failed.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "zfs_zpool_last_scrub_completion_timestamp > 0 and (time() - zfs_zpool_last_scrub_completion_timestamp) > 777600",
          ),
          for: "1h",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
