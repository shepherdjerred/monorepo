import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";
import { statPanel, timeseriesPanel } from "./dashboard-panels.ts";

export function createTemporalDashboard() {
  return {
    uid: "temporal-dashboard",
    title: "Temporal - Workflows",
    tags: ["temporal", "workflow", "scout"],
    timezone: "browser",
    schemaVersion: 39,
    version: 1,
    refresh: "1m",
    time: { from: "now-7d", to: "now" },
    panels: [
      statPanel({
        id: 1,
        title: "Temporal Server Scrape",
        description: "Prometheus scrape health for Temporal server metrics",
        expr: 'max(up{namespace="temporal", service=~".*temporal.*server.*metrics.*"})',
        legend: "server",
        x: 0,
        y: 0,
        w: 8,
        h: 4,
      }),
      statPanel({
        id: 2,
        title: "Temporal Worker Scrape",
        description: "Prometheus scrape health for Temporal worker SDK metrics",
        expr: 'max(up{namespace="temporal", service=~".*temporal.*worker.*metrics.*|temporal-worker-app-metrics"})',
        legend: "worker",
        x: 8,
        y: 0,
        w: 8,
        h: 4,
      }),
      statPanel({
        id: 3,
        title: "Data Dragon Version Current",
        description:
          "Latest Data Dragon version-check result. 1 means the recorded current/latest label pair is present.",
        expr: "max by (current_version, latest_version) (scout_data_dragon_version_info) or on() vector(0)",
        legend: "{{current_version}} / {{latest_version}}",
        x: 16,
        y: 0,
        w: 8,
        h: 4,
      }),
      timeseriesPanel({
        id: 4,
        title: "Data Dragon Run Outcomes",
        description: "Updater runs by mode, outcome, and reason",
        targets: [
          {
            expr: "max by (mode, outcome, reason) (scout_data_dragon_runs) or on() vector(0)",
            legend: "{{mode}} {{outcome}} {{reason}}",
          },
        ],
        x: 0,
        y: 4,
        w: 12,
        h: 8,
      }),
      timeseriesPanel({
        id: 5,
        title: "Data Dragon Duration",
        description: "Updater runtime p95",
        targets: [
          {
            expr: "histogram_quantile(0.95, sum by (le) (rate(scout_data_dragon_duration_s_bucket[7d]))) or on() vector(0)",
            legend: "p95",
          },
        ],
        x: 12,
        y: 4,
        w: 12,
        h: 8,
        unit: "s",
      }),
      timeseriesPanel({
        id: 6,
        title: "Temporal Activity Failures",
        description:
          "Temporal server activity task failures by workflow/activity",
        targets: [
          {
            expr: 'sum by (workflowType, activityType) (increase(activity_task_fail{namespace="default"}[1h])) or on() vector(0)',
            legend: "{{workflowType}} {{activityType}}",
          },
        ],
        x: 0,
        y: 12,
        w: 12,
        h: 8,
      }),
      timeseriesPanel({
        id: 7,
        title: "Data Dragon Changed Files And PRs",
        description: "Changed files from the latest run and PR creation count",
        targets: [
          {
            expr: "max by (mode, outcome) (scout_data_dragon_changed_files) or on() vector(0)",
            legend: "files {{mode}} {{outcome}}",
          },
          {
            expr: "max(scout_data_dragon_prs) or on() vector(0)",
            legend: "prs",
          },
        ],
        x: 12,
        y: 12,
        w: 12,
        h: 8,
      }),
      // -----------------------------------------------------------------
      // PR Review Bot row (y >= 48) — driven by metrics emitted by
      // packages/temporal/src/event-bridge/github-webhook.ts and
      // packages/temporal/src/activities/pr-agent.ts.
      // -----------------------------------------------------------------
      statPanel({
        id: 200,
        title: "PR Webhooks (24h)",
        description:
          "Total accepted GitHub pull_request webhook deliveries in the last 24h (post signature verify).",
        expr: 'sum(increase(pr_webhook_received_total{event="pull_request"}[24h]))',
        legend: "deliveries",
        x: 0,
        y: 48,
        w: 6,
        h: 4,
      }),
      statPanel({
        id: 201,
        title: "Signature Failures (24h)",
        description:
          "Count of webhook deliveries rejected for missing/invalid X-Hub-Signature-256. Drives PrWebhookSignatureFailures alert.",
        expr: "sum(increase(pr_webhook_signature_failures_total[24h]))",
        legend: "rejects",
        x: 6,
        y: 48,
        w: 6,
        h: 4,
      }),
      statPanel({
        id: 202,
        title: "Skipped (24h)",
        description:
          "Webhook deliveries that passed signature verification but were skipped (drafts, bot authors, irrelevant actions).",
        expr: "sum(increase(pr_webhook_skipped_total[24h]))",
        legend: "skipped",
        x: 12,
        y: 48,
        w: 6,
        h: 4,
      }),
      statPanel({
        id: 203,
        title: "Agent Failures (24h)",
        description:
          "Subprocess exits with non-zero code from the pr-agent claude wrapper.",
        expr: 'sum(increase(pr_agent_subprocess_exit_total{exit_code!="0"}[24h])) or on() vector(0)',
        legend: "fails",
        x: 18,
        y: 48,
        w: 6,
        h: 4,
      }),
      timeseriesPanel({
        id: 204,
        title: "Webhook Volume by Action",
        description: "pull_request events received, broken down by action.",
        targets: [
          {
            expr: 'sum by (action) (increase(pr_webhook_received_total{event="pull_request"}[1h])) or on() vector(0)',
            legend: "{{action}}",
          },
        ],
        x: 0,
        y: 52,
        w: 12,
        h: 8,
      }),
      timeseriesPanel({
        id: 205,
        title: "Skipped Reasons",
        description:
          "Why incoming PRs are skipped (draft, bot-author, action:<x>).",
        targets: [
          {
            expr: "sum by (reason) (increase(pr_webhook_skipped_total[1h])) or on() vector(0)",
            legend: "{{reason}}",
          },
        ],
        x: 12,
        y: 52,
        w: 12,
        h: 8,
      }),
      timeseriesPanel({
        id: 206,
        title: "PR Agent Duration p50 / p95",
        description:
          "claude -p subprocess wall-clock duration distribution by kind (review/summary), last 7d.",
        targets: [
          {
            expr: "histogram_quantile(0.5, sum by (le, kind) (rate(pr_agent_subprocess_duration_seconds_bucket[7d]))) or on() vector(0)",
            legend: "{{kind}} p50",
          },
          {
            expr: "histogram_quantile(0.95, sum by (le, kind) (rate(pr_agent_subprocess_duration_seconds_bucket[7d]))) or on() vector(0)",
            legend: "{{kind}} p95",
          },
        ],
        x: 0,
        y: 60,
        w: 12,
        h: 8,
        unit: "s",
      }),
      timeseriesPanel({
        id: 207,
        title: "PR Agent Tokens by Direction",
        description:
          "Token consumption of pr-agent invocations, split by direction (input/output/cache_read/cache_create).",
        targets: [
          {
            expr: "sum by (kind, direction) (rate(pr_agent_tokens_total[1d])) or on() vector(0)",
            legend: "{{kind}} {{direction}}",
          },
        ],
        x: 12,
        y: 60,
        w: 12,
        h: 8,
      }),
      // -----------------------------------------------------------------
      // Agent subprocesses row (y >= 68) — covers the long-running
      // claude -p subprocesses spawned by alert-remediation +
      // agent-task (homelab-audit) so a hang or wall-hit pattern is
      // visible at a glance. Added 2026-06-14 after a 14-day silent
      // outage in alert-remediation.
      // -----------------------------------------------------------------
      timeseriesPanel({
        id: 300,
        title: "Agent Subprocess Wall-clock p50 / p95 / p99",
        description:
          "Wall-clock duration distribution of long-running claude -p subprocesses (homelab-audit + alert-remediation), 7d window. A p99 that pegs at the activity startToCloseTimeout means the subprocess is wedged; instrumentation captures the soft-kill + last stderr line so the next line below in Loki has the hang signature.",
        targets: [
          {
            expr: "histogram_quantile(0.5, sum by (le) (rate(homelab_audit_subprocess_duration_seconds_bucket[7d]))) or on() vector(0)",
            legend: "homelab-audit p50",
          },
          {
            expr: "histogram_quantile(0.95, sum by (le) (rate(homelab_audit_subprocess_duration_seconds_bucket[7d]))) or on() vector(0)",
            legend: "homelab-audit p95",
          },
          {
            expr: "histogram_quantile(0.99, sum by (le) (rate(homelab_audit_subprocess_duration_seconds_bucket[7d]))) or on() vector(0)",
            legend: "homelab-audit p99",
          },
          {
            expr: "histogram_quantile(0.5, sum by (le) (rate(alert_remediation_subprocess_duration_seconds_bucket[7d]))) or on() vector(0)",
            legend: "alert-remediation p50",
          },
          {
            expr: "histogram_quantile(0.95, sum by (le) (rate(alert_remediation_subprocess_duration_seconds_bucket[7d]))) or on() vector(0)",
            legend: "alert-remediation p95",
          },
          {
            expr: "histogram_quantile(0.99, sum by (le) (rate(alert_remediation_subprocess_duration_seconds_bucket[7d]))) or on() vector(0)",
            legend: "alert-remediation p99",
          },
        ],
        x: 0,
        y: 68,
        w: 12,
        h: 8,
        unit: "s",
      }),
      timeseriesPanel({
        id: 301,
        title: "Agent Subprocess Exits by Signal",
        description:
          "How agent subprocesses terminate: natural (exit code 0), SIGINT (our pre-emptive soft-kill at T-90s), SIGTERM (Temporal activity wall hit). A high SIGTERM rate means our soft-kill timing is wrong or the subprocess ignores SIGINT; a SIGINT spike correlates with the AgentSubprocessSoftKill alert.",
        targets: [
          {
            expr: "sum by (signal) (increase(alert_remediation_subprocess_exit_total[1h])) or on() vector(0)",
            legend: "alert-remediation {{signal}}",
          },
          {
            expr: 'sum by (provider, exit_code) (increase(agent_task_subprocess_exit_total{exit_code!="0"}[1h])) or on() vector(0)',
            legend: "agent-task {{provider}} exit_code={{exit_code}}",
          },
        ],
        x: 12,
        y: 68,
        w: 12,
        h: 8,
      }),
      timeseriesPanel({
        id: 302,
        title: "Agent Subprocess Max Idle Seconds (p95, 1h)",
        description:
          "p95 of the longest stderr-silent stretch per agent subprocess run over the last hour. A subprocess that's working emits stderr periodically; a wedged tool call (slow WebFetch / hung kubectl / API retry loop) is silent. Histogram-backed so concurrent runs (alert-remediation has `concurrency=3`) all contribute observations instead of overwriting one another. Drill down via Loki on the `lastStderrLine` field to see what was last running before the silence.",
        targets: [
          {
            expr: "histogram_quantile(0.95, sum by (workflow_type, le) (rate(agent_subprocess_idle_seconds_bucket[1h]))) or on() vector(0)",
            legend: "{{workflow_type}}",
          },
        ],
        x: 0,
        y: 76,
        w: 12,
        h: 8,
        unit: "s",
      }),
      statPanel({
        id: 303,
        title: "Agent Soft-Kills (1h)",
        description:
          "Pre-emptive SIGINT kills sent by the activity at T-90s before Temporal's startToCloseTimeout. Every tick means a subprocess was about to be hard-SIGTERM'd and the activity intervened to capture diagnostic state. Drives the AgentSubprocessSoftKill ticket alert.",
        expr: "sum by (workflow_type) (increase(agent_subprocess_soft_kills_total[1h])) or on() vector(0)",
        legend: "{{workflow_type}}",
        x: 12,
        y: 76,
        w: 12,
        h: 8,
      }),
      // -----------------------------------------------------------------
      // Alert remediation row (y >= 84) — driven by metrics emitted by
      // packages/temporal/src/activities/alert-remediation.ts. Added
      // 2026-06-14: the 14-day silent regression where every child
      // workflow returned decision=failed went undetected until manual
      // inspection.
      // -----------------------------------------------------------------
      timeseriesPanel({
        id: 310,
        title: "Alert Remediation Decisions",
        description:
          "Per-child workflow outcomes. A healthy mix is mostly `report-only` + occasional `pr-created`. `failed` means the agent never reached a verdict (usually the activity-wall hang); `verification-failed` means the agent ran but its proposed fix didn't pass tests.",
        targets: [
          {
            expr: "sum by (outcome) (increase(alert_remediation_decisions_total[1h])) or on() vector(0)",
            legend: "{{outcome}}",
          },
        ],
        x: 0,
        y: 84,
        w: 12,
        h: 8,
      }),
      timeseriesPanel({
        id: 311,
        title: "Alert Remediation Per-Source Volume",
        description:
          "Alert volume by source (PagerDuty vs Bugsink) and outcome. A spike in `bugsink/failed` typically means a high-volume Bugsink project is generating alerts faster than the agent can clear them.",
        targets: [
          {
            expr: "sum by (source, outcome) (increase(alert_remediation_decisions_total[1h])) or on() vector(0)",
            legend: "{{source}} {{outcome}}",
          },
        ],
        x: 12,
        y: 84,
        w: 12,
        h: 8,
      }),
      statPanel({
        id: 312,
        title: "Alert Remediation PRs Created (24h)",
        description:
          "Draft PRs opened by the alert-remediation agent in the last 24h. Should be a small positive number in steady state.",
        expr: 'sum(increase(alert_remediation_decisions_total{outcome="pr-created"}[24h])) or on() vector(0)',
        legend: "PRs",
        x: 0,
        y: 92,
        w: 8,
        h: 4,
      }),
      statPanel({
        id: 313,
        title: "Alert Remediation Failed Decisions (1h)",
        description:
          "Decisions returning `outcome=failed` in the last hour. Drives the AlertRemediationDecisionsAllFailing alert (which fires when these exceed half of all decisions).",
        expr: 'sum(increase(alert_remediation_decisions_total{outcome="failed"}[1h])) or on() vector(0)',
        legend: "failed",
        x: 8,
        y: 92,
        w: 8,
        h: 4,
      }),
      statPanel({
        id: 314,
        title: "Alert Remediation Subprocess SIGTERMs (1h)",
        description:
          "Number of alert-remediation subprocesses Temporal hard-killed at the 30-min activity wall in the last hour. Should be zero in steady state once the hang root cause is fixed; any positive number means an agent run was lost without producing a decision.",
        expr: 'sum(increase(alert_remediation_subprocess_exit_total{signal="SIGTERM"}[1h])) or on() vector(0)',
        legend: "SIGTERMs",
        x: 16,
        y: 92,
        w: 8,
        h: 4,
      }),
    ],
  };
}

export function exportTemporalDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createTemporalDashboard());
}
