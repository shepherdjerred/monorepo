import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";
import {
  addL2arcPanels,
  addMemoryPanels,
  addBufferAndAdvancedPanels,
} from "./zfs-dashboard-panels.ts";
import { addPerformancePanels } from "./zfs-dashboard-performance-panels.ts";
import { addAdvancedMetricsPanels } from "./zfs-dashboard-advanced-panels.ts";

// Helper function to build filter expression
function buildFilter() {
  return 'instance=~"$instance"';
}

// TODO: grafana is not creating this one

/**
 * Creates a Grafana dashboard for ZFS monitoring
 * Tracks ARC, L2ARC, memory, performance, and health metrics
 */
export function createZfsDashboard() {
  // Create Prometheus datasource reference
  const prometheusDatasource = {
    type: "prometheus",
    uid: "Prometheus",
  };

  // Create instance variable for filtering
  const instanceVariable = new dashboard.QueryVariableBuilder("instance")
    .label("Instance")
    .query("label_values(node_zfs_arc_hits, instance)")
    .datasource(prometheusDatasource)
    .multi(true)
    .includeAll(true)
    .allValue(".*");

  // Build the main dashboard
  const builder = new dashboard.DashboardBuilder("ZFS - Storage Monitoring")
    .uid("zfs-dashboard")
    .tags(["zfs", "storage", "arc", "l2arc", "performance"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable()
    .withVariable(instanceVariable);

  // Row 1: ARC Overview
  builder.withRow(new dashboard.RowBuilder("ARC Overview"));

  // ARC Hit Rate
  builder.withPanel(
    new stat.PanelBuilder()
      .title("ARC Hit Rate")
      .description("Percentage of ARC hits vs misses (should be >85%)")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `(rate(node_zfs_arc_hits{${buildFilter()}}[5m]) / (rate(node_zfs_arc_hits{${buildFilter()}}[5m]) + rate(node_zfs_arc_demand_data_misses{${buildFilter()}}[5m]) + rate(node_zfs_arc_demand_metadata_misses{${buildFilter()}}[5m]))) * 100`,
          )
          .legendFormat("{{instance}}"),
      )
      .unit("percent")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "red" },
            { value: 70, color: "yellow" },
            { value: 85, color: "green" },
          ]),
      )
      .gridPos({ x: 0, y: 1, w: 6, h: 4 }),
  );

  // ARC Size
  builder.withPanel(
    new stat.PanelBuilder()
      .title("ARC Size")
      .description("Current ARC size vs maximum")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_c{${buildFilter()}}`)
          .legendFormat("Current"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_c_max{${buildFilter()}}`)
          .legendFormat("Maximum"),
      )
      .unit("bytes")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 6, y: 1, w: 6, h: 4 }),
  );

  // ARC Size Percentage
  builder.withPanel(
    new stat.PanelBuilder()
      .title("ARC Size % of Max")
      .description("ARC size as percentage of maximum")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `(node_zfs_arc_c{${buildFilter()}} / node_zfs_arc_c_max{${buildFilter()}}) * 100`,
          )
          .legendFormat("{{instance}}"),
      )
      .unit("percent")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 95, color: "yellow" },
            { value: 100, color: "red" },
          ]),
      )
      .gridPos({ x: 12, y: 1, w: 6, h: 4 }),
  );

  // ARC Metadata Usage
  builder.withPanel(
    new stat.PanelBuilder()
      .title("ARC Metadata Usage")
      .description("Metadata usage as percentage of ARC")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `(node_zfs_arc_arc_meta_used{${buildFilter()}} / node_zfs_arc_c{${buildFilter()}}) * 100`,
          )
          .legendFormat("{{instance}}"),
      )
      .unit("percent")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 75, color: "yellow" },
            { value: 100, color: "red" },
          ]),
      )
      .gridPos({ x: 18, y: 1, w: 6, h: 4 }),
  );

  // Row 2: ARC Performance
  builder.withRow(new dashboard.RowBuilder("ARC Performance"));

  // ARC Hit Rate Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ARC Hit Rate Over Time")
      .description("ARC hit rate percentage")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `(rate(node_zfs_arc_hits{${buildFilter()}}[5m]) / (rate(node_zfs_arc_hits{${buildFilter()}}[5m]) + rate(node_zfs_arc_demand_data_misses{${buildFilter()}}[5m]) + rate(node_zfs_arc_demand_metadata_misses{${buildFilter()}}[5m]))) * 100`,
          )
          .legendFormat("Hit Rate"),
      )
      .unit("percent")
      .decimals(1)
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "red" },
            { value: 70, color: "yellow" },
            { value: 85, color: "green" },
          ]),
      )
      .gridPos({ x: 0, y: 5, w: 12, h: 8 }),
  );

  // ARC Size Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ARC Size Over Time")
      .description("ARC size vs maximum")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_c{${buildFilter()}}`)
          .legendFormat("Current"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_c_max{${buildFilter()}}`)
          .legendFormat("Maximum"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_c_min{${buildFilter()}}`)
          .legendFormat("Minimum"),
      )
      .unit("bytes")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 5, w: 12, h: 8 }),
  );

  // ARC Hits and Misses Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ARC Hits and Misses Rate")
      .description("Rate of ARC hits and misses")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_hits{${buildFilter()}}[5m])`)
          .legendFormat("Hits"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `rate(node_zfs_arc_demand_data_misses{${buildFilter()}}[5m]) + rate(node_zfs_arc_demand_metadata_misses{${buildFilter()}}[5m])`,
          )
          .legendFormat("Misses"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 13, w: 12, h: 8 }),
  );

  // ARC Eviction Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ARC Eviction Rate")
      .description("Rate of ARC evictions")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_deleted{${buildFilter()}}[5m])`)
          .legendFormat("Evictions/s"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 1000, color: "yellow" },
            { value: 5000, color: "red" },
          ]),
      )
      .gridPos({ x: 12, y: 13, w: 12, h: 8 }),
  );

  // Rows 3-7: L2ARC, Memory, Performance, Buffer, and Advanced panels
  addL2arcPanels(builder, prometheusDatasource, buildFilter);
  addMemoryPanels(builder, prometheusDatasource, buildFilter);
  addPerformancePanels(builder, prometheusDatasource, buildFilter);
  addBufferAndAdvancedPanels(builder, prometheusDatasource, buildFilter);
  addAdvancedMetricsPanels(builder, prometheusDatasource, buildFilter);

  return builder.build();
}

/**
 * Exports the dashboard as JSON string for use in ConfigMaps or API calls
 */
export function exportZfsDashboardJson(): string {
  const dashboardModel = createZfsDashboard();
  return exportDashboardWithHelmEscaping(dashboardModel);
}
