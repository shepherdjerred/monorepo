import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getTasknotesRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "tasknotes-availability",
      rules: [
        {
          alert: "TasknotesPodNotRunning",
          annotations: {
            summary: "TaskNotes pod is not running",
            message: escapePrometheusTemplate(
              "TaskNotes deployment has {{ $value }} available replicas (expected 1). Task management may be unavailable.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_deployment_status_replicas_available{namespace="tasknotes", deployment="tasknotes"} < 1',
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "TasknotesPodNotRunningCritical",
          annotations: {
            summary: "TaskNotes pod has been down for extended period",
            message: escapePrometheusTemplate(
              "TaskNotes has been unavailable for 30+ minutes. Task management is not functioning.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_deployment_status_replicas_available{namespace="tasknotes", deployment="tasknotes"} < 1',
          ),
          for: "30m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    {
      name: "tasknotes-api",
      rules: [
        {
          alert: "TasknotesHighErrorRate",
          annotations: {
            summary: "TaskNotes API error rate is high",
            message: escapePrometheusTemplate(
              "TaskNotes API error rate is {{ $value | humanizePercentage }} (threshold: 5%). Check application logs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(rate(tasknotes_http_requests_total{namespace="tasknotes", status=~"5.."}[5m]))
             / sum(rate(tasknotes_http_requests_total{namespace="tasknotes"}[5m])) > 0.05`,
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "TasknotesHighLatency",
          annotations: {
            summary: "TaskNotes API latency is high",
            message: escapePrometheusTemplate(
              "TaskNotes API p95 latency is {{ $value }}s (threshold: 2s). Performance may be degraded.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `histogram_quantile(0.95, sum(rate(tasknotes_http_request_duration_seconds_bucket{namespace="tasknotes"}[5m])) by (le)) > 2`,
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    {
      name: "tasknotes-storage",
      rules: [
        {
          alert: "TasknotesPVCStorageHigh",
          annotations: {
            summary: "TaskNotes vault storage usage is high",
            message: escapePrometheusTemplate(
              "TaskNotes PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full. Consider expanding storage.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(kubelet_volume_stats_used_bytes{namespace="tasknotes"}
             / kubelet_volume_stats_capacity_bytes{namespace="tasknotes"}) > 0.85`,
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "TasknotesPVCStorageCritical",
          annotations: {
            summary: "TaskNotes vault storage is nearly full",
            message: escapePrometheusTemplate(
              "TaskNotes PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full. Immediate action required.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(kubelet_volume_stats_used_bytes{namespace="tasknotes"}
             / kubelet_volume_stats_capacity_bytes{namespace="tasknotes"}) > 0.95`,
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    {
      name: "tasknotes-sync",
      rules: [
        {
          alert: "TasknotesSyncClientDown",
          annotations: {
            summary: "TaskNotes Obsidian Headless sync is not running",
            message: escapePrometheusTemplate(
              "The obsidian-headless container in the TaskNotes deployment has not been running for 10+ minutes. Vault sync is unavailable.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `kube_pod_container_status_running{namespace="tasknotes", container="obsidian-headless"} == 0`,
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
