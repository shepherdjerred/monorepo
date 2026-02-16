import { PrometheusRuleSpecGroups } from "../../../../../generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "../../../../../generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared";

export function getBugsinkRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "bugsink-availability",
      rules: [
        {
          alert: "BugsinkPodNotRunning",
          annotations: {
            summary: "Bugsink pod is not running",
            message: escapePrometheusTemplate(
              "Bugsink deployment has {{ $value }} available replicas (expected 1). Error tracking may be unavailable.",
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
            summary: "Bugsink pod has been down for extended period",
            message: escapePrometheusTemplate(
              "Bugsink has been unavailable for 30+ minutes. Error tracking is not functioning.",
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
            summary: "Bugsink PostgreSQL storage usage is high",
            message: escapePrometheusTemplate(
              "Bugsink PostgreSQL PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full. Consider running cleanup or expanding storage.",
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
            summary: "Bugsink PostgreSQL storage is nearly full",
            message: escapePrometheusTemplate(
              "Bugsink PostgreSQL PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full. Immediate action required.",
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
      name: "bugsink-housekeeping",
      rules: [
        {
          alert: "BugsinkHousekeepingFailed",
          annotations: {
            summary: "Bugsink housekeeping CronJob failed",
            message: escapePrometheusTemplate(
              "Bugsink housekeeping job has failed {{ $value }} times. Database maintenance may not be running.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_job_status_failed{namespace="bugsink", job_name=~"bugsink-housekeeping-.*"} > 0',
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "BugsinkHousekeepingNotRunning",
          annotations: {
            summary: "Bugsink housekeeping has not run recently",
            message: escapePrometheusTemplate(
              "No successful Bugsink housekeeping job in the last 48 hours. Database may accumulate stale data.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `time() - max(kube_job_status_completion_time{namespace="bugsink", job_name=~"bugsink-housekeeping-.*"}) > 172800`,
          ),
          for: "1h",
          labels: {
            severity: "warning",
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
            summary: "Bugsink PostgreSQL cluster is not ready",
            message: escapePrometheusTemplate(
              "Bugsink PostgreSQL cluster has {{ $value }} ready pods (expected 1). Database may be unavailable.",
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
