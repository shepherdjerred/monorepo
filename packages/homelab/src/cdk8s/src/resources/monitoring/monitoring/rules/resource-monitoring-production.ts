import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PROD_NODE_HOSTNAME } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { escapePrometheusTemplate } from "./shared.ts";

export function getProductionResourceMonitoringRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "resource-memory-monitoring-production",
      rules: [
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
