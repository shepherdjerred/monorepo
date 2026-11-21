import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getBugsinkRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "bugsink-availability",
      rules: [
        {
          alert: "BugsinkPodNotRunning",
          annotations: {
            summary: "Bugsink pod is not running",
            description: escapePrometheusTemplate(
              "The bugsink deployment in namespace bugsink has {{ $value }} available replicas (expected 1) for over 5 minutes, interrupting application error ingestion and UI access. Check pod status, events, and container logs in the bugsink namespace.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_deployment_status_replicas_available{namespace="bugsink", deployment="bugsink"} < 1',
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "BugsinkPodNotRunningCritical",
          annotations: {
            summary: "Bugsink has been down for over 30 minutes",
            description: escapePrometheusTemplate(
              "The bugsink deployment in namespace bugsink has had {{ $value }} available replicas for over 30 minutes, leaving self-hosted error tracking completely offline. Inspect pod events, container crash logs, and PostgreSQL connectivity in the bugsink namespace.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_deployment_status_replicas_available{namespace="bugsink", deployment="bugsink"} < 1',
          ),
          for: "30m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    {
      name: "bugsink-storage",
      rules: [
        {
          alert: "BugsinkPVCStorageHigh",
          annotations: {
            summary: "Bugsink PostgreSQL storage usage is above 85%",
            description: escapePrometheusTemplate(
              "Bugsink PostgreSQL volume {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full and approaching capacity. Run Bugsink event retention cleanup or expand the PersistentVolumeClaim before the database runs out of disk space.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(kubelet_volume_stats_used_bytes{namespace="bugsink", persistentvolumeclaim=~"pgdata-.*"}
             / kubelet_volume_stats_capacity_bytes{namespace="bugsink", persistentvolumeclaim=~"pgdata-.*"}) > 0.85`,
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "BugsinkPVCStorageCritical",
          annotations: {
            summary: "Bugsink PostgreSQL storage usage is above 95%",
            description: escapePrometheusTemplate(
              "Bugsink PostgreSQL volume {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full and at immediate risk of disk exhaustion, which will halt error ingestion and database writes. Expand the PersistentVolumeClaim or purge old Bugsink events immediately.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(kubelet_volume_stats_used_bytes{namespace="bugsink", persistentvolumeclaim=~"pgdata-.*"}
             / kubelet_volume_stats_capacity_bytes{namespace="bugsink", persistentvolumeclaim=~"pgdata-.*"}) > 0.95`,
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    {
      name: "bugsink-database",
      rules: [
        {
          alert: "BugsinkPostgreSQLNotReady",
          annotations: {
            summary: "Bugsink PostgreSQL database is not ready",
            description: escapePrometheusTemplate(
              "The bugsink-postgresql StatefulSet in namespace bugsink has {{ $value }} ready pods (expected 1), leaving Bugsink unable to store or query error events. Check the bugsink-postgresql pod status, PVC mounts, and PostgreSQL logs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_statefulset_status_replicas_ready{namespace="bugsink", statefulset="bugsink-postgresql"} < 1',
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
  ];
}
