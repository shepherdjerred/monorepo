import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getErrorsRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "errors-health",
      rules: [
        {
          alert: "ErrorsDown",
          annotations: {
            summary: "Errors service is down",
            description:
              "Prometheus cannot scrape the first-party errors service, interrupting Sentry-envelope error ingestion and console access. Check pod status, container logs, and readiness probes in the errors namespace.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(up{namespace="errors",service="errors"} == 0) or absent(up{namespace="errors",service="errors"})',
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "ErrorsPostgreSQLNotReady",
          annotations: {
            summary: "Errors PostgreSQL database is not ready",
            description: escapePrometheusTemplate(
              "The errors-postgresql StatefulSet in namespace errors has {{ $value }} ready pods (expected 1), leaving Errors unable to store or query error events. Check the errors-postgresql pod status, PVC mounts, and PostgreSQL logs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_statefulset_status_replicas_ready{namespace="errors", statefulset="errors-postgresql"} < 1',
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "ErrorsPVCStorageHigh",
          annotations: {
            summary: "Errors PostgreSQL storage usage is above 85%",
            description: escapePrometheusTemplate(
              "Errors PostgreSQL volume {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full and approaching capacity. Lower per-project retention limits or expand the PersistentVolumeClaim before disk exhaustion.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(kubelet_volume_stats_used_bytes{namespace="errors", persistentvolumeclaim=~"pgdata-.*"}
             / kubelet_volume_stats_capacity_bytes{namespace="errors", persistentvolumeclaim=~"pgdata-.*"}) > 0.85`,
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ErrorsOutboxBacklog",
          annotations: {
            summary: "Errors notification outbox is not draining",
            description: escapePrometheusTemplate(
              "Errors has kept {{ $value }} pending notification outbox rows for over 15 minutes. Check Mail HTTP API connectivity (/v1/messages), MAIL_API_TOKEN, and errors container logs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum(errors_outbox_pending) > 20",
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
