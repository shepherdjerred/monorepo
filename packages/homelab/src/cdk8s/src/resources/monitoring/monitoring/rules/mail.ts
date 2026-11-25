import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getMailRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "mail-health",
      rules: [
        {
          alert: "MailDown",
          annotations: {
            summary: "Outbound mail broker is down",
            description:
              "Prometheus cannot scrape the mail broker, halting HTTP API and STARTTLS SMTP mail submission. Check pod status, container logs, and readiness probes in the mail namespace.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(up{namespace="mail",service="mail"} == 0) or absent(up{namespace="mail",service="mail"})',
          ),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "MailOutboxFailedMessages",
          annotations: {
            summary: "Mail outbox has failed messages",
            description: escapePrometheusTemplate(
              "The outbound mail broker has {{ $value }} permanently failed outbox messages awaiting inspection or retry. Open the Mail outbox UI to inspect delivery attempts and retry or resolve failed messages.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(mail_outbox_messages{status="failed"}) > 0',
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "MailQueueStuck",
          annotations: {
            summary: "Mail outbox queue is not draining",
            description: escapePrometheusTemplate(
              "The outbound mail broker has kept {{ $value }} active messages in queued, sending, or retrying state for over 15 minutes. Check Fastmail SMTP connectivity, relay pause flag state, and mail container logs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(mail_outbox_messages{status=~"queued|sending|retrying"}) > 0',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "MailSmtpTlsCertExpiringSoon",
          annotations: {
            summary: "Mail STARTTLS certificate is expiring soon",
            description: escapePrometheusTemplate(
              "The active mail STARTTLS certificate expires in {{ $value | humanizeDuration }}. Check the mail-smtp-tls Certificate resource and cert-manager renewal status in the mail namespace.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(mail_smtp_tls_cert_expiry_timestamp_seconds - time()) < 7 * 86400",
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
