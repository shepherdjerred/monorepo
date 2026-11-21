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
            summary: `CI node ${CI_NODE_HOSTNAME} has less than 8 GiB of available memory`,
            description: escapePrometheusTemplate(
              `CI node ${CI_NODE_HOSTNAME} is down to {{ $value | humanize1024 }}B of available memory, approaching its kubelet eviction threshold during build bursts. Check concurrent Woodpecker step pods and Kueue memory reservations if pressure persists.`,
            ),
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
            summary: `Critical memory pressure on CI node ${CI_NODE_HOSTNAME}`,
            description: `CI node ${CI_NODE_HOSTNAME} has less than 4 GiB of available memory or Kubernetes is reporting MemoryPressure, risking pod evictions, OOM kills, and failed CI builds. Inspect running Woodpecker step pods and host memory consumers on ${CI_NODE_HOSTNAME} and cancel runaway builds.`,
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
            summary: "Woodpecker CI workloads stuck waiting for Kueue quota",
            description: escapePrometheusTemplate(
              `{{ $value }} Woodpecker workload(s) have waited over 30 minutes for admission in the woodpecker ClusterQueue, stalling CI pipeline progress. Check stuck or long-running build pods on ${CI_NODE_HOSTNAME} and inspect Kueue ClusterQueue and Workload status with kubectl.`,
            ),
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
