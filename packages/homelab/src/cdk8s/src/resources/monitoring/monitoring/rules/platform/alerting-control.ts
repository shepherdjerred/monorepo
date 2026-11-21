import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

/**
 * The stock kube-prometheus-stack expression does not constrain the source
 * ALERTS series to alertstate="firing". Pending info alerts therefore create
 * an InfoInhibitor even though Alertmanager has not received them and cannot
 * notify for them yet.
 */
export const INFO_INHIBITOR_EXPRESSION = `group by (namespace) (
  ALERTS{alertstate="firing", severity="info"} == 1
) unless on (namespace) group by (namespace) (
  ALERTS{
    alertname!="InfoInhibitor",
    alertstate="firing",
    severity=~"warning|critical"
  } == 1
)`;

export function getAlertingControlRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "alerting-control",
      rules: [
        {
          alert: "InfoInhibitor",
          annotations: {
            summary: "Info-level alert suppression active",
            description:
              "This control alert suppresses info-level notifications in a namespace while no warning or critical alerts are firing there. Inspect the firing info-level alert in Alertmanager if context is needed; no operator action is required.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            INFO_INHIBITOR_EXPRESSION,
          ),
          labels: { severity: "none" },
        },
      ],
    },
  ];
}
