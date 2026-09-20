import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { CI_NODE_HOSTNAME } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

export function getLiskovResourceMonitoringRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "resource-liskov-memory-monitoring",
      rules: [
        {
          alert: "LiskovMemoryAvailableLow",
          annotations: {
            description: escapePrometheusTemplate(
              `CI node ${CI_NODE_HOSTNAME} has less than 8GiB of available memory: {{ $value | humanize }} bytes remaining`,
            ),
            summary:
              "Liskov available memory is below the eviction warning floor",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `node_memory_MemAvailable_bytes{node="${CI_NODE_HOSTNAME}"} < 8589934592`,
          ),
          for: "1m",
          labels: { severity: "warning" },
        },
        {
          alert: "LiskovMemoryPressure",
          annotations: {
            description: escapePrometheusTemplate(
              `CI node ${CI_NODE_HOSTNAME} has less than 4GiB available or Kubernetes reports MemoryPressure`,
            ),
            summary: "Critical memory pressure on liskov",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(node_memory_MemAvailable_bytes{node="${CI_NODE_HOSTNAME}"} < 4294967296) or (kube_node_status_condition{node="${CI_NODE_HOSTNAME}", condition="MemoryPressure", status="true"} == 1)`,
          ),
          labels: { severity: "critical" },
        },
      ],
    },
    {
      name: "resource-woodpecker-admission-monitoring",
      rules: [
        {
          alert: "WoodpeckerKueueWorkloadsWaiting",
          annotations: {
            description: escapePrometheusTemplate(
              "Woodpecker workloads have been waiting for liskov quota admission for more than 30 minutes: {{ $value }} pending workloads",
            ),
            summary: "Woodpecker workloads are waiting for Kueue capacity",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kueue_pending_workloads{cluster_queue="woodpecker"} > 0',
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
