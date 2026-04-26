import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getZfsMaintenanceRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "zfs-maintenance",
      rules: [
        {
          alert: "ZfsPoolHighFragmentation",
          annotations: {
            summary: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} fragmentation is high",
            ),
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.zpool_name }} has {{ $value }}% fragmentation. Consider rebalancing or replacing the pool.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "zfs_zpool_fragmentation > 50",
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
              "ZFS pool {{ $labels.zpool_name }} has {{ $value }}% fragmentation. Performance is likely degraded.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "zfs_zpool_fragmentation > 70",
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
