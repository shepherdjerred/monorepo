import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

const PROMETHEUS_DATASOURCE = {
  type: "prometheus",
  uid: "Prometheus",
};

function target(expr: string, legendFormat: string, refId = "A") {
  return {
    datasource: PROMETHEUS_DATASOURCE,
    editorMode: "code",
    expr,
    legendFormat,
    range: true,
    refId,
  };
}

function statPanel(input: {
  id: number;
  title: string;
  description: string;
  expr: string;
  legend: string;
  x: number;
  y: number;
  w: number;
  h: number;
  unit?: string;
}) {
  return {
    id: input.id,
    type: "stat",
    title: input.title,
    description: input.description,
    datasource: PROMETHEUS_DATASOURCE,
    gridPos: { x: input.x, y: input.y, w: input.w, h: input.h },
    fieldConfig: {
      defaults: {
        unit: input.unit ?? "short",
        color: { mode: "thresholds" },
        thresholds: {
          mode: "absolute",
          steps: [
            { color: "red", value: null },
            { color: "green", value: 1 },
          ],
        },
      },
      overrides: [],
    },
    options: {
      colorMode: "value",
      graphMode: "area",
      justifyMode: "auto",
      orientation: "auto",
      reduceOptions: {
        calcs: ["lastNotNull"],
        fields: "",
        values: false,
      },
      textMode: "auto",
    },
    targets: [target(input.expr, input.legend)],
  };
}

function timeseriesPanel(input: {
  id: number;
  title: string;
  description: string;
  targets: { expr: string; legend: string }[];
  x: number;
  y: number;
  w: number;
  h: number;
  unit?: string;
}) {
  return {
    id: input.id,
    type: "timeseries",
    title: input.title,
    description: input.description,
    datasource: PROMETHEUS_DATASOURCE,
    gridPos: { x: input.x, y: input.y, w: input.w, h: input.h },
    fieldConfig: {
      defaults: {
        unit: input.unit ?? "short",
        color: { mode: "palette-classic" },
        custom: {
          drawStyle: "line",
          lineInterpolation: "linear",
          barAlignment: 0,
          lineWidth: 1,
          fillOpacity: 10,
          gradientMode: "none",
          spanNulls: false,
          showPoints: "never",
          pointSize: 5,
          stacking: { mode: "none", group: "A" },
          axisPlacement: "auto",
          axisLabel: "",
          axisColorMode: "text",
          scaleDistribution: { type: "linear" },
          hideFrom: { tooltip: false, viz: false, legend: false },
          thresholdsStyle: { mode: "off" },
        },
      },
      overrides: [],
    },
    options: {
      tooltip: { mode: "multi", sort: "none" },
      legend: { displayMode: "list", placement: "bottom", calcs: [] },
    },
    targets: input.targets.map(({ expr, legend }, index) =>
      target(expr, legend, String.fromCodePoint(65 + index)),
    ),
  };
}

