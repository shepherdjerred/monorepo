import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

export function getEtcdCustomRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "etcd-custom",
      rules: [
        {
          alert: "EtcdHighFragmentation",
          annotations: {
            summary: "etcd database is highly fragmented",
            description: escapePrometheusTemplate(
              "etcd on {{ $labels.instance }} is actively using only {{ $value | humanizePercentage }} of its allocated database file, wasting disk and memory and risking space-quota exhaustion. Verify etcd cluster health and defragment the affected member with talosctl etcd defrag.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "etcd_mvcc_db_total_size_in_use_in_bytes / etcd_mvcc_db_total_size_in_bytes < 0.2",
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
