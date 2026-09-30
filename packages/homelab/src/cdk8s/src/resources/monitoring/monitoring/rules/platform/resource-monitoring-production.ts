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
            description: escapePrometheusTemplate(
              "Production node {{ $labels.node }} has {{ $value | humanize1024 }}B available. Shared memory bursts are exhausting host headroom; check heavy workloads before eviction starts.",
            ),
            summary: "Production node has less than 16 GiB available",
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
            description: escapePrometheusTemplate(
              "Production node {{ $labels.node }} has {{ $value | humanize1024 }}B available, below the soft eviction threshold. Check burst workloads, OOMs, and evictions immediately.",
            ),
            summary: "Production node has less than 8 GiB available",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `max by (node) (node_memory_MemAvailable_bytes{node="${PROD_NODE_HOSTNAME}"}) < 8589934592`,
          ),
          for: "1m",
          labels: { severity: "critical" },
        },
        {
          alert: "ProductionNodeMemoryRequestsHigh",
          annotations: {
            description: escapePrometheusTemplate(
              "Pod memory requests on production node {{ $labels.node }} consume {{ $value | humanizePercentage }} of allocatable memory. Reduce requests or move workloads before new pods become unschedulable.",
            ),
            summary: "Production node memory requests exceed 95%",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum by (node) (kube_pod_container_resource_requests{resource="memory",node="${PROD_NODE_HOSTNAME}"}) / on (node) kube_node_status_allocatable{resource="memory",node="${PROD_NODE_HOSTNAME}"} > 0.95`,
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
