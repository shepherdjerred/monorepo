import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

const PROMETHEUS_DS = {
  type: "prometheus",
  uid: "Prometheus",
};

function createStatPanel(options: {
  title: string;
  query: string;
  legend: string;
  gridPos: { x: number; y: number; w: number; h: number };
  unit?: string;
  thresholds?: { value: number; color: string }[];
}) {
  const panel = new stat.PanelBuilder()
    .title(options.title)
    .datasource(PROMETHEUS_DS)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(options.query)
        .legendFormat(options.legend),
    )
    .unit(options.unit ?? "short")
    .colorMode(common.BigValueColorMode.Value)
    .graphMode(common.BigValueGraphMode.Area)
    .gridPos(options.gridPos);

  if (options.thresholds) {
    panel.thresholds(
      new dashboard.ThresholdsConfigBuilder()
        .mode(dashboard.ThresholdsMode.Absolute)
        .steps(options.thresholds),
    );
  }

  return panel;
}

function createTimeseriesPanel(options: {
  title: string;
  targets: { query: string; legend: string }[];
  gridPos: { x: number; y: number; w: number; h: number };
  unit?: string;
}) {
  const panel = new timeseries.PanelBuilder()
    .title(options.title)
    .datasource(PROMETHEUS_DS)
    .unit(options.unit ?? "short")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos(options.gridPos);

  for (const target of options.targets) {
    panel.withTarget(
      new prometheus.DataqueryBuilder()
        .expr(target.query)
        .legendFormat(target.legend),
    );
  }

  return panel;
}

/**
 * Creates a Grafana dashboard for Buildkite CI resource monitoring.
 *
 * Shows Buildkite agent health, resource sizing accuracy (actual vs requested),
 * and concurrency metrics to help detect wrong-sized jobs.
 */
