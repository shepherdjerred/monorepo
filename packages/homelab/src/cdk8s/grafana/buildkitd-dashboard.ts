import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";
import {
  createStatPanel,
  createTimeseriesPanel,
} from "./buildkite-dashboard-panels.ts";

// PromQL-side constants so the chart shows the designed bounds from
// resources/buildkitd.ts: GC keeps 240 GiB of the 300 GiB cache volume, and
// the container memory limit is 32 GiB.
const GC_KEEP_BYTES_EXPR = "vector(240 * 1024 * 1024 * 1024)";
const MEMORY_LIMIT_BYTES_EXPR = "vector(32 * 1024 * 1024 * 1024)";

/**
 * Creates a Grafana dashboard for the shared buildkitd daemon.
 *
 * Every CI image build runs through this single daemon (remote buildx
 * driver), so daemon health, cache-volume fill relative to the GC floor, and
 * memory headroom against the 32Gi limit are the load-bearing signals. Panels
 * stick to metrics guaranteed by the scrape (client_golang + kubelet/cAdvisor)
 * so the dashboard renders even if buildkit's own metric families change.
 */
export function createBuildkitdDashboard() {
  const builder = new dashboard.DashboardBuilder("buildkitd — CI Image Builds")
    .uid("buildkitd-dashboard")
    .tags(["buildkitd", "buildkite", "ci", "docker"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable();

  // --- Row 1: Daemon Health ---
  builder.withRow(new dashboard.RowBuilder("Daemon Health"));

  builder.withPanel(
    createStatPanel({
      title: "Daemon Up",
      description: "Prometheus scrape of the --debugaddr metrics endpoint",
      query: `min(up{namespace="buildkitd"}) or on() vector(0)`,
      legend: "up",
      gridPos: { x: 0, y: 1, w: 6, h: 4 },
      thresholds: [
        { value: 0, color: "red" },
        { value: 1, color: "green" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Restarts (24h)",
      description: "OOM-crash-loop regression guard (cf. PR #1668)",
      query: `sum(increase(kube_pod_container_status_restarts_total{namespace="buildkitd"}[24h])) or on() vector(0)`,
      legend: "restarts",
      gridPos: { x: 6, y: 1, w: 6, h: 4 },
      thresholds: [
        { value: 0, color: "green" },
        { value: 1, color: "yellow" },
        { value: 3, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Cache Fill",
      description: "~80% is the designed GC steady state; >90% alerts",
      query: `kubelet_volume_stats_used_bytes{namespace="buildkitd", persistentvolumeclaim=~"buildkitd-cache.*"} / kubelet_volume_stats_capacity_bytes{namespace="buildkitd", persistentvolumeclaim=~"buildkitd-cache.*"}`,
      legend: "fill",
      gridPos: { x: 12, y: 1, w: 6, h: 4 },
      unit: "percentunit",
      thresholds: [
        { value: 0, color: "green" },
        { value: 0.85, color: "yellow" },
        { value: 0.9, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Goroutines",
      description: "From the buildkitd Go runtime via the new metrics scrape",
      query: `sum(go_goroutines{namespace="buildkitd"})`,
      legend: "goroutines",
      gridPos: { x: 18, y: 1, w: 6, h: 4 },
    }),
  );

  // --- Row 2: Build Cache ---
  builder.withRow(new dashboard.RowBuilder("Build Cache"));

  builder.withPanel(
    createTimeseriesPanel({
      title: "Cache Volume Usage",
      targets: [
        {
          query: `kubelet_volume_stats_used_bytes{namespace="buildkitd", persistentvolumeclaim=~"buildkitd-cache.*"}`,
          legend: "used",
        },
        {
          query: GC_KEEP_BYTES_EXPR,
          legend: "GC floor (240Gi)",
        },
        {
          query: `kubelet_volume_stats_capacity_bytes{namespace="buildkitd", persistentvolumeclaim=~"buildkitd-cache.*"}`,
          legend: "capacity",
        },
      ],
      gridPos: { x: 0, y: 6, w: 24, h: 8 },
      unit: "bytes",
    }),
  );

  // --- Row 3: Daemon Resources ---
  builder.withRow(new dashboard.RowBuilder("Daemon Resources"));

  builder.withPanel(
    createTimeseriesPanel({
      title: "CPU Usage",
      targets: [
        {
          query: `sum(rate(container_cpu_usage_seconds_total{namespace="buildkitd", container!=""}[5m]))`,
          legend: "cores",
        },
      ],
      gridPos: { x: 0, y: 15, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Memory Working Set vs 32Gi Limit",
      targets: [
        {
          query: `sum(container_memory_working_set_bytes{namespace="buildkitd", container!=""})`,
          legend: "working set",
        },
        {
          query: MEMORY_LIMIT_BYTES_EXPR,
          legend: "limit (32Gi)",
        },
      ],
      gridPos: { x: 12, y: 15, w: 12, h: 8 },
      unit: "bytes",
    }),
  );

  return builder.build();
}

/**
 * Exports the dashboard as JSON string for use in ConfigMaps
 */
export function exportBuildkitdDashboardJson(): string {
  const dashboardModel = createBuildkitdDashboard();
  return exportDashboardWithHelmEscaping(dashboardModel);
}
