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
// only when a workflow records an anomalous skip reason. The vacuum workflow
// fails outright for unavailable or unexpected unit states, which is covered by
// Temporal workflow-failure alerts. A genuinely stuck presence sensor surfaces
// via HA entity-availability alerts, not here.
const CHECK_AND_SKIP_WORKFLOWS: {
  workflow: string;
  benignSkipReasons: string[];
}[] = [
  {
    workflow: "runVacuumIfNotHome",
    // someone-home = expected presence gate; all-units-active = every floor unit
    // is already cleaning/returning so there was nothing to start. Both are normal
    // operation. (These are the only two skip reasons the fleet workflow emits;
    // keep them in sync with run-vacuum-if-not-home.ts.)
    benignSkipReasons: ["someone-home", "all-units-active"],
  },
  // goodMorning* skip when no one is home to wake. Preheat also intentionally
  // skips on warm mornings, while wake-up still executes the non-heating routine.
  {
    workflow: "goodMorningPreheat",
    benignSkipReasons: ["no-one-home", "not-cold"],
  },
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

// agentTaskWorkflow times out via its run timeout, which terminates the
// workflow WITHOUT running workflow code — so it can't self-report and none of
// the activity_task_fail rules ever fire for it. The agent-task-timeout-watch
// schedule scans visibility hourly and publishes the 24h count on the
// temporal_agent_task_timeouts_24h gauge. Steady state is 0 after the
// future-runAt startDelay fix (a one-off with runAt days out used to die at the
// 2h execution timeout before the agent ever ran).
function buildAgentTaskTimeoutRules(): PrometheusRule[] {
  return [
    {
      // >0 means agent tasks are timing out again — a regression or an agent
      // genuinely exceeding its run budget.
      alert: "TemporalAgentTaskTimingOut",
      annotations: {
        summary: "Temporal agent tasks are timing out",
        description: escapePrometheusTemplate(
          "{{ $value }} agentTaskWorkflow run(s) closed as TimedOut in the last 24h. A report-only agent task should run to completion — investigate in the Temporal UI (a future-dated runAt no longer defers via an in-workflow sleep; check the startDelay path in agent-task-scheduler.ts, or whether the agent exceeded its run budget).",
        ),
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        "max(temporal_agent_task_timeouts_24h) > 0",
      ),
      for: "10m",
      labels: {
        severity: "warning",
      },
    },
    {
      // The gauge is set to -1 when the visibility scan itself fails, so a broken
      // scan is distinguishable from a clean "no timeouts" (0). Alert separately,
      // since a failed scan otherwise reads as healthy.
      alert: "TemporalAgentTaskTimeoutScanFailed",
      annotations: {
        summary: "Temporal agent-task timeout scan is failing",
        description:
          "The agent-task-timeout-watch schedule could not list workflows to count agent-task timeouts (gauge = -1). The regression guardrail is blind until this recovers — check the Temporal worker logs and server visibility.",
      },
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        "min(temporal_agent_task_timeouts_24h) < 0",
      ),
      for: "30m",
      labels: {
        severity: "warning",
      },
    },
  ];
}

