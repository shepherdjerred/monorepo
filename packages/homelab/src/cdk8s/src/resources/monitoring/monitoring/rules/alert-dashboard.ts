import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

export function getAlertDashboardRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "alert-dashboard-health",
      rules: [
        {
          alert: "AlertDashboardDown",
          annotations: {
            summary: "Alert dashboard service is down",
            description:
              "Prometheus cannot scrape the alert-dashboard service, so firing alerts are not being recorded in the ledger or dispatched through normal dashboard notifications. Check pod status and logs in the alert-dashboard namespace.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(up{namespace="alert-dashboard",service="alert-dashboard-alert-dashboard-service"} == 0) or absent(up{namespace="alert-dashboard",service="alert-dashboard-alert-dashboard-service"})',
          ),
          for: "5m",
          labels: { severity: "critical", alert_dashboard_fallback: "true" },
        },
        {
          alert: "AlertDashboardReconciliationStale",
          annotations: {
            summary: "Alert dashboard reconciliation is stale",
            description:
              "The alert dashboard has not completed an Alertmanager reconciliation in over 1 minute, leaving dashboard state and email notifications behind live alerts. Check alert-dashboard logs and Alertmanager API connectivity.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "time() - alert_dashboard_last_reconciliation_timestamp_seconds > 60",
          ),
          for: "5m",
          labels: { severity: "critical", alert_dashboard_fallback: "true" },
        },
        {
          // Scoped to email being ON. A pending row is only evidence of a stuck
          // SENDER while there is a sender running; with delivery switched off
          // the same row is expected, and an unscoped rule pages forever for a
          // condition nobody intends to clear. `AlertDashboardOutboxStranded`
          // below owns the off case rather than leaving it silent.
          alert: "AlertDashboardOutboxStuck",
          annotations: {
            summary: "Alert dashboard email outbox is stuck",
            description:
              "At least one alert notification email has remained unsent for over 1 hour while email delivery is enabled, delaying alert notifications. Check alert-dashboard sender logs and outbound email provider credentials.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "alert_dashboard_oldest_pending_email_timestamp_seconds > 0 and time() - alert_dashboard_oldest_pending_email_timestamp_seconds > 3600 and on () alert_dashboard_email_enabled == 1",
          ),
          for: "5m",
          labels: { severity: "critical", alert_dashboard_fallback: "true" },
        },
        {
          // The off case. Rows queued before delivery was switched off can
          // never drain and never expire, so they are a real backlog to clear
          // deliberately — but they are not an outage, and paging critical for
          // them trains the operator to ignore the fallback channel.
          alert: "AlertDashboardOutboxStranded",
          annotations: {
            summary:
              "Alert dashboard has queued emails while delivery is disabled",
            description:
              "Alert notification emails are sitting in the outbox while email delivery is turned off, and they will not drain or expire automatically. Cancel the queued outbox rows or re-enable email delivery in alert-dashboard.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "alert_dashboard_email_outbox_depth > 0 and on () alert_dashboard_email_enabled == 0",
          ),
          for: "15m",
          labels: { severity: "warning", alert_dashboard_fallback: "true" },
        },
      ],
    },
  ];
}
