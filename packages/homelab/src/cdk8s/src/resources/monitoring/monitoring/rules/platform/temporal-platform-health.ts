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
          summary: "Temporal scheduled workflows are starting late",
          description:
            "The 95th-percentile start delay for Temporal scheduled actions has exceeded 60 seconds for 10 minutes, delaying recurring jobs across the cluster. Check Temporal server health, scheduler workflows, and workflow poller availability before adjusting catchup windows.",
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
          summary: "Temporal workflow queue is stalled",
          description: escapePrometheusTemplate(
            "Workflow tasks have sat unclaimed on {{ $labels.taskqueue }} in {{ $labels.exported_namespace }} for over 15 minutes, stalling workflow execution. Run temporal worker deployment describe and compare the active build against the Build IDs currently polling.",
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
          summary: "Temporal workflow step failed to run",
          description: escapePrometheusTemplate(
            "Workflow task execution is failing for {{ $labels.workflow_type }} on queue {{ $labels.task_queue }}, blocking workflow progress until tasks succeed. Inspect the workflow execution history in the Temporal UI and correlated worker logs before restarting pollers.",
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
          summary: "Workflow stuck after a code change",
          description: escapePrometheusTemplate(
            "Workflow {{ $labels.workflow_type }} on queue {{ $labels.task_queue }} failed replay due to a nondeterministic code change, stalling open executions on that build. Pause the worker rollout, save the failing workflow history, and test replay against the candidate bundle before shipping a fix.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'sum by (exported_namespace, task_queue, workflow_type) (increase({__name__=~"temporal_worker_workflow_task_execution_failed(_total)?",exported_namespace=~"prod|beta",failure_reason="NonDeterminismError"}[30m])) > 0 or sum by (exported_namespace, task_queue, workflow_type) (increase(service_errors_nondeterministic[30m])) > 0',
        ),
        for: "1m",
        labels: { severity: "critical" },
      },
      {
        alert: "TemporalActivityRetriesExhausted",
        annotations: {
          summary: "Background task failed after all retries",
          description: escapePrometheusTemplate(
            "Activity {{ $labels.activityType }} in workflow {{ $labels.workflowType }} on queue {{ $labels.taskqueue }} permanently failed after exhausting its retry policy or hitting a non-retryable error. Inspect the workflow execution in the Temporal UI, traces, and worker logs to diagnose the failure.",
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
