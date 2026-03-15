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
            summary: "ZFS pool fragmentation is high",
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.pool }} on {{ $labels.instance }} has {{ $value }}% fragmentation. Consider rebalancing or replacing the pool.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_zfs_zpool_fragmentation > 50",
          ),
          for: "1d",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ZfsPoolCriticalFragmentation",
          annotations: {
            summary: "ZFS pool fragmentation is critical",
            description: escapePrometheusTemplate(
              "ZFS pool {{ $labels.pool }} on {{ $labels.instance }} has {{ $value }}% fragmentation. Performance is likely degraded.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "node_zfs_zpool_fragmentation > 70",
          ),
          for: "1d",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "ZfsScrubOverdue",
          annotations: {
            summary: "ZFS scrub has not run recently",
            description: escapePrometheusTemplate(
              "ZFS pool on {{ $labels.instance }} has not been scrubbed in over 30 days. Schedule a scrub to verify data integrity.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "time() - node_zfs_zpool_last_scrub_timestamp > 2592000",
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