export function createTemporalDashboard() {
  return {
    uid: "temporal-dashboard",
    title: "Temporal - Workflows",
    tags: ["temporal", "workflow", "scout", "docs-groom"],
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
        expr: 'max(up{namespace="temporal", service=~"temporal-server-metrics.*"})',
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
        expr: 'max(up{namespace="temporal", service=~"temporal-worker-metrics.*"})',
        legend: "worker",
        x: 8,
        y: 0,
        w: 8,
        h: 4,
      }),
      statPanel({
        id: 3,
        title: "Data Dragon Successes",
        description: "Successful Data Dragon updater runs in the last 7 days",
        expr: 'sum(increase(temporal_worker_scout_data_dragon_runs_total{outcome="success"}[7d]))',
        legend: "success",
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
            expr: "sum by (mode, outcome, reason) (increase(temporal_worker_scout_data_dragon_runs_total[1d]))",
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
            expr: "histogram_quantile(0.95, sum(rate(temporal_worker_scout_data_dragon_duration_seconds_bucket[7d])) by (le))",
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
            expr: 'sum by (workflowType, activityType) (increase(activity_task_fail{namespace="default"}[1h]))',
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
            expr: "max(temporal_worker_scout_data_dragon_changed_files) by (mode, outcome)",
            legend: "files {{mode}} {{outcome}}",
          },
          {
            expr: "sum(increase(temporal_worker_scout_data_dragon_prs_total[7d]))",
            legend: "prs",
          },
        ],
        x: 12,
        y: 12,
        w: 12,
        h: 8,
      }),
      // -----------------------------------------------------------------
      // Docs Grooming row (y >= 20)
      // -----------------------------------------------------------------
      statPanel({
        id: 100,
        title: "Today's Grooming PR Opened",
        description:
          "1 if the daily docs-groom workflow opened a grooming PR in the last 24h. 0 = run failed or made no changes.",
        expr: 'clamp_max(sum(increase(docs_groom_prs_opened_total{kind="grooming"}[24h])), 1)',
        legend: "today",
        x: 0,
        y: 20,
        w: 8,
        h: 4,
      }),
      statPanel({
        id: 101,
        title: "Implementation PRs (7d)",
        description:
          "Total per-task implementation PRs opened by docs-groom in the last 7 days",
        expr: 'sum(increase(docs_groom_prs_opened_total{kind="implementation"}[7d]))',
        legend: "prs",
        x: 8,
        y: 20,
        w: 8,
        h: 4,
      }),
      statPanel({
        id: 102,
        title: "Tasks Identified (24h)",
        description:
          "Total grooming tasks the audit pass identified in the last 24h (all difficulties)",
        expr: "sum(increase(docs_groom_tasks_identified_total[24h]))",
        legend: "tasks",
        x: 16,
        y: 20,
        w: 8,
        h: 4,
      }),
      timeseriesPanel({
        id: 103,
        title: "Tasks Identified by Difficulty",
        description:
          "Daily count of tasks identified by the audit, split by easy/medium/hard",
        targets: [
          {
            expr: "sum by (difficulty) (increase(docs_groom_tasks_identified_total[1d]))",
            legend: "{{difficulty}}",
          },
        ],
        x: 0,
        y: 24,
        w: 12,
        h: 8,
      }),
      timeseriesPanel({
        id: 104,
        title: "Claude Duration p50 / p95 by Phase",
        description: "claude -p wall-clock duration distribution, last 7d",
        targets: [
          {
            expr: "histogram_quantile(0.5, sum by (le, phase) (rate(docs_groom_claude_duration_seconds_bucket[7d])))",
            legend: "{{phase}} p50",
          },
          {
            expr: "histogram_quantile(0.95, sum by (le, phase) (rate(docs_groom_claude_duration_seconds_bucket[7d])))",
            legend: "{{phase}} p95",
          },
        ],
        x: 12,
        y: 24,
        w: 12,
        h: 8,
        unit: "s",
      }),
      timeseriesPanel({
        id: 105,
        title: "Claude Cost ($/day) by Phase",
        description:
          "Sum of total_cost_usd from claude -p result messages, per phase. Drives DocsGroomCostBudgetExceeded alert.",
        targets: [
          {
            expr: "sum by (phase) (increase(docs_groom_claude_cost_usd_total[1d]))",
            legend: "{{phase}}",
          },
        ],
        x: 0,
        y: 32,
        w: 12,
        h: 8,
      }),
      timeseriesPanel({
        id: 106,
        title: "Claude Cache Hit Ratio (7d, by phase)",
        description:
          "cache_read / (input + cache_read) — higher is better. Tracks how well prompt caching is working.",
        targets: [
          {
            expr: 'sum by (phase) (rate(docs_groom_claude_tokens_total{kind="cache_read"}[7d])) / (sum by (phase) (rate(docs_groom_claude_tokens_total{kind="input"}[7d])) + sum by (phase) (rate(docs_groom_claude_tokens_total{kind="cache_read"}[7d])))',
            legend: "{{phase}}",
          },
        ],
        x: 12,
        y: 32,
        w: 12,
        h: 8,
        unit: "percentunit",
      }),
      timeseriesPanel({
        id: 107,
        title: "Validation Rejections by Reason (24h)",
        description:
          "Why diffs were rejected before push: empty-diff, secret, gitignored, branch-main, typecheck-failed",
        targets: [
          {
            expr: "sum by (reason) (increase(docs_groom_validate_rejections_total[24h]))",
            legend: "{{reason}}",
          },
        ],
        x: 0,
        y: 40,
        w: 12,
        h: 8,
      }),
      timeseriesPanel({
        id: 108,
        title: "Docs-Groom Workflow Outcomes",
        description:
          "docs_groom_runs_total split by phase (audit/task) and outcome (success/failure/skipped)",
        targets: [
          {
            expr: "sum by (phase, outcome) (increase(docs_groom_runs_total[1d]))",
            legend: "{{phase}} {{outcome}}",
          },
        ],
        x: 12,
        y: 40,
        w: 12,
        h: 8,
      }),
    ],
  };
}

export function exportTemporalDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createTemporalDashboard());
}
