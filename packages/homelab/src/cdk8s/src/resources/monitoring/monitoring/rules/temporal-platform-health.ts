import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getTemporalPlatformHealthRuleGroup(): PrometheusRuleSpecGroups {
  return {
    name: "temporal-platform-health",
    rules: [
      {
        alert: "TemporalScheduleActionDelayed",
        annotations: {
          summary: "Temporal schedule actions are starting late",
          description:
            "Temporal's schedule-action p95 delay has exceeded 60 seconds for ten minutes. Check the scheduler Workflow, server health, and Workflow pollers before changing catchup windows.",
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "histogram_quantile(0.95, sum by (le) (rate(schedule_action_delay_bucket[10m]))) > 60",
        ),
        for: "10m",
        labels: { severity: "warning" },
      },
      {
        alert: "TemporalWorkflowTaskFailing",
        annotations: {
          summary: escapePrometheusTemplate(
            "Temporal Workflow Tasks are failing on {{ $labels.task_queue }}",
          ),
          description: escapePrometheusTemplate(
            "Workflow Task execution failures increased for {{ $labels.workflow_type }} on {{ $labels.task_queue }}. Inspect the execution history and correlated Worker logs before restarting a poller.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'increase(temporal_worker_workflow_task_execution_failed{exported_namespace="default",failure_reason!="NonDeterminismError"}[10m]) > 0',
        ),
        for: "2m",
        labels: { severity: "warning" },
      },
      {
        alert: "TemporalWorkflowNondeterministic",
        annotations: {
          summary: escapePrometheusTemplate(
            "Temporal Workflow {{ $labels.workflow_type }} is nondeterministic",
          ),
          description: escapePrometheusTemplate(
            "A nondeterminism failure occurred on {{ $labels.task_queue }}. Stop the rollout, retain the failing history, and replay it against the candidate bundle before changing code.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'increase(temporal_worker_workflow_task_execution_failed{exported_namespace="default",failure_reason="NonDeterminismError"}[10m]) > 0 or increase(service_errors_nondeterministic[10m]) > 0',
        ),
        for: "1m",
        labels: { severity: "critical" },
      },
      {
        alert: "TemporalActivityRetriesExhausted",
        annotations: {
          summary: escapePrometheusTemplate(
            "Temporal Activity {{ $labels.activityType }} exhausted retries",
          ),
          description: escapePrometheusTemplate(
            "Activity {{ $labels.activityType }} in {{ $labels.workflowType }} reached a terminal failure on {{ $labels.taskqueue }}. Inspect its execution, trace, and Activity logs.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'increase(activity_fail{exported_namespace="default"}[15m]) > 0',
        ),
        for: "1m",
        labels: { severity: "warning" },
      },
    ],
  };
}
