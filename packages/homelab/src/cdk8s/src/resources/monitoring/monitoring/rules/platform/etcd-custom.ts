import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

export function getEtcdCustomRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "etcd-custom",
      rules: [
        {
          alert: "EtcdHighFragmentation",
          annotations: {
            summary: "Etcd DB is highly fragmented",
            description:
              "Etcd DB is less than 20% utilized, consider running defrag.",
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
