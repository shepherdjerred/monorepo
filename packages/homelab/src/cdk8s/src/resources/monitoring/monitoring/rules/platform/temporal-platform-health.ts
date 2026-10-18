import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

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
        alert: "TemporalWorkflowPlaneStalled",
        annotations: {
          summary: escapePrometheusTemplate(
            "Temporal Workflow tasks are not being picked up on {{ $labels.taskqueue }}",
          ),
          description: escapePrometheusTemplate(
            "Workflow tasks have sat unclaimed on {{ $labels.taskqueue }} in {{ $labels.exported_namespace }} for over fifteen minutes. The usual cause is that the Worker Deployment's current version points at a Build ID no running pod carries, so tasks route to a queue nobody polls — pollers look healthy while nothing executes. Compare `worker deployment describe` against the Build IDs actually reporting pollers.",
          ),
          runbook_url:
            "https://wiki.sjer.red/how-to/roll-out-a-temporal-worker-deployment/",
        },
        // Age, not count. A terminated execution can leave tombstoned tasks
        // behind that keep a non-zero count at age 0 — the retired `default`
        // namespace shows exactly that — whereas a genuine stall is defined by
        // tasks getting older. This is the signal that was missing when the
        // workflow plane was dead for fifteen hours and every existing rule
        // stayed silent: the pollers were up, so poller alerts saw nothing,
        // and the backlog rule was selecting a task-queue name that does not
        // exist on the server's metrics.
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'max by (exported_namespace, taskqueue) (approximate_backlog_age_seconds{namespace="temporal",task_type="Workflow",exported_namespace=~"prod|beta"}) > 900',
        ),
        for: "10m",
        labels: { severity: "critical" },
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
        // SDK counters, which count every failed attempt; the server's
        // `failed_workflow_tasks` records a Task that keeps failing only once.
        // Workers export with `countersTotalSuffix`, so the `_total` spelling
        // is the live one; the bare name is kept for workers that predate it.
        // Matching only the bare name left this rule unable to fire for any
        // Scout worker while a dispatcher Task failed 172 times.
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'increase({__name__=~"temporal_worker_workflow_task_execution_failed(_total)?",exported_namespace=~"prod|beta",failure_reason!="NonDeterminismError"}[10m]) > 0',
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
          'increase({__name__=~"temporal_worker_workflow_task_execution_failed(_total)?",exported_namespace=~"prod|beta",failure_reason="NonDeterminismError"}[10m]) > 0 or increase(service_errors_nondeterministic[10m]) > 0',
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
            "Activity {{ $labels.activityType }} in {{ $labels.workflowType }} failed with no retries left on {{ $labels.taskqueue }}: its retry policy was exhausted or the failure was non-retryable. Inspect its execution, trace, and Activity logs.",
          ),
        },
        // The Temporal server counts every failed attempt in
        // activity_task_fail ("includes retries") and only the failures that
        // will not be retried in activity_fail. RecordActivityCompletionMetrics
        // in service/history/workflow/metrics.go (v1.32.1) increments
        // activity_fail only when the activity closed. Counting attempts
        // fired this alert on every transient retry that later succeeded.
        // Both come from the server, so `namespace` is the *Kubernetes*
        // namespace it was scraped in ("temporal") and the Temporal namespace
        // is `exported_namespace`.
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'increase(activity_fail{exported_namespace=~"prod|beta"}[15m]) > 0',
        ),
        for: "1m",
        labels: { severity: "warning" },
      },
    ],
  };
}
