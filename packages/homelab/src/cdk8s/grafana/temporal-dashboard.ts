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
    ],
  };
}

export function exportTemporalDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createTemporalDashboard());
}
