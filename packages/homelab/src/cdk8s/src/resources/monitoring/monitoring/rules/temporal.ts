import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getTemporalRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "temporal-workflow-failures",
      rules: [
        {
          alert: "TemporalWorkflowActivityFailing",
          annotations: {
            summary: escapePrometheusTemplate(
              "Temporal workflow {{ $labels.workflowType }} activities failing",
            ),
            description: escapePrometheusTemplate(
              "Workflow {{ $labels.workflowType }} activity {{ $labels.activityType }} has had {{ $value }} failures in the last 30 minutes. Check the Temporal UI for details.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(activity_task_fail{namespace="default"}[30m]) > 5',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GolinkSyncFailing",
          annotations: {
            summary: "golink-sync workflow is failing",
            description: escapePrometheusTemplate(
              "The syncGolinks Temporal workflow has had {{ $value }} activity failures in the last 30 minutes. Check golink server health and the Temporal UI.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(activity_task_fail{namespace="default",workflowType="syncGolinks"}[30m]) > 3',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GolinkSyncFailingCritical",
          annotations: {
            summary: "golink-sync workflow has been failing for over 2 hours",
            description: escapePrometheusTemplate(
              "syncGolinks has had {{ $value }} activity failures in the last 2h. golink is likely unreachable on the tailnet — check Loki for the golink namespace and follow the recovery runbook.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(activity_task_fail{namespace="default",workflowType="syncGolinks"}[2h]) > 20',
          ),
          for: "30m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "ZfsMaintenanceFailed",
          annotations: {
            summary: "ZFS maintenance Temporal workflow failed",
            description: escapePrometheusTemplate(
              "The runZfsMaintenanceWorkflow Temporal activity failed {{ $value }} times in the last 24 hours. The weekly scrub or autotrim may not have run.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(activity_task_fail{namespace="default",workflowType="runZfsMaintenanceWorkflow"}[24h]) > 0',
          ),
          for: "1h",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ScoutDataDragonUpdateFailed",
          annotations: {
            summary: "Scout Data Dragon Temporal update failed",
            description: escapePrometheusTemplate(
              "The Scout Data Dragon updater failed {{ $value }} time(s) in the last 24 hours. Check the Temporal UI and worker logs for failure reason {{ $labels.reason }}.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(temporal_worker_scout_data_dragon_runs_total{outcome="failed"}[24h]) > 0',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ScoutDataDragonPrAutomationFailed",
          annotations: {
            summary: "Scout Data Dragon PR automation failed",
            description: escapePrometheusTemplate(
              "The Scout Data Dragon updater failed while pushing, creating, or auto-merging a PR. Failure reason: {{ $labels.reason }}.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(temporal_worker_scout_data_dragon_runs_total{outcome="failed",reason=~"git-push-failed|pr-create-failed|pr-merge-failed"}[24h]) > 0',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ScoutDataDragonUpdaterNotRunning",
          annotations: {
            summary: "Scout Data Dragon updater has not run",
            description:
              "The Scout Data Dragon Temporal schedule has not recorded any run, skip, or failure in the last 36 hours.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum(increase(temporal_worker_scout_data_dragon_runs_total[36h])) < 1",
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "TemporalWorkerMetricsDown",
          annotations: {
            summary: "Temporal worker metrics scrape is down",
            description:
              "Prometheus is not successfully scraping the Temporal worker metrics endpoint.",
          },
          // Service name is `temporal-temporal-worker-metrics-service` —
          // cdk8s prefixes the construct id with the chart name. Match as a
          // substring so the regex is robust to either naming.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'absent(up{namespace="temporal",service=~".*temporal-worker-metrics.*"}) or max(up{namespace="temporal",service=~".*temporal-worker-metrics.*"}) == 0',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "TemporalServerMetricsDown",
          annotations: {
            summary: "Temporal server metrics scrape is down",
            description:
              "Prometheus is not successfully scraping the Temporal server metrics endpoint.",
          },
          // Service name is `temporal-temporal-server-metrics-service`. See
          // TemporalWorkerMetricsDown above for the same regex caveat.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'absent(up{namespace="temporal",service=~".*temporal-server-metrics.*"}) or max(up{namespace="temporal",service=~".*temporal-server-metrics.*"}) == 0',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          // Catches the "low-volume daily schedule, fails consistently for
          // days, no one notices" pattern — exactly what kept Scout Data
          // Dragon broken silently from 2026-05-02 to 2026-05-08. Existing
          // TemporalWorkflowActivityFailing requires >5 failures in 30m,
          // which a once-daily schedule can never hit.
          //
          // PR workflows (prReview, prSummary) excluded because they
          // legitimately fail per-PR (lint errors, agent timeouts, etc.) and
          // would otherwise drown out the signal.
          alert: "TemporalScheduledWorkflowFailingDaily",
          annotations: {
            summary: escapePrometheusTemplate(
              "Scheduled workflow {{ $labels.workflowType }} failing repeatedly",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.workflowType }} has had {{ $value }} activity failures across the last 48h. A daily schedule that fails twice in a row is broken — check the Temporal UI and worker logs.",
            ),
          },
          // Workflows excluded: PR review/summary fail per-PR legitimately;
          // HA-presence + iOS-action workflows are event-triggered (their
          // schedules are user actions, not crons), so a "2 in 48h" rate
          // doesn't indicate a broken schedule.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            [
              "increase(activity_task_fail{",
              'namespace="default",',
              `workflowType!~"${["prReview", "prSummary", "welcomeHome", "leavingHome", "goodNight"].join("|")}"`,
              "}[48h]) >= 2",
            ].join(""),
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    {
      name: "temporal-workflow-outcomes",
      rules: [
        {
          // Surfaces drift in check-and-skip workflows: e.g. if vacuum
          // suddenly only skips for 5 days straight, presence detection may
          // be broken even though Temporal reports Completed.
          //
          // Backed by `temporal_workflow_outcome_total` (emitted by
          // setOutcome() in workflows/ha/util.ts). Fires on the absence of
          // any `executed` outcome over 5 days for a workflow that normally
          // executes — heuristic but catches the silent-failure class.
          alert: "TemporalCheckAndSkipNeverExecuted",
          annotations: {
            summary: escapePrometheusTemplate(
              "{{ $labels.workflow }} has skipped every run for 5 days",
            ),
            description: escapePrometheusTemplate(
              "Workflow {{ $labels.workflow }} has emitted only `skipped` outcomes for 5 days, never `executed`. Either no one was ever home/away as expected, or the gating condition is permanently stuck. Check HA presence entities.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum by (workflow) (increase(temporal_workflow_outcome_total{outcome="skipped"}[5d])) > 5\nunless on (workflow)\n  sum by (workflow) (increase(temporal_workflow_outcome_total{outcome="executed"}[5d])) > 0',
          ),
          for: "1h",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    {
      name: "pr-bot",
      rules: [
        {
          alert: "PrWebhookSignatureFailures",
          annotations: {
            summary: "GitHub PR webhook is rejecting signatures",
            description: escapePrometheusTemplate(
              "{{ $value }} GitHub webhook deliveries failed X-Hub-Signature-256 verification in the last 30 minutes. Either the webhook secret is wrong or someone is hitting the public URL with bad payloads.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(pr_webhook_signature_failures_total[30m]) > 5",
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "PrAgentFailureRate",
          annotations: {
            summary: escapePrometheusTemplate(
              "PR-agent claude subprocess failing ({{ $labels.kind }})",
            ),
            description: escapePrometheusTemplate(
              "The pr-agent {{ $labels.kind }} subprocess has had {{ $value }} non-zero exits in the last 1h. Check Loki (component=pr-agent) and the Temporal UI for the failing workflow.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(pr_agent_subprocess_exit_total{exit_code!="0"}[1h]) > 3',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "PrWorkflowActivitiesFailing",
          annotations: {
            summary: escapePrometheusTemplate(
              "PR workflow {{ $labels.workflowType }} activities failing",
            ),
            description: escapePrometheusTemplate(
              "Workflow {{ $labels.workflowType }} has had {{ $value }} activity failures in the last 1h. Check Bugsink and the Temporal UI.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(activity_task_fail{namespace="default",workflowType=~"prReview|prSummary"}[1h]) > 2',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
