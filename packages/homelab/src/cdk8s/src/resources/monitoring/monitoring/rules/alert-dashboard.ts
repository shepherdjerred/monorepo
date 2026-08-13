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
            summary: "Alert dashboard is down",
            message:
              "The Alerts service has no healthy Prometheus scrape target.",
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
            message:
              "The Alerts ledger has not completed an Alertmanager reconciliation in more than one minute.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "time() - alert_dashboard_last_reconciliation_timestamp_seconds > 60",
          ),
          for: "5m",
          labels: { severity: "critical", alert_dashboard_fallback: "true" },
        },
        {
          alert: "AlertDashboardOutboxStuck",
          annotations: {
            summary: "Alert dashboard email outbox is stuck",
            message:
              "One or more alert opening emails have remained unsent for an hour.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "alert_dashboard_oldest_pending_email_timestamp_seconds > 0 and time() - alert_dashboard_oldest_pending_email_timestamp_seconds > 3600",
          ),
          for: "5m",
          labels: { severity: "critical", alert_dashboard_fallback: "true" },
        },
      ],
    },
  ];
}
