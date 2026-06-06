import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

type PrometheusRule = NonNullable<PrometheusRuleSpecGroups["rules"]>[number];

// Check-and-skip workflows emit `temporal_workflow_outcome_total{outcome,reason}`
// via setOutcome() (packages/temporal/src/workflows/ha/util.ts). Many of them
// legitimately skip most runs — e.g. runVacuumIfNotHome skips whenever someone
// is home, which is the common case for a WFH household. A skip for one of those
// *expected* gate reasons is NOT a malfunction, so counting it toward a
// "never executed" alert produces false pages (PagerDuty 5332).
//
// Each entry lists the skip `reason`s that are normal operation for that
// workflow; the alert counts only skips whose reason is NOT benign, so it fires
// only when the gate is stuck for an anomalous reason (e.g. an `unavailable`
// vacuum state). A genuinely stuck presence sensor surfaces via HA
// entity-availability alerts, not here.
const CHECK_AND_SKIP_WORKFLOWS: {
  workflow: string;
  benignSkipReasons: string[];
}[] = [
  {
    workflow: "runVacuumIfNotHome",
    // someone-home = expected presence gate; cleaning/returning = the vacuum is
    // already running. error/unavailable/unknown vacuum states are anomalous and
    // intentionally still page.
    benignSkipReasons: [
      "someone-home",
      "vacuum-state-cleaning",
      "vacuum-state-returning",
    ],
  },
  // goodMorning* skip when no one is home to wake — the expected gate.
  { workflow: "goodMorningWakeUp", benignSkipReasons: ["no-one-home"] },
  { workflow: "goodMorningGetUp", benignSkipReasons: ["no-one-home"] },
];

// Builds the reason-aware "skipped for 5d, never executed" rules: one tailored
// rule per configured workflow (benign reasons excluded) plus a generic
// fallback for any workflow not yet in the config, so coverage is never silently
// lost when a new check-and-skip workflow is added.
function buildCheckAndSkipOutcomeRules(): PrometheusRule[] {
  const configured = CHECK_AND_SKIP_WORKFLOWS.map((w) => w.workflow);

  const perWorkflow: PrometheusRule[] = CHECK_AND_SKIP_WORKFLOWS.map(
    ({ workflow, benignSkipReasons }) => {
      const benign = benignSkipReasons.join("|");
      return {
        alert: "TemporalCheckAndSkipNeverExecuted",
        annotations: {
          summary: escapePrometheusTemplate(
            "{{ $labels.workflow }} has only skipped (anomalously) for 5 days",
          ),
          description: escapePrometheusTemplate(
            "Workflow {{ $labels.workflow }} has emitted only `skipped` outcomes for 5 days with no `executed` run, excluding its expected gate reasons. The gating condition may be stuck for an anomalous reason — check the workflow in the Temporal UI and HA entity availability.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `sum by (workflow) (increase(temporal_workflow_outcome_total{workflow="${workflow}",outcome="skipped",reason!~"${benign}"}[5d])) > 5\nunless on (workflow)\n  sum by (workflow) (increase(temporal_workflow_outcome_total{workflow="${workflow}",outcome="executed"}[5d])) > 0`,
        ),
        for: "1h",
        labels: {
          severity: "warning",
        },
      };
    },
  );

  const excluded = configured.join("|");
  // When no workflows are configured, the exclusion selector must be omitted
  // entirely: PromQL/RE2 treats `workflow!~""` as "match nothing" (the empty
  // pattern matches every string, so the negation excludes everything), which
  // would silently disable the fallback. An empty selector makes the fallback
  // cover all workflows, which is the intended behavior.
  const fallbackSelector = excluded === "" ? "" : `workflow!~"${excluded}",`;
  const fallback: PrometheusRule = {
    alert: "TemporalCheckAndSkipNeverExecuted",
    annotations: {
      summary: escapePrometheusTemplate(
        "{{ $labels.workflow }} has skipped every run for 5 days",
      ),
      description: escapePrometheusTemplate(
        "Workflow {{ $labels.workflow }} has emitted only `skipped` outcomes for 5 days, never `executed`. Either the gating condition is permanently stuck, or this workflow needs a benign-skip-reason entry in CHECK_AND_SKIP_WORKFLOWS (monitoring/rules/temporal.ts). Check the Temporal UI and HA presence entities.",
      ),
    },
    expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
      `sum by (workflow) (increase(temporal_workflow_outcome_total{${fallbackSelector}outcome="skipped"}[5d])) > 5\nunless on (workflow)\n  sum by (workflow) (increase(temporal_workflow_outcome_total{${fallbackSelector}outcome="executed"}[5d])) > 0`,
    ),
    for: "1h",
    labels: {
      severity: "warning",
    },
  };

  return [...perWorkflow, fallback];
}

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
            'max_over_time(scout_data_dragon_runs{outcome="failed"}[24h]) > 0',
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
            'max_over_time(scout_data_dragon_runs{outcome="failed",reason=~"git-push-failed|pr-create-failed|pr-merge-failed"}[24h]) > 0',
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
            "absent_over_time(scout_data_dragon_runs[36h])",
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
            'absent(up{namespace="temporal",service=~".*temporal.*worker.*metrics.*|temporal-worker-app-metrics"}) or max(up{namespace="temporal",service=~".*temporal.*worker.*metrics.*|temporal-worker-app-metrics"}) == 0',
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
            'absent(up{namespace="temporal",service=~".*temporal.*server.*metrics.*"}) or max(up{namespace="temporal",service=~".*temporal.*server.*metrics.*"}) == 0',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "TemporalHaEventBridgeDisconnected",
          annotations: {
            summary: "Temporal HA event bridge is disconnected",
            description:
              "The Temporal worker has not been able to keep the Home Assistant event bridge connected. Check worker logs and ha_event_bridge_start_failures_total for the reason.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "max(ha_event_bridge_connected) == 0",
          ),
          for: "30m",
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
      // Surfaces drift in check-and-skip workflows: a workflow that only ever
      // skips (never executes) for 5 days may have a stuck gate even though
      // Temporal reports every run Completed. Reason-aware — benign gate skips
      // (e.g. "someone is home") are excluded so normal operation doesn't page.
      // See CHECK_AND_SKIP_WORKFLOWS above.
      name: "temporal-workflow-outcomes",
      rules: buildCheckAndSkipOutcomeRules(),
    },
    {
      name: "pr-bot",
      rules: [
        {
          alert: "TemporalAiProviderIssueActive",
          annotations: {
            summary: escapePrometheusTemplate(
              "Temporal AI provider {{ $labels.provider }} {{ $labels.kind }} issue active",
            ),
            description: escapePrometheusTemplate(
              "Temporal has an active AI provider issue from {{ $labels.source }} (provider={{ $labels.provider }}, kind={{ $labels.kind }}). Check provider billing/rate limits and PR review worker logs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max by (app, provider, kind, source) (ai_provider_issue_active{app="temporal"}) == 1',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
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
