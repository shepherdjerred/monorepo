import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PROD_NODE_HOSTNAME } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import { BATCH_PRIORITY } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";

const GIBIBYTE = 1024 ** 3;

/**
 * The largest memory request among the Minecraft servers that hibernate at
 * zero replicas and wake on join (minecraft-shuxin requests 8Gi;
 * minecraft-sjerred requests 6Gi). Raise it with those requests.
 */
export const WAKE_REQUEST_BYTES = 8 * GIBIBYTE;

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
          // Requests are sized to typical use and the node runs near full
          // reservation by design, so a percentage threshold only restates
          // that policy. The consequence that matters is a hibernated
          // Minecraft server failing to schedule when a player joins. The
          // scheduler counts every Pending or Running pod bound to the node;
          // batch-low pods do not count because a waking game may preempt
          // them. Duplicate kube-state-metrics series are collapsed first.
          alert: "ProductionWakeCapacityInsufficient",
          annotations: {
            description: escapePrometheusTemplate(
              `Production node {{ $labels.node }} has {{ $value | humanize1024 }}B of unreserved memory that a waking game can use, less than the largest scale-to-zero Minecraft request (${String(WAKE_REQUEST_BYTES / GIBIBYTE)} GiB). A player joining that server would leave it Pending. Lower oversized requests or move a workload.`,
            ),
            summary:
              "A hibernated Minecraft server cannot be scheduled on wake",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            [
              `max by (node) (kube_node_status_allocatable{resource="memory",node="${PROD_NODE_HOSTNAME}"})`,
              " - on (node) sum by (node) (",
              `max by (namespace, pod, container, node) (kube_pod_container_resource_requests{resource="memory",node="${PROD_NODE_HOSTNAME}"})`,
              ' * on (namespace, pod) group_left () max by (namespace, pod) (kube_pod_status_phase{phase=~"Pending|Running"} == 1)',
              ` unless on (namespace, pod) kube_pod_info{priority_class="${BATCH_PRIORITY}"}`,
              `) < ${String(WAKE_REQUEST_BYTES)}`,
            ].join(""),
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
