import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getLiskovResourceMonitoringRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "resource-liskov-memory-monitoring",
      rules: [
        {
          alert: "LiskovMemoryAvailableLow",
          annotations: {
            description: escapePrometheusTemplate(
              "CI node liskov has less than 8GiB of available memory: {{ $value | humanize }} bytes remaining",
            ),
            summary:
              "Liskov available memory is below the eviction warning floor",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'node_memory_MemAvailable_bytes{node="liskov"} < 8589934592',
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
        {
          alert: "LiskovMemoryPressure",
          annotations: {
            description: escapePrometheusTemplate(
              "CI node liskov has less than 4GiB available or Kubernetes reports MemoryPressure",
            ),
            summary: "Critical memory pressure on liskov",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(node_memory_MemAvailable_bytes{node="liskov"} < 4294967296) or (kube_node_status_condition{node="liskov", condition="MemoryPressure", status="true"} == 1)',
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
      ],
    },
    {
      name: "resource-buildkite-admission-monitoring",
      rules: [
        {
          alert: "BuildkiteKueueWorkloadsWaiting",
          annotations: {
            description: escapePrometheusTemplate(
              "Buildkite workloads have been waiting for liskov quota admission for more than 30 minutes: {{ $value }} pending workloads",
            ),
            summary: "Buildkite workloads are waiting for Kueue capacity",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kueue_pending_workloads{cluster_queue="buildkite"} > 0',
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
