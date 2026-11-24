import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PROD_NODE_HOSTNAME } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

export function getProductionResourceMonitoringRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "resource-memory-monitoring-production",
      rules: [
        {
          alert: "ProductionNodeMemoryAvailableLow",
          annotations: {
            summary: "Production node has less than 16 GiB of available memory",
            description: escapePrometheusTemplate(
              "Production node {{ $labels.node }} is down to {{ $value | humanize1024 }}B of available memory, exhausting burst headroom for hosted workloads. Inspect top memory-consuming pods on {{ $labels.node }} before kubelet eviction begins.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `max by (node) (node_memory_MemAvailable_bytes{node="${PROD_NODE_HOSTNAME}"}) < 17179869184`,
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
        {
          alert: "ProductionNodeMemoryAvailableCritical",
          annotations: {
            summary: "Production node has less than 8 GiB of available memory",
            description: escapePrometheusTemplate(
              "Production node {{ $labels.node }} has only {{ $value | humanize1024 }}B of available memory, below the soft eviction threshold where workloads risk OOM kills and eviction. Inspect memory-heavy pods, recent OOM events, and active evictions on {{ $labels.node }} immediately.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `max by (node) (node_memory_MemAvailable_bytes{node="${PROD_NODE_HOSTNAME}"}) < 8589934592`,
          ),
          for: "1m",
          labels: { severity: "critical" },
        },
      ],
    },
  ];
}
