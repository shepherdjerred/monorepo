import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

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
            summary: "Node exporter is unreachable",
            description: escapePrometheusTemplate(
              "Prometheus has been unable to scrape node-exporter on {{ $labels.instance }} for over 5 minutes, blinding host-level CPU, memory, disk, and hardware alerts for that node. Check whether the node itself is unreachable or inspect the node-exporter DaemonSet pod in monitoring.",
            ),
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
            summary: "Node rebooted within the last 10 minutes",
            description: escapePrometheusTemplate(
              "Node {{ $labels.instance }} booted {{ $value | humanizeDuration }} ago, which may reflect an unplanned reset, kernel panic, or Talos upgrade. Verify whether maintenance was scheduled and check talosctl dmesg and node conditions if the reboot was unexpected.",
            ),
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
            summary: "Node system clock is skewed by more than 30 seconds",
            description: escapePrometheusTemplate(
              "The system clock on {{ $labels.instance }} differs from Prometheus by {{ $value | humanize }}s, which can break TLS certificate validation, distributed consensus, and metric timestamps. Check Talos time synchronization status on the node with talosctl get timeserverstatus.",
            ),
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
