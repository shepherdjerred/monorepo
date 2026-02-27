import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

/**
 * Creates a Grafana dashboard for TaskNotes API & Sync metrics
 * Single instance — no filter variables needed
 */
export function createTasknotesDashboard() {
  const prometheusDatasource = {
    type: "prometheus",
    uid: "Prometheus",
  };

  const createStatPanel = (options: {
    title: string;
    query: string;
    legend: string;
    gridPos: { x: number; y: number; w: number; h: number };
    unit?: string;
    graphMode?: common.BigValueGraphMode;
  }) => {
    return new stat.PanelBuilder()
      .title(options.title)
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(options.query)
          .legendFormat(options.legend),
      )
      .unit(options.unit ?? "short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(options.graphMode ?? common.BigValueGraphMode.Area)
      .gridPos(options.gridPos);
  };

  const builder = new dashboard.DashboardBuilder("TaskNotes — API & Sync")
    .uid("tasknotes-dashboard")
    .tags(["tasknotes", "api"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable();

  // Row 1: Overview Stats
  builder.withRow(new dashboard.RowBuilder("Overview Stats"));

  builder.withPanel(
    createStatPanel({
      title: "Uptime",
      query: `tasknotes_uptime_seconds{namespace="tasknotes"}`,
      legend: "tasknotes",
      gridPos: { x: 0, y: 1, w: 6, h: 4 },
      unit: "s",
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Total Tasks",
      query: `tasknotes_tasks_total{namespace="tasknotes"}`,
      legend: "tasks",
      gridPos: { x: 6, y: 1, w: 6, h: 4 },
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Request Rate",
      query: `sum(rate(tasknotes_http_requests_total{namespace="tasknotes"}[5m]))`,
      legend: "req/s",
      gridPos: { x: 12, y: 1, w: 6, h: 4 },
      unit: "reqps",
    }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Error Rate")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum(rate(tasknotes_http_requests_total{namespace="tasknotes", status=~"5.."}[5m]))
             / sum(rate(tasknotes_http_requests_total{namespace="tasknotes"}[5m]))`,
          )
          .legendFormat("errors"),
      )
      .unit("percentunit")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 0.01, color: "yellow" },
            { value: 0.05, color: "red" },
          ]),
      )
      .gridPos({ x: 18, y: 1, w: 6, h: 4 }),
  );

  // Row 2: HTTP Performance
  builder.withRow(new dashboard.RowBuilder("HTTP Performance"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Request Rate by Route")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (route) (rate(tasknotes_http_requests_total{namespace="tasknotes"}[5m]))`,
          )
          .legendFormat("{{route}}"),
      )
      .unit("reqps")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 5, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Duration p50 / p95 / p99")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.50, sum(rate(tasknotes_http_request_duration_seconds_bucket{namespace="tasknotes"}[5m])) by (le))`,
          )
          .legendFormat("p50"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.95, sum(rate(tasknotes_http_request_duration_seconds_bucket{namespace="tasknotes"}[5m])) by (le))`,
          )
          .legendFormat("p95"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.99, sum(rate(tasknotes_http_request_duration_seconds_bucket{namespace="tasknotes"}[5m])) by (le))`,
          )
          .legendFormat("p99"),
      )
      .unit("s")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 5, w: 12, h: 8 }),
  );

  // Row 3: Task Operations
  builder.withRow(new dashboard.RowBuilder("Task Operations"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Tasks Created / Updated / Deleted")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `rate(tasknotes_tasks_created_total{namespace="tasknotes"}[5m])`,
          )
          .legendFormat("created"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `rate(tasknotes_tasks_updated_total{namespace="tasknotes"}[5m])`,
          )
          .legendFormat("updated"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `rate(tasknotes_tasks_deleted_total{namespace="tasknotes"}[5m])`,
          )
          .legendFormat("deleted"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 13, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Task Count Trend")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`tasknotes_tasks_total{namespace="tasknotes"}`)
          .legendFormat("total tasks"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 13, w: 12, h: 8 }),
  );

  // Row 4: Sync & Infrastructure
  builder.withRow(new dashboard.RowBuilder("Sync & Infrastructure"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Vault Files")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`tasknotes_sync_files_total{namespace="tasknotes"}`)
          .legendFormat("files"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 21, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Container Restarts")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (container) (increase(kube_pod_container_status_restarts_total{namespace="tasknotes"}[1h]))`,
          )
          .legendFormat("{{container}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 1, color: "yellow" },
            { value: 3, color: "red" },
          ]),
      )
      .gridPos({ x: 12, y: 21, w: 12, h: 8 }),
  );

  return builder.build();
}

/**
 * Exports the dashboard as JSON string for use in ConfigMaps
 * Uses Helm-escaped Grafana template variables for compatibility
 */
export function exportTasknotesDashboardJson(): string {
  const dashboardModel = createTasknotesDashboard();
  return exportDashboardWithHelmEscaping(dashboardModel);
}
