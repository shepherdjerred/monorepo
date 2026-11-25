import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import { getTemporalPlatformHealthRuleGroup } from "./temporal-platform-health.ts";
import { temporalQueueTimeoutRules } from "./temporal-timeouts.ts";
import {
  buildRetainedWorkflowWorkerHealthRules,
  buildTemporalDomainWorkerHealthRules,
} from "./temporal-worker-health.ts";

type PrometheusRule = NonNullable<PrometheusRuleSpecGroups["rules"]>[number];

// Check-and-skip workflows emit `temporal_workflow_outcome_total{outcome,reason}`
// via setOutcome() (packages/temporal/src/workflows/ha/util.ts). Many of them
// legitimately skip most runs — e.g. runVacuumIfNotHome skips whenever someone
// is home, which is the common case for a WFH household. A skip for one of those
// *expected* gate reasons is NOT a malfunction, so counting it toward a
// "never executed" alert produces false failure signals.
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
          summary: "Automation workflow has skipped every run for 5 days",
          description: escapePrometheusTemplate(
            "Workflow {{ $labels.workflow }} has recorded only unexpected skips with no completed execution over the last 5 days, so its automation has not run. Check the workflow history in the Temporal UI and inspect Home Assistant entity availability for a stuck gating condition.",
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
  // Unconfigured workflows fall back to counting all skips; add expected gate
  // reasons to CHECK_AND_SKIP_WORKFLOWS above if normal operation triggers this.
  const fallback: PrometheusRule = {
    alert: "TemporalCheckAndSkipNeverExecuted",
    annotations: {
      summary: "Automation workflow has skipped every run for 5 days",
      description: escapePrometheusTemplate(
        "Workflow {{ $labels.workflow }} has skipped every run for 5 days without executing once, leaving its automation inactive. Check the Temporal UI and Home Assistant presence entities for a stuck gate, or register expected skip reasons if these skips are normal.",
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

// Scout Data Dragon updater failure alerts. Extracted from
// getTemporalRuleGroups (which is at the max-lines limit) and spread back into
// the temporal-workflow-failures group below.
const SCOUT_DATA_DRAGON_FAILURE_RULES: PrometheusRule[] = [
  {
    alert: "ScoutDataDragonUpdateFailed",
    annotations: {
      summary: "Scout Data Dragon update failed",
      description: escapePrometheusTemplate(
        "The Scout Data Dragon updater failed in the last 24 hours (reason: {{ $labels.reason }}), leaving League static game data stale. Check the workflow run in the Temporal UI and inspect the Scout worker logs.",
      ),
    },
    expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
      'time() - max_over_time(scout_data_dragon_last_failure_timestamp{reason!~"git-push-failed|pr-create-failed"}[24h]) < 86400',
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
      summary: "Scout Data Dragon PR creation or push failed",
      description: escapePrometheusTemplate(
        "The Scout Data Dragon updater could not push its branch or open a pull request (reason: {{ $labels.reason }}), blocking automated static data updates. Check GitHub credentials, branch state, and worker logs in the Temporal UI.",
      ),
    },
    expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
      'time() - max_over_time(scout_data_dragon_last_failure_timestamp{reason=~"git-push-failed|pr-create-failed"}[24h]) < 86400',
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
      description:
        "The Scout Data Dragon updater opened a pull request in the last 24 hours but could not enable auto-merge, leaving the data update unmerged. Check open chore/scout-data-dragon-* pull requests in GitHub and merge or enable auto-merge manually.",
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
    // The SDK exports timestamp gauges without a unit suffix. The duration
    // histogram does have `_s`, but applying that convention to these gauges
    // queries an absent metric and misses failures (verified on worker scrapes).
    expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
      "time() - max_over_time(scout_data_dragon_auto_merge_last_failure_timestamp[24h]) < 60 * 60 * 24",
    ),
    for: "15m",
    labels: {
      severity: "warning",
    },
  },
  {
    alert: "ScoutDataDragonUpdaterNotRunning",
    annotations: {
      summary: "Scout Data Dragon updater has not run in 36 hours",
      description:
        "The Scout Data Dragon scheduled workflow has not recorded any run, skip, or failure in 36 hours, so new League patch data will not be picked up. Check the schedule state in the Temporal UI and verify that the Scout worker is polling.",
    },
    expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
      "absent_over_time(scout_data_dragon_last_run_timestamp[36h]) or time() - max(max_over_time(scout_data_dragon_last_run_timestamp[36h])) > 36 * 3600",
    ),
    for: "30m",
    labels: {
      severity: "warning",
    },
  },
];

export function getTemporalRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    getTemporalPlatformHealthRuleGroup(),
    {
      name: "temporal-workflow-failures",
      rules: [
        {
          alert: "TemporalUnexpectedNamespaceStartAttempted",
          annotations: {
            summary: "Workflow start used unexpected Temporal namespace",
            description: escapePrometheusTemplate(
              "Temporal received {{ $value }} workflow-start requests in unexpected namespace {{ $labels.exported_namespace }} over the last 15 minutes, where no active workers run. Inspect the operation label in Temporal metrics and fix the caller to use only beta or prod.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(service_requests{exported_namespace!~"beta|prod|temporal-system",operation=~"StartWorkflowExecution|SignalWithStartWorkflowExecution"}[15m]) > 0',
          ),
          for: "1m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "TemporalWorkflowActivityFailing",
          annotations: {
            summary: "Background workflow tasks are failing repeatedly",
            description: escapePrometheusTemplate(
              "Activity {{ $labels.activityType }} in workflow {{ $labels.workflowType }} failed {{ $value }} times in the last 20 minutes, delaying or blocking workflow completion. Inspect the failing workflow execution in the Temporal UI and check worker logs for the error.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(activity_task_fail{exported_namespace=~"prod|beta",workflowType!~"deliveryDeploymentWorkflow|deliveryWorkerRecoveryWorkflow|temporal_sys_worker_deployment_workflow"}[20m]) > 10',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "ZfsMaintenanceFailed",
          annotations: {
            summary: "ZFS maintenance workflow failed",
            description: escapePrometheusTemplate(
              "The ZFS maintenance workflow failed {{ $value }} activity attempts in the last 24 hours, so weekly pool scrub or autotrim tasks may not have completed. Check the runZfsMaintenanceWorkflow execution in the Temporal UI and inspect node ZFS pool health.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(activity_task_fail{exported_namespace="prod",workflowType="runZfsMaintenanceWorkflow"}[24h]) > 0',
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
              "One or more canonical Temporal worker metrics endpoints are missing or failing Prometheus scrapes, blinding worker health and poller alerts. Check pod status, metrics Services, and ServiceMonitors in the temporal namespace.",
          },
          // The nine canonical Temporal workers expose SDK metrics through
          // their per-worker metrics Services. cdk8s prefixes names with the
          // chart name, so match the stable canonical worker suffixes and
          // require every endpoint to be present and up. Kubernetes truncates
          // the long Glitter Service names at 63 characters, so the prefix
          // must remain wildcarded rather than assuming the untruncated name.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'absent(up{namespace="temporal",service=~".*temporal-(gateway|home-worker|reports-worker|infra-worker|repo-worker|scout-worker|agent-worker|glitter-corpus-worker|glitter-context-worker)-metrics-service"}) or count(up{namespace="temporal",service=~".*temporal-(gateway|home-worker|reports-worker|infra-worker|repo-worker|scout-worker|agent-worker|glitter-corpus-worker|glitter-context-worker)-metrics-service"}) < 9 or min(up{namespace="temporal",service=~".*temporal-(gateway|home-worker|reports-worker|infra-worker|repo-worker|scout-worker|agent-worker|glitter-corpus-worker|glitter-context-worker)-metrics-service"}) == 0',
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "TemporalServerMetricsDown",
          annotations: {
            summary: "Temporal server metrics scrape is down",
            description:
              "Prometheus cannot scrape the Temporal server metrics endpoint, blinding workflow failure, backlog, and latency alerts. Check the Temporal server pods, metrics Service, and ServiceMonitor in the temporal namespace.",
          },
          // Service name is `temporal-temporal-server-metrics-service`. See
          // TemporalWorkerMetricsDown above for the same canonical-name rule.
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
            summary: "Temporal Home Assistant event bridge is disconnected",
            description:
              "The Temporal home worker has been disconnected from the Home Assistant event stream for 30 minutes, so Home Assistant events are not triggering workflows. Check the home-worker logs and Home Assistant WebSocket reachability.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max(ha_event_bridge_connected{namespace="temporal",service=~".*temporal-home-worker.*metrics.*"}) == 0 or absent(ha_event_bridge_connected{namespace="temporal",service=~".*temporal-home-worker.*metrics.*"})',
          ),
          for: "30m",
          labels: {
            severity: "warning",
          },
        },
        {
          // Daily homelab-audit failing twice in a row — the agent is hitting
          // the 45-min activity wall. The historical subprocess exit metric
          // name is retained across the native Claude Agent SDK cutover.
          alert: "HomelabAuditFailedTwoDays",
          annotations: {
            summary: "Daily homelab audit failed two days in a row",
            description: escapePrometheusTemplate(
              "The daily homelab audit workflow has exited non-zero {{ $value }} times in the last 48 hours, leaving automated cluster audit reports incomplete. Check the agent worker logs, traces, and Temporal UI for timeouts or SDK errors.",
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
          // Retain the historical CLI soft-kill alert while old series remain
          // queryable. Native SDK cancellation is covered by current SDK and
          // common LLM outcome metrics.
          alert: "AgentSubprocessSoftKill",
          annotations: {
            summary: "Background AI agent task timed out and was stopped",
            description: escapePrometheusTemplate(
              "An agent subprocess for workflow {{ $labels.workflow_type }} was soft-killed {{ $value }} times in the last hour because an activity timed out or was cancelled. Check the workflow execution in the Temporal UI and agent worker logs to see why the run stalled.",
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
          // A Workflow Task fails before any Activity runs, so
          // `activity_task_fail` above cannot see it. That blind spot hid a
          // worker pinned three weeks behind `main` for the whole of
          // September: it could not load two registered Workflow types at all
          // ("no such function is exported by the workflow bundle"), the tasks
          // failed and retried forever, and the only visible symptom was the
          // schedule's own execution timeout hours later. A weekly schedule in
          // the same state produced two failures total and no alert at all.
          //
          // Scope to `first_attempt="false"` as well as excluding benign
          // `UnhandledCommand` optimistic-concurrency retries: Temporal
          // Server's internal Go scheduler (`temporal-sys-scheduler-workflow`)
          // occasionally trips 1s `[TMPRL1101]` deadlock detection on Attempt 1
          // under transient CPU load and succeeds immediately on Attempt 2,
          // which would otherwise hold `increase([1h]) > 0` positive for ~50m.
          // Any genuinely broken bundle or determinism failure fails again on
          // its very first retry (`first_attempt="false"`).
          //
          // `for` must stay well under the lookback window. A burst of
          // failures keeps increase(...[1h]) positive for only about an hour,
          // so a pending period at or beyond that can never be satisfied and
          // the rule would silently never fire — exactly the blind spot it
          // exists to close.
          alert: "TemporalWorkflowTasksFailing",
          annotations: {
            summary: "Temporal workflows are failing before tasks start",
            description: escapePrometheusTemplate(
              "Workflow tasks in namespace {{ $labels.exported_namespace }} failed {{ $value }} retry attempts in the last hour, stalling workflows before activities can run. Check the Temporal UI for bundle or determinism errors and verify the active worker deployment exports every registered workflow.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(failed_workflow_tasks{exported_namespace=~"prod|beta",failure!="UnhandledCommand",first_attempt="false"}[1h]) > 0',
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
        ...temporalQueueTimeoutRules(),
        ...buildTemporalDomainWorkerHealthRules(),
        ...buildRetainedWorkflowWorkerHealthRules(),
        {
          // Freshness state encoding: 2 = pending activation, 1 = fresh,
          // 0 = stale or missing receipt, -1 = absent, paused, or unregistered.
          alert: "TemporalReportHeartbeatStale",
          annotations: {
            summary: escapePrometheusTemplate(
              "Scheduled report {{ $labels.schedule_id }} is stale or missing",
            ),
            description: escapePrometheusTemplate(
              "Report schedule {{ $labels.schedule_id }} reported freshness state {{ $value }} (below 1 means stale, missing, or paused), so expected report outputs are overdue. Inspect accepted S3 report receipts and check the schedule in the Temporal UI without disabling it.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "temporal_report_freshness_state < 1",
          ),
          for: "15m",
          labels: { severity: "warning" },
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
      name: "glitter-discord-corpus",
      rules: [
        {
          alert: "GlitterCorpusStorageIntegrityFailure",
          annotations: {
            summary: "Glitter Discord corpus storage integrity failed",
            description:
              "SeaweedFS returned a missing, collided, or checksum-invalid corpus object, blocking snapshot publication. Inspect the failed Glitter corpus activity and SeaweedFS object storage before retrying.",
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
              "The Glitter corpus archiver received a 401 or 403 response from Discord and stopped capture because archive completeness can no longer be guaranteed. Verify the Discord bot token and channel permissions, then resume the archival workflow.",
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
            summary: "Glitter Discord archiver is repeatedly rate limited",
            description: escapePrometheusTemplate(
              "The Glitter Discord archiver received {{ $value }} HTTP 429 rate-limit responses in the last hour, slowing message capture. Check Discord rate-limit headers in worker logs and pause any active backfill if pressure persists.",
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
              "No verified Glitter Discord corpus snapshot has been published in over 30 hours, leaving the archive behind recent Discord activity. Check the glitter-corpus-daily schedule and its latest workflow run in the Temporal UI.",
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
              "The latest Discord inventory detected {{ $value }} removed or newly excluded channels or threads compared with the published baseline, blocking automatic scope changes. Review the channel inventory diff in the Glitter corpus workflow before accepting the new baseline.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(glitter_corpus_inventory_scope_changes{change=~"removed|scope-decision-changed"}) > 0',
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
      // PR-closed Woodpecker build cancellation. A spike in signature
      // rejections means the webhook secret is wrong or someone is probing
      // the public URL with bad payloads.
      name: "github-webhook",
      rules: [
        {
          alert: "PrWebhookSignatureFailures",
          annotations: {
            summary:
              "GitHub webhook deliveries are failing signature verification",
            description: escapePrometheusTemplate(
              "{{ $value }} GitHub webhook deliveries failed HMAC signature verification in the last 30 minutes, which drops PR merge-conflict checks and build cancellations if legitimate requests are rejected. Verify the webhook secret in 1Password matches GitHub settings and check ingress logs for unauthorized probes.",
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
