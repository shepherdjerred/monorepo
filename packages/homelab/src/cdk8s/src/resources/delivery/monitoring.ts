import type { Chart } from "cdk8s";
import {
  PrometheusRule,
  PrometheusRuleSpecGroupsRulesExpr,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";

const expr = (expression: string) =>
  PrometheusRuleSpecGroupsRulesExpr.fromString(expression);

/** Only rendered with an activated service, so absent bootstrap targets do not alert. */
export function createDeliveryMonitoring(chart: Chart) {
  createServiceMonitor(chart, { name: "delivery", port: "http" });
  new PrometheusRule(chart, "delivery-alerts", {
    metadata: { labels: { release: "prometheus" } },
    spec: {
      groups: [
        {
          name: "delivery-control-plane",
          rules: [
            {
              alert: "DeliveryUnavailable",
              expr: expr(
                '(up{namespace="delivery",service="delivery"} == 0) or absent(up{namespace="delivery",service="delivery"})',
              ),
              for: "5m",
              labels: { severity: "warning" },
              annotations: {
                summary: "Delivery control plane is unavailable",
                message:
                  "The database-backed Delivery metrics endpoint is not scraping. Existing workloads may still be healthy; inspect the control plane and use its independent recovery procedure.",
              },
            },
            {
              alert: "DeliveryDispatchDelayed",
              expr: expr(
                'delivery_outbox_oldest_seconds{namespace="delivery",service="delivery"} > 600',
              ),
              for: "5m",
              labels: { severity: "warning" },
              annotations: {
                summary: "Delivery submissions are not reaching Temporal",
                message:
                  "A nonterminal deployment has awaited durable Workflow submission acknowledgement for more than ten minutes. Inspect the dispatch Schedule, executor and outbox before retrying.",
              },
            },
            {
              alert: "DeliveryRecoveryRequired",
              expr: expr(
                'delivery_recovery_required{namespace="delivery",service="delivery"} > 0',
              ),
              for: "5m",
              labels: { severity: "warning" },
              annotations: {
                summary: "A Delivery operation needs independent recovery",
                message:
                  "Delivery retained target ownership after an ambiguous external result. Inspect exact operation and Job identities; do not delete the database lock or assume the release was undone.",
              },
            },
          ],
        },
      ],
    },
  });
}
