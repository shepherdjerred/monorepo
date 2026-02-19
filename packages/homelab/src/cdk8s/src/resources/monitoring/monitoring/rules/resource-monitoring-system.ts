import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

/**
 * System health monitoring rule groups: node exporter, boot detection, clock skew.
 */
export function getSystemHealthRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "resource-system-health",
      rules: [
        {
          alert: "NodeExporterDown",
          annotations: {
            description: escapePrometheusTemplate(
              "Node exporter on {{ $labels.instance }} has been down for more than 5 minutes",
            ),
            summary: "Node exporter down",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'up{job="node-exporter"} == 0',
          ),
          for: "5m",
          labels: { severity: "critical" },
        },
        {
          alert: "SystemBootRecent",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has been rebooted recently: {{ $value | humanizeDuration }} ago",
            ),
            summary: "Recent system boot detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "time() - node_boot_time_seconds < 600", // Less than 10 minutes
          ),
          for: "1m",
          labels: { severity: "info" },
        },
        {
          alert: "ClockSkewDetected",
          annotations: {
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} has clock skew: {{ $value }}s difference from Prometheus server",
            ),
            summary: "Clock skew detected",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'abs(node_time_seconds - timestamp(up{job="node-exporter"})) > 30',
          ),
          for: "5m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
