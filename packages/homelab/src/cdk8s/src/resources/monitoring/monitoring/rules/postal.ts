import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getPostalRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "postal-availability",
      rules: [
        {
          alert: "PostalWebDown",
          annotations: {
            summary: "Postal web UI is down",
            description: escapePrometheusTemplate(
              "The postal-postal-web deployment in namespace postal has {{ $value }} available replicas (expected 1), making the Postal management web UI unreachable. Check pod status, events, and container logs in the postal namespace.",
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
            description: escapePrometheusTemplate(
              "The postal-postal-smtp deployment in namespace postal has {{ $value }} available replicas (expected 1), stopping inbound SMTP email reception. Check SMTP pod status, events, and container logs in the postal namespace.",
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
            summary: "Postal email delivery worker is down",
            description: escapePrometheusTemplate(
              "The postal-postal-worker deployment in namespace postal has {{ $value }} available replicas (expected 1), halting queued email delivery processing. Check worker pod status, events, and container logs in the postal namespace.",
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
            description: escapePrometheusTemplate(
              "Postal p99 message queue latency is {{ $value | humanizeDuration }}, delaying email delivery. Check Postal worker logs, MariaDB health, and outbound SMTP relay responsiveness.",
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
            summary: "Postal message queue latency is critically high",
            description: escapePrometheusTemplate(
              "Postal p99 message queue latency has reached {{ $value | humanizeDuration }}, severely delaying queued emails. Inspect Postal worker pods, queue backlog, and downstream mail delivery errors immediately.",
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
            summary: "Postal worker error rate is elevated",
            description: escapePrometheusTemplate(
              "Postal workers logged {{ $value | humanize }} errors in the last 15 minutes, which may delay or bounce queued emails. Check postal-postal-worker container logs in the postal namespace for failure details.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(postal_worker_errors[15m]) > 10",
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "PostalWorkerErrorsCritical",
          annotations: {
            summary: "Postal worker error rate is critical",
            description: escapePrometheusTemplate(
              "Postal workers logged {{ $value | humanize }} errors in the last 15 minutes, indicating email processing is actively failing. Inspect postal-postal-worker logs, MariaDB connectivity, and message queue state in the postal namespace.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(postal_worker_errors[15m]) > 50",
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
      ],
    },
    // No `postal-smtp` group. A `PostalSMTPExceptionsHigh` rule lived here
    // watching `postal_smtp_server_exceptions_total`, but only the worker
    // Deployment exposes Postal's health server (port 9090, scraped by the
    // ServiceMonitor in `resources/mail/postal.ts`); the SMTP Deployment
    // publishes port 25 alone. That series therefore never existed, so the rule
    // could not fire and reported SMTP health as green by never going red.
    // Restoring the coverage means exposing the health server on the SMTP
    // Deployment and scraping it, then writing the rule against a metric that
    // is confirmed to be emitted — not re-adding this expression.
    {
      name: "postal-health",
      rules: [
        {
          alert: "PostalPodRestarting",
          annotations: {
            summary: "Postal mail service is restarting repeatedly",
            description: escapePrometheusTemplate(
              "Postal pod {{ $labels.pod }} has restarted {{ $value | humanize }} times in the last hour, risking intermittent web, SMTP, or delivery outages. Inspect previous container logs and pod events in the postal namespace for crashes or OOM kills.",
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
            summary: "Postal MariaDB database is down",
            description: escapePrometheusTemplate(
              "The postal-mariadb StatefulSet in namespace postal has {{ $value }} ready replicas (expected 1), leaving Postal unable to store or process mail. Check the postal-mariadb pod status, PVC health, and container logs.",
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
