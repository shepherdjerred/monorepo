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
      ],
    },
    {
      name: "docs-groom",
      rules: [
        {
          alert: "DocsGroomScheduleNotRunning",
          annotations: {
            summary: "docs-groom daily workflow has not run",
            description:
              "The docs-groom-daily Temporal schedule has not recorded an audit run in the last 36 hours. Check the Temporal UI and worker logs.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(docs_groom_runs_total{phase="audit"}[36h])) < 1',
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "DocsGroomActivitiesFailing",
          annotations: {
            summary: escapePrometheusTemplate(
              "docs-groom workflow {{ $labels.workflowType }} activities failing",
            ),
            description: escapePrometheusTemplate(
              "docs-groom workflow {{ $labels.workflowType }} has had {{ $value }} activity failures in the last 24 hours. Check the Temporal UI and Bugsink.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(activity_task_fail{namespace="default",workflowType=~"runDocsGroom.*"}[24h]) > 2',
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "DocsGroomNoPrsOpened",
          annotations: {
            summary: "docs-groom audits succeed but produce no PRs",
            description:
              "The docs-groom audit has completed successfully in the last 3 days but opened zero PRs. The audit prompt may be too conservative or filterAlreadyOpen is over-filtering.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(docs_groom_prs_opened_total[3d])) == 0 and sum(increase(docs_groom_runs_total{phase="audit",outcome="success"}[3d])) > 0',
          ),
          for: "1h",
          labels: {
            severity: "info",
          },
        },
        {
          alert: "DocsGroomCostBudgetExceeded",
          annotations: {
            summary: "docs-groom claude -p cost exceeded daily budget",
            description: escapePrometheusTemplate(
              "docs-groom spent ${{ $value | humanize }} on claude -p invocations in the last 24h, exceeding the $5/day budget. Tune the per-run task cap or audit prompt.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum(increase(docs_groom_claude_cost_usd_total[1d])) > 5",
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "DocsGroomValidationSecretRejection",
          annotations: {
            summary:
              "docs-groom validateChanges blocked a diff containing a secret",
            description:
              "validateChanges refused to push a diff because a path matched a secret pattern (.env*, *.key, id_rsa*, etc.). Investigate immediately — Claude attempted to commit a sensitive file.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(docs_groom_validate_rejections_total{reason="secret"}[1h]) > 0',
          ),
          for: "0m",
          labels: {
            severity: "critical",
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
