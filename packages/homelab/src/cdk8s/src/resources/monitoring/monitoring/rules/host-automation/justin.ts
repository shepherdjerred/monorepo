import {
  PrometheusRuleSpecGroupsRulesExpr,
  type PrometheusRuleSpecGroups,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

const instance = 'instance="karpathy"';
const lastStart = `last_over_time(justin_reconcile_last_started_timestamp_seconds{${instance}}[4h])`;
const deadline = `last_over_time(justin_stage_deadline_timestamp_seconds{${instance}}[4h])`;

export function getJustinRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "justin",
      rules: [
        {
          alert: "JustinReconcileMissing",
          // A running stage reports its own deadline, including the coding budget.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(time() - ${lastStart} > 300 and ${deadline} == 0) or (absent_over_time(justin_reconcile_last_started_timestamp_seconds{${instance}}[4h]) and on(instance) present_over_time(justin_reconcile_last_started_timestamp_seconds{${instance}}[30d]))`,
          ),
          for: "5m",
          labels: { severity: "warning", category: "ops" },
          annotations: {
            summary: "Justin has missed scheduled reconciles",
            description:
              "Check the LaunchAgent, local events log, and OTLP export on Karpathy.",
          },
        },
        {
          alert: "JustinStageOverdue",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${deadline} > 0 and ${deadline} < time()`,
          ),
          for: "2m",
          labels: { severity: "warning", category: "ops" },
          annotations: {
            summary: "Justin has exceeded its active stage deadline",
            description:
              "Inspect the latest stage_started event and the running command on Karpathy.",
          },
        },
        {
          alert: "JustinRepeatedIntegrationFailures",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `justin_consecutive_failures{${instance}} >= 3`,
          ),
          for: "2m",
          labels: { severity: "warning", category: "ops" },
          annotations: {
            summary: "Justin has failed three or more consecutive reconciles",
            description:
              "Inspect Justin's stage outcomes, then run doctor on Karpathy to check external connections.",
          },
        },
      ],
    },
  ];
}
