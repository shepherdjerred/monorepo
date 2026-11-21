import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

const zfsScrubOverdueExpression = [
  "(time() - zfs_zpool_last_scrub_completion_timestamp > 777600) and ",
  "on(instance, zpool_name) (zfs_zpool_scan_state != 1)",
].join("");

export function getZfsMaintenanceRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "zfs-maintenance",
      rules: [
        // Both pools are SSDs (NVMe + SATA SSD); free-space fragmentation has
        // minimal performance impact below ~80% (where write-throughput
        // degradation starts becoming measurable) and becomes critical above
        // ~90% (allocator contiguous-space exhaustion). The zfs-maintenance
        // workflow (scrub + autotrim) doesn't reduce fragmentation, and real
        // defrag (zfs send/recv into a fresh dataset) is expensive per-volume.
        {
          alert: "ZfsPoolHighFragmentation",
          annotations: {
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} fragmentation above 80%",
            ),
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} free-space fragmentation is {{ $value }}%, which can degrade sustained write throughput even on SSD pools. Prune old snapshots or rotate heavy datasets via zfs send/recv, or plan a pool rebuild.",
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
              "ZFS pool {{ $labels.zpool_name }} fragmentation above 90%",
            ),
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} free-space fragmentation reached {{ $value }}%, risking allocator stalls and ENOSPC errors even when free space remains. Prune space immediately, drain workloads if writes stall, and schedule a pool rebuild from Velero backups.",
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
              "ZFS scrub overdue on pool {{ $labels.zpool_name }}",
            ),
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} has not completed a scrub in over 9 days and no scrub is currently running, leaving silent data corruption undetected. Check the weekly ZFS maintenance Temporal schedule and worker logs, or trigger a manual scrub.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            zfsScrubOverdueExpression,
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