// Scout Data Dragon updater failure alerts. Extracted from
// getTemporalRuleGroups (which is at the max-lines limit) and spread back into
// the temporal-workflow-failures group below.
const SCOUT_DATA_DRAGON_FAILURE_RULES: PrometheusRule[] = [
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
    // "pr-merge-failed" was dropped from this regex: `gh pr merge
    // --auto` failures are caught locally in the activity and never
    // reach the outer catch that produces this reason label, so that
    // value could never be produced here. ScoutDataDragonAutoMergeFailed
    // below covers that signal via its own dedicated counter.
    alert: "ScoutDataDragonPrAutomationFailed",
    annotations: {
      summary: "Scout Data Dragon PR automation failed",
      description: escapePrometheusTemplate(
        "The Scout Data Dragon updater failed while pushing or creating a PR. Failure reason: {{ $labels.reason }}.",
      ),
    },
    expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
      'max_over_time(scout_data_dragon_runs{outcome="failed",reason=~"git-push-failed|pr-create-failed"}[24h]) > 0',
    ),
    for: "15m",
    labels: {
      severity: "warning",
    },
  },
  {
    alert: "ScoutDataDragonAutoMergeFailed",
    annotations: {
      summary: "Scout Data Dragon PR auto-merge setup failed",
      description: escapePrometheusTemplate(
        "The Scout Data Dragon updater recorded a PR auto-merge setup failure in the last 24 hours. The PR needs a manual merge — check open chore/scout-data-dragon-* PRs.",
      ),
    },
    // Recency gauge (seconds since the last auto-merge failure), not a counter
    // query. A monotonic counter can't satisfy both requirements at once:
    // increase(counter[24h]) misses the very first failure (the series is born
    // at 1, so the increase is 0), while max_over_time(counter[24h]) never ages
    // out (a flat positive counter stays positive until the worker restarts).
    // The timestamp gauge is read through a 24h max_over_time range, NOT as a
    // bare instant vector: the worker is single-replica, so a restart makes the
    // in-process gauge's instant series stale and `time() - <bare gauge>` would
    // return no series and wrongly resolve the alert. max_over_time keeps the
    // last failure's timestamp visible for the full 24h even across a restart,
    // so the alert fires on the first failure and clears 24h after the most
    // recent one regardless of worker recreation.
    //
    // The series name carries an `_s` suffix: the gauge is created with unit
    // "s" (data-dragon-metrics.ts) and the worker's Temporal Prometheus
    // exporter runs with `unitSuffix: true` (worker.ts), which appends the unit
    // to the exported metric name. Same convention as the histogram queried in
    // temporal-dashboard.ts as `scout_data_dragon_duration_s_bucket`. Querying
    // the bare (unsuffixed) name matches no series, so the alert never fires.
    expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
      "time() - max_over_time(scout_data_dragon_auto_merge_last_failure_timestamp_s[24h]) < 60 * 60 * 24",
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
];

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
        ...SCOUT_DATA_DRAGON_FAILURE_RULES,
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
          // Daily homelab-audit failing twice in a row — the agent is
          // hitting the 45-min activity wall. The existing
          // TemporalScheduledWorkflowFailingDaily covers activity_task_fail
          // but the audit's symptom is a non-zero subprocess exit (SIGTERM
          // at the wall), which our own counter captures directly.
          alert: "HomelabAuditFailedTwoDays",
          annotations: {
            summary: "homelab-audit-daily failed two days in a row",
            description: escapePrometheusTemplate(
              "The homelab-audit subprocess has exited non-zero {{ $value }} time(s) in the last 48h. The runbook agent is hitting the 45-min activity wall. Check Loki for the agent's `phase=soft-kill` line + `lastStderrLine` to identify the long-poling step.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(homelab_audit_subprocess_exit_total{exit_code!="0"}[48h]) >= 2',
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          // Soft-kills are the leading indicator of hung subprocesses: any
          // tick means a SIGINT had to be sent because the wall was 90s
          // away. Ticket (info), not page — the run still produces evidence
          // and the existing failure alerts cover outage.
          alert: "AgentSubprocessSoftKill",
          annotations: {
            summary: escapePrometheusTemplate(
              "Agent subprocess for {{ $labels.workflow_type }} was soft-killed",
            ),
            description: escapePrometheusTemplate(
              "The activity sent SIGINT to its agent subprocess for {{ $labels.workflow_type }} {{ $value }} time(s) in the last 1h because Temporal's activity wall was 90s away. The corresponding run's `phase=soft-kill` Loki line is the diagnostic capture point.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(agent_subprocess_soft_kills_total[1h]) > 0",
          ),
          for: "5m",
          labels: {
            severity: "info",
          },
        },
        {
          // Catches the "low-volume daily schedule, fails consistently for
          // days, no one notices" pattern — exactly what kept Scout Data
          // Dragon broken silently from 2026-05-02 to 2026-05-08. Existing
          // TemporalWorkflowActivityFailing requires >5 failures in 30m,
          // which a once-daily schedule can never hit.
          alert: "TemporalScheduledWorkflowFailingDaily",
          annotations: {
            summary: escapePrometheusTemplate(
              "Scheduled workflow {{ $labels.workflowType }} failing repeatedly",
            ),
            description: escapePrometheusTemplate(
              "{{ $labels.workflowType }} has had {{ $value }} activity failures across the last 48h. A daily schedule that fails twice in a row is broken — check the Temporal UI and worker logs.",
            ),
          },
          // Workflows excluded: HA-presence + iOS-action workflows are
          // event-triggered (their schedules are user actions, not crons), so
          // a "2 in 48h" rate doesn't indicate a broken schedule.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            [
              "increase(activity_task_fail{",
              'namespace="default",',
              `workflowType!~"${["welcomeHome", "leavingHome", "goodNight"].join("|")}"`,
              "}[48h]) >= 2",
            ].join(""),
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        ...buildAgentTaskTimeoutRules(),
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
      name: "glitter-discord-corpus",
      rules: [
        {
          alert: "GlitterCorpusStorageIntegrityFailure",
          annotations: {
            summary: "Glitter Discord corpus storage integrity failed",
            description:
              "SeaweedFS returned a missing, collided, or checksum-invalid corpus object. Snapshot publication is blocked; inspect the failed Glitter corpus activity before retrying.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(glitter_corpus_storage_integrity_failures_total[15m]) > 0",
          ),
          for: "1m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "GlitterCorpusDiscordAuthorizationFailed",
          annotations: {
            summary: "Glitter Discord archival bot lost authorization",
            description:
              "The corpus archiver received a Discord 401 or 403. Capture intentionally stopped because completeness cannot be proven with missing permissions.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(glitter_corpus_discord_requests_total{outcome="auth-failure"}[15m]) > 0',
          ),
          for: "1m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "GlitterCorpusRateLimitPressure",
          annotations: {
            summary: "Glitter Discord corpus is repeatedly rate limited",
            description: escapePrometheusTemplate(
              "The conservative one-request-per-second archiver still received {{ $value }} Discord 429 responses in the last hour. Inspect retry_after telemetry and pause the backfill if pressure persists.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(glitter_corpus_discord_requests_total{outcome="rate-limited"}[1h]) > 10',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GlitterCorpusSnapshotStale",
          annotations: {
            summary: "Glitter Discord corpus snapshot is stale",
            description:
              "A verified corpus snapshot exists but has not advanced for more than 30 hours. Check the glitter-corpus-daily schedule and its most recent workflow.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(time() - max(glitter_corpus_last_snapshot_timestamp_seconds) > 108000) or (max(glitter_corpus_snapshot_metrics_configured) == 1 unless on() glitter_corpus_last_snapshot_timestamp_seconds)",
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "GlitterCorpusInventoryScopeChanged",
          annotations: {
            summary: "Glitter Discord corpus inventory scope changed",
            description: escapePrometheusTemplate(
              "The latest Discord inventory has {{ $value }} added, removed, or newly excluded channels/threads compared with the published baseline. Review the immutable inventory before accepting the new scope.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum(glitter_corpus_inventory_scope_changes) > 0",
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    {
      // The GitHub webhook server survives the PR-bot removal: it is the
      // ingress for the merge-conflict check (push + pull_request) and the
      // PR-closed Buildkite build cancellation. A spike in signature
      // rejections means the webhook secret is wrong or someone is probing
      // the public URL with bad payloads.
      name: "github-webhook",
      rules: [
        {
          alert: "PrWebhookSignatureFailures",
          annotations: {
            summary: "GitHub webhook is rejecting signatures",
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
      ],
    },
  ];
}
