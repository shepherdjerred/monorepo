import { PrometheusRuleSpecGroups } from "../../../../../generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "../../../../../generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared";

export function getPostalRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "postal-availability",
      rules: [
        {
          alert: "PostalWebDown",
          annotations: {
            summary: "Postal web UI is down",
            message: escapePrometheusTemplate(
              "Postal web deployment has {{ $value }} available replicas (expected 1). Web UI is unavailable.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_deployment_status_replicas_available{namespace="postal", deployment="postal-postal-web"} < 1',
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "PostalSMTPDown",
          annotations: {
            summary: "Postal SMTP server is down",
            message: escapePrometheusTemplate(
              "Postal SMTP deployment has {{ $value }} available replicas (expected 1). Inbound email reception is unavailable.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_deployment_status_replicas_available{namespace="postal", deployment="postal-postal-smtp"} < 1',
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "PostalWorkerDown",
          annotations: {
            summary: "Postal worker is down",
            message: escapePrometheusTemplate(
              "Postal worker deployment has {{ $value }} available replicas (expected 1). Email delivery processing is stopped.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_deployment_status_replicas_available{namespace="postal", deployment="postal-postal-worker"} < 1',
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    {
      name: "postal-queue",
      rules: [
        {
          alert: "PostalQueueLatencyHigh",
          annotations: {
            summary: "Postal message queue latency is high",
            message: escapePrometheusTemplate(
              "Postal message queue latency p99 is {{ $value | humanizeDuration }}. Email delivery may be delayed.",
            ),
          },
          // postal_message_queue_latency is a histogram; alert on high p99 latency
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "histogram_quantile(0.99, sum(rate(postal_message_queue_latency_bucket[5m])) by (le)) > 300",
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "PostalQueueLatencyCritical",
          annotations: {
            summary: "Postal message queue latency critically high",
            message: escapePrometheusTemplate(
              "Postal message queue latency p99 is {{ $value | humanizeDuration }}. Email delivery is severely impacted.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "histogram_quantile(0.99, sum(rate(postal_message_queue_latency_bucket[5m])) by (le)) > 900",
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    {
      name: "postal-worker",
      rules: [
        {
          alert: "PostalWorkerErrorsHigh",
          annotations: {
            summary: "High rate of Postal worker errors",
            message: escapePrometheusTemplate(
              "Postal worker has {{ $value }} errors in the last 15 minutes. Check worker logs for details.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("increase(postal_worker_errors[15m]) > 10"),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "PostalWorkerErrorsCritical",
          annotations: {
            summary: "Critical rate of Postal worker errors",
            message: escapePrometheusTemplate(
              "Postal worker has {{ $value }} errors in the last 15 minutes. Email processing may be failing.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("increase(postal_worker_errors[15m]) > 50"),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    {
      name: "postal-smtp",
      rules: [
        {
          alert: "PostalSMTPExceptionsHigh",
          annotations: {
            summary: "High rate of SMTP server exceptions",
            message: escapePrometheusTemplate("Postal SMTP server has {{ $value }} exceptions in the last 15 minutes."),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("increase(postal_smtp_server_exceptions_total[15m]) > 10"),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    {
      name: "postal-health",
      rules: [
        {
          alert: "PostalPodRestarting",
          annotations: {
            summary: "Postal pod is restarting frequently",
            message: escapePrometheusTemplate(
              "Postal pod {{ $labels.pod }} has restarted {{ $value }} times in the last hour.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(kube_pod_container_status_restarts_total{namespace="postal", pod=~"postal-.*"}[1h]) > 3',
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "PostalMariaDBDown",
          annotations: {
            summary: "Postal MariaDB is down",
            message: escapePrometheusTemplate(
              "Postal MariaDB StatefulSet has {{ $value }} ready replicas. Database is unavailable.",
            ),
          },
          // MariaDB is deployed via Bitnami Helm chart as a StatefulSet named postal-mariadb
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'kube_statefulset_status_replicas_ready{namespace="postal", statefulset="postal-mariadb"} < 1',
          ),
          for: "2m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
  ];
}
