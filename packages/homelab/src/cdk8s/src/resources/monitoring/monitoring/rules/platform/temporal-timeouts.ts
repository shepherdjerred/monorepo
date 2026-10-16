import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

export function temporalQueueTimeoutRules(): NonNullable<
  PrometheusRuleSpecGroups["rules"]
> {
  return [
    {
      alert: "TemporalActivitiesNeverStarting",
      annotations: {
        summary: escapePrometheusTemplate(
          "Temporal activities timing out before starting in {{ $labels.exported_namespace }}",
        ),
        description: escapePrometheusTemplate(
          "Activities hit ScheduleToStart {{ $value }} time(s) in the last hour, meaning they were queued and never picked up. Confirm the task queue has pollers with temporal task-queue describe.",
        ),
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        'increase(schedule_to_start_timeout{exported_namespace=~"prod|beta",operation="TimerActiveTaskActivityTimeout"}[1h]) > 0',
      ),
      for: "10m",
      labels: { severity: "warning" },
    },
    {
      alert: "TemporalWorkflowTasksNeverStarting",
      annotations: {
        summary: escapePrometheusTemplate(
          "Temporal workflow tasks timing out before starting in {{ $labels.exported_namespace }}",
        ),
        description: escapePrometheusTemplate(
          "Workflow tasks hit ScheduleToStart {{ $value }} time(s) in the last hour. Inspect the Workflow task queue and its routed Worker Deployment version's pollers; these are not Activity timeouts.",
        ),
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        'increase(schedule_to_start_timeout{exported_namespace=~"prod|beta",operation="TimerActiveTaskWorkflowTaskTimeout"}[1h]) > 0',
      ),
      for: "10m",
      labels: { severity: "warning" },
    },
  ];
}