export function createBuildkiteDashboard() {
  const builder = new dashboard.DashboardBuilder("Buildkite — CI Resources")
    .uid("buildkite-ci-dashboard")
    .tags(["buildkite", "ci", "resources"])
    .time({ from: "now-6h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable();

  // --- Row 1: Agent Health ---
  builder.withRow(new dashboard.RowBuilder("Agent Health"));

  builder.withPanel(
    createStatPanel({
      title: "Available Agents",
      query: `kube_deployment_status_replicas_available{namespace="buildkite", deployment="buildkite-agent-stack-k8s"}`,
      legend: "available",
      gridPos: { x: 0, y: 1, w: 6, h: 4 },
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Pending Pods",
      query: `count(kube_pod_status_phase{namespace="buildkite", phase="Pending"} == 1) or on() vector(0)`,
      legend: "pending",
      gridPos: { x: 6, y: 1, w: 6, h: 4 },
      thresholds: [
        { value: 0, color: "green" },
        { value: 5, color: "yellow" },
        { value: 15, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "CPU Utilization Ratio",
      query: `sum(rate(container_cpu_usage_seconds_total{namespace="buildkite", container!=""}[5m])) / sum(kube_pod_container_resource_requests{namespace="buildkite", resource="cpu"})`,
      legend: "actual/requested",
      gridPos: { x: 12, y: 1, w: 6, h: 4 },
      unit: "percentunit",
      thresholds: [
        { value: 0, color: "green" },
        { value: 0.8, color: "yellow" },
        { value: 0.95, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Memory Utilization Ratio",
      query: `sum(container_memory_working_set_bytes{namespace="buildkite", container!=""}) / sum(kube_pod_container_resource_requests{namespace="buildkite", resource="memory"})`,
      legend: "actual/requested",
      gridPos: { x: 18, y: 1, w: 6, h: 4 },
      unit: "percentunit",
      thresholds: [
        { value: 0, color: "green" },
        { value: 0.8, color: "yellow" },
        { value: 0.95, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "CPU Usage vs Requested",
      targets: [
        {
          query: `sum(rate(container_cpu_usage_seconds_total{namespace="buildkite", container!=""}[5m]))`,
          legend: "actual",
        },
        {
          query: `sum(kube_pod_container_resource_requests{namespace="buildkite", resource="cpu"})`,
          legend: "requested",
        },
      ],
      gridPos: { x: 0, y: 5, w: 12, h: 8 },
      unit: "short",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Running vs Pending Pods",
      targets: [
        {
          query: `count(kube_pod_status_phase{namespace="buildkite", phase="Running"} == 1)`,
          legend: "running",
        },
        {
          query: `count(kube_pod_status_phase{namespace="buildkite", phase="Pending"} == 1) or on() vector(0)`,
          legend: "pending",
        },
      ],
      gridPos: { x: 12, y: 5, w: 12, h: 8 },
    }),
  );

  // --- Row 2: Resource Sizing ---
  builder.withRow(
    new dashboard.RowBuilder("Resource Sizing — Are Jobs Right-Sized?"),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "CPU: Actual Usage vs Requested (per pod)",
      targets: [
        {
          query: `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="buildkite", container!=""}[5m]))`,
          legend: "{{pod}} actual",
        },
        {
          query: `sum by (pod) (kube_pod_container_resource_requests{namespace="buildkite", resource="cpu"})`,
          legend: "{{pod}} requested",
        },
      ],
      gridPos: { x: 0, y: 14, w: 12, h: 8 },
      unit: "short",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Memory: Actual Usage vs Requested (per pod)",
      targets: [
        {
          query: `sum by (pod) (container_memory_working_set_bytes{namespace="buildkite", container!=""})`,
          legend: "{{pod}} actual",
        },
        {
          query: `sum by (pod) (kube_pod_container_resource_requests{namespace="buildkite", resource="memory"})`,
          legend: "{{pod}} requested",
        },
      ],
      gridPos: { x: 12, y: 14, w: 12, h: 8 },
      unit: "bytes",
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Avg CPU Utilization Ratio",
      query: `avg(sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="buildkite", container!=""}[5m])) / sum by (pod) (kube_pod_container_resource_requests{namespace="buildkite", resource="cpu"}))`,
      legend: "actual/requested",
      gridPos: { x: 0, y: 22, w: 8, h: 4 },
      unit: "percentunit",
      thresholds: [
        { value: 0, color: "red" },
        { value: 0.3, color: "yellow" },
        { value: 0.5, color: "green" },
        { value: 1.5, color: "yellow" },
        { value: 2, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Namespace CPU: Total Actual vs Total Requested",
      targets: [
        {
          query: `sum(rate(container_cpu_usage_seconds_total{namespace="buildkite", container!=""}[5m]))`,
          legend: "actual",
        },
        {
          query: `sum(kube_pod_container_resource_requests{namespace="buildkite", resource="cpu"})`,
          legend: "requested",
        },
      ],
      gridPos: { x: 8, y: 22, w: 16, h: 4 },
      unit: "short",
    }),
  );

  // --- Row 3: Concurrency & Throughput ---
  builder.withRow(new dashboard.RowBuilder("Concurrency & Throughput"));

  builder.withPanel(
    createTimeseriesPanel({
      title: "Running Pods",
      targets: [
        {
          query: `count(kube_pod_status_phase{namespace="buildkite", phase="Running"})`,
          legend: "running",
        },
        {
          query: `count(kube_pod_status_phase{namespace="buildkite", phase="Pending"})`,
          legend: "pending",
        },
      ],
      gridPos: { x: 0, y: 27, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Agent Restarts",
      targets: [
        {
          query: `sum by (container) (increase(kube_pod_container_status_restarts_total{namespace="buildkite"}[6h])) or on() vector(0)`,
          legend: "{{container}}",
        },
      ],
      gridPos: { x: 12, y: 27, w: 12, h: 8 },
      unit: "short",
    }),
  );

  return builder.build();
}

/**
 * Exports the dashboard as JSON string for use in ConfigMaps
 */
export function exportBuildkiteDashboardJson(): string {
  const dashboardModel = createBuildkiteDashboard();
  return exportDashboardWithHelmEscaping(dashboardModel);
}
