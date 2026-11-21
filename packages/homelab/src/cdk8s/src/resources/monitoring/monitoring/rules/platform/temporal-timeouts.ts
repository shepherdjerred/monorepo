import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

export function temporalQueueTimeoutRules(): NonNullable<
  PrometheusRuleSpecGroups["rules"]
> {
  // Workflow ScheduleToStart timeouts include routine sticky-queue fallback.
  // TemporalWorkflowPlaneStalled uses backlog age to detect actual starvation.
  return [
    {
      alert: "TemporalActivitiesNeverStarting",
      annotations: {
        summary: "Temporal tasks are timing out before starting",
        description: escapePrometheusTemplate(
          "{{ $value }} activities in namespace {{ $labels.exported_namespace }} timed out waiting for a worker to pick them up in the last hour. Check worker pod health and run temporal task-queue describe to confirm active activity pollers exist.",
        ),
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        'increase(schedule_to_start_timeout{exported_namespace=~"prod|beta",operation="TimerActiveTaskActivityTimeout"}[1h]) > 0',
      ),
      for: "10m",
      labels: { severity: "warning" },
    },
  ];
}
