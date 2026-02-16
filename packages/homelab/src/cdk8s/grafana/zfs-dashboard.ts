import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

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

  // Helper function to build filter expression
  const buildFilter = () => {
    return 'instance=~"$instance"';
  };

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
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
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
      .withTarget(new prometheus.DataqueryBuilder().expr(`node_zfs_arc_c{${buildFilter()}}`).legendFormat("Current"))
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_arc_c_max{${buildFilter()}}`).legendFormat("Maximum"),
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
          .expr(`(node_zfs_arc_c{${buildFilter()}} / node_zfs_arc_c_max{${buildFilter()}}) * 100`)
          .legendFormat("{{instance}}"),
      )
      .unit("percent")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
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
          .expr(`(node_zfs_arc_arc_meta_used{${buildFilter()}} / node_zfs_arc_c{${buildFilter()}}) * 100`)
          .legendFormat("{{instance}}"),
      )
      .unit("percent")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
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
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
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
      .withTarget(new prometheus.DataqueryBuilder().expr(`node_zfs_arc_c{${buildFilter()}}`).legendFormat("Current"))
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_arc_c_max{${buildFilter()}}`).legendFormat("Maximum"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_arc_c_min{${buildFilter()}}`).legendFormat("Minimum"),
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
        new prometheus.DataqueryBuilder().expr(`rate(node_zfs_arc_hits{${buildFilter()}}[5m])`).legendFormat("Hits"),
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
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1000, color: "yellow" },
          { value: 5000, color: "red" },
        ]),
      )
      .gridPos({ x: 12, y: 13, w: 12, h: 8 }),
  );

  // Row 3: L2ARC Monitoring
  builder.withRow(new dashboard.RowBuilder("L2ARC Monitoring"));

  // L2ARC Hit Rate
  builder.withPanel(
    new stat.PanelBuilder()
      .title("L2ARC Hit Rate")
      .description("L2ARC hit rate percentage (should be >20%)")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `(rate(node_zfs_arc_l2_hits{${buildFilter()}}[5m]) / (rate(node_zfs_arc_l2_hits{${buildFilter()}}[5m]) + rate(node_zfs_arc_l2_misses{${buildFilter()}}[5m]))) * 100`,
          )
          .legendFormat("{{instance}}"),
      )
      .unit("percent")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "yellow" },
          { value: 20, color: "green" },
        ]),
      )
      .gridPos({ x: 0, y: 21, w: 6, h: 4 }),
  );

  // L2ARC Size
  builder.withPanel(
    new stat.PanelBuilder()
      .title("L2ARC Size")
      .description("Current L2ARC size")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_arc_l2_size{${buildFilter()}}`).legendFormat("{{instance}}"),
      )
      .unit("bytes")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 6, y: 21, w: 6, h: 4 }),
  );

  // L2ARC Errors
  builder.withPanel(
    new stat.PanelBuilder()
      .title("L2ARC Errors")
      .description("L2ARC IO, write, and checksum errors")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`increase(node_zfs_arc_l2_io_error{${buildFilter()}}[1h])`)
          .legendFormat("IO Errors"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`increase(node_zfs_arc_l2_writes_error{${buildFilter()}}[1h])`)
          .legendFormat("Write Errors"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`increase(node_zfs_arc_l2_cksum_bad{${buildFilter()}}[1h])`)
          .legendFormat("Checksum Errors"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1, color: "red" },
        ]),
      )
      .gridPos({ x: 12, y: 21, w: 6, h: 4 }),
  );

  // L2ARC Rebuild Status
  builder.withPanel(
    new stat.PanelBuilder()
      .title("L2ARC Rebuild Status")
      .description("L2ARC rebuild errors")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `increase(node_zfs_arc_l2_rebuild_io_errors{${buildFilter()}}[1h]) + increase(node_zfs_arc_l2_rebuild_cksum_lb_errors{${buildFilter()}}[1h]) + increase(node_zfs_arc_l2_rebuild_dh_errors{${buildFilter()}}[1h])`,
          )
          .legendFormat("Rebuild Errors"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.None)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1, color: "red" },
        ]),
      )
      .gridPos({ x: 18, y: 21, w: 6, h: 4 }),
  );

  // L2ARC Hit Rate Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("L2ARC Hit Rate Over Time")
      .description("L2ARC hit rate percentage")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `(rate(node_zfs_arc_l2_hits{${buildFilter()}}[5m]) / (rate(node_zfs_arc_l2_hits{${buildFilter()}}[5m]) + rate(node_zfs_arc_l2_misses{${buildFilter()}}[5m]))) * 100`,
          )
          .legendFormat("Hit Rate"),
      )
      .unit("percent")
      .decimals(1)
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 25, w: 12, h: 8 }),
  );

  // L2ARC Size Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("L2ARC Size Over Time")
      .description("L2ARC size and read/write activity")
      .datasource(prometheusDatasource)
      .withTarget(new prometheus.DataqueryBuilder().expr(`node_zfs_arc_l2_size{${buildFilter()}}`).legendFormat("Size"))
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_l2_read_bytes{${buildFilter()}}[5m])`)
          .legendFormat("Read Bytes/s"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_l2_write_bytes{${buildFilter()}}[5m])`)
          .legendFormat("Write Bytes/s"),
      )
      .unit("bytes")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 25, w: 12, h: 8 }),
  );

  // Row 4: Memory and Resource Monitoring
  builder.withRow(new dashboard.RowBuilder("Memory and Resource Monitoring"));

  // System Free Memory
  builder.withPanel(
    new stat.PanelBuilder()
      .title("System Free Memory")
      .description("ZFS reported system free memory")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_arc_sys_free{${buildFilter()}}`)
          .legendFormat("{{instance}}"),
      )
      .unit("bytes")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 268435456, color: "red" }, // 256MB
          { value: 536870912, color: "yellow" }, // 512MB
          { value: 1073741824, color: "green" }, // 1GB
        ]),
      )
      .gridPos({ x: 0, y: 33, w: 6, h: 4 }),
  );

  // Memory Throttle Count
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Memory Throttle Count")
      .description("Rate of memory throttling")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_memory_throttle_count{${buildFilter()}}[5m])`)
          .legendFormat("{{instance}}"),
      )
      .unit("ops")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 10, color: "yellow" },
          { value: 50, color: "red" },
        ]),
      )
      .gridPos({ x: 6, y: 33, w: 6, h: 4 }),
  );

  // Memory Need Free
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Memory Need Free")
      .description("ZFS memory reclaim pressure indicator")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_arc_need_free{${buildFilter()}}`)
          .legendFormat("{{instance}}"),
      )
      .unit("bytes")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1, color: "yellow" },
        ]),
      )
      .gridPos({ x: 12, y: 33, w: 6, h: 4 }),
  );

  // ABD Page Allocation Retries
  builder.withPanel(
    new stat.PanelBuilder()
      .title("ABD Page Allocation Retries")
      .description("Rate of ABD page allocation retries")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_abd_scatter_page_alloc_retry{${buildFilter()}}[5m])`)
          .legendFormat("{{instance}}"),
      )
      .unit("ops")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 50, color: "yellow" },
          { value: 100, color: "red" },
        ]),
      )
      .gridPos({ x: 18, y: 33, w: 6, h: 4 }),
  );

  // Memory Metrics Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Memory Metrics Over Time")
      .description("System free memory and memory pressure indicators")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_arc_sys_free{${buildFilter()}}`)
          .legendFormat("System Free"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_arc_need_free{${buildFilter()}}`)
          .legendFormat("Need Free"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_memory_throttle_count{${buildFilter()}}[5m])`)
          .legendFormat("Throttle Rate"),
      )
      .unit("bytes")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 37, w: 12, h: 8 }),
  );

  // ABD Metrics Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ABD Metrics Over Time")
      .description("ABD allocation metrics")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_abd_scatter_page_alloc_retry{${buildFilter()}}[5m])`)
          .legendFormat("Page Alloc Retries"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_abd_scatter_sg_table_retry{${buildFilter()}}[5m])`)
          .legendFormat("SG Table Retries"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 37, w: 12, h: 8 }),
  );

  // Row 5: Performance Metrics
  builder.withRow(new dashboard.RowBuilder("Performance Metrics"));

  // Hash Collisions
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Hash Collisions")
      .description("Rate of hash collisions")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_hash_collisions{${buildFilter()}}[5m])`)
          .legendFormat("Collisions/s"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1000, color: "yellow" },
          { value: 5000, color: "red" },
        ]),
      )
      .gridPos({ x: 0, y: 45, w: 12, h: 8 }),
  );

  // Hash Chain Length
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Hash Chain Max Length")
      .description("Maximum hash chain length")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_hash_chain_max{${buildFilter()}}`)
          .legendFormat("Max Chain Length"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 20, color: "yellow" },
          { value: 50, color: "red" },
        ]),
      )
      .gridPos({ x: 12, y: 45, w: 12, h: 8 }),
  );

  // Eviction Skips
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Eviction Skips")
      .description("Rate of eviction skips (lock contention indicator)")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_evict_skip{${buildFilter()}}[5m])`)
          .legendFormat("Evict Skips/s"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 100, color: "yellow" },
          { value: 500, color: "red" },
        ]),
      )
      .gridPos({ x: 0, y: 53, w: 12, h: 8 }),
  );

  // Access Skips
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Access Skips")
      .description("Rate of access skips (lock contention indicator)")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_access_skip{${buildFilter()}}[5m])`)
          .legendFormat("Access Skips/s"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 100, color: "yellow" },
          { value: 500, color: "red" },
        ]),
      )
      .gridPos({ x: 12, y: 53, w: 12, h: 8 }),
  );

  // Row 6: Buffer and Cache Monitoring
  builder.withRow(new dashboard.RowBuilder("Buffer and Cache Monitoring"));

  // DNode Size
  builder.withPanel(
    new stat.PanelBuilder()
      .title("DNode Size")
      .description("ZFS dnode buffer size")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_dnode_size{${buildFilter()}}`)
          .legendFormat("{{instance}}"),
      )
      .unit("bytes")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1073741824, color: "yellow" }, // 1GB
          { value: 2147483648, color: "red" }, // 2GB
        ]),
      )
      .gridPos({ x: 0, y: 61, w: 6, h: 4 }),
  );

  // DBuf Size
  builder.withPanel(
    new stat.PanelBuilder()
      .title("DBuf Size")
      .description("ZFS data buffer size")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_arc_dbuf_size{${buildFilter()}}`).legendFormat("{{instance}}"),
      )
      .unit("bytes")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 2147483648, color: "yellow" }, // 2GB
          { value: 4294967296, color: "red" }, // 4GB
        ]),
      )
      .gridPos({ x: 6, y: 61, w: 6, h: 4 }),
  );

  // Bonus Size
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Bonus Size")
      .description("ZFS bonus buffer size")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_bonus_size{${buildFilter()}}`)
          .legendFormat("{{instance}}"),
      )
      .unit("bytes")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 12, y: 61, w: 6, h: 4 }),
  );

  // ABD Linear vs Scatter
  builder.withPanel(
    new stat.PanelBuilder()
      .title("ABD Linear vs Scatter")
      .description("ABD allocation type distribution")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_abd_linear_cnt{${buildFilter()}}`).legendFormat("Linear"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_abd_scatter_cnt{${buildFilter()}}`).legendFormat("Scatter"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 18, y: 61, w: 6, h: 4 }),
  );

  // Buffer Sizes Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Buffer Sizes Over Time")
      .description("DNode, DBuf, and Bonus buffer sizes")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_arc_dnode_size{${buildFilter()}}`).legendFormat("DNode"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_arc_dbuf_size{${buildFilter()}}`).legendFormat("DBuf"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_arc_bonus_size{${buildFilter()}}`).legendFormat("Bonus"),
      )
      .unit("bytes")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 65, w: 12, h: 8 }),
  );

  // ABD Metrics Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ABD Allocation Over Time")
      .description("ABD linear vs scatter counts")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_abd_linear_cnt{${buildFilter()}}`)
          .legendFormat("Linear Count"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_abd_scatter_cnt{${buildFilter()}}`)
          .legendFormat("Scatter Count"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 65, w: 12, h: 8 }),
  );

  // Row 7: Advanced Metrics
  builder.withRow(new dashboard.RowBuilder("Advanced Metrics"));

  // ARC MRU/MFU Distribution
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ARC MRU/MFU Distribution")
      .description("Most Recently Used vs Most Frequently Used sizes")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_arc_mru_size{${buildFilter()}}`).legendFormat("MRU Size"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder().expr(`node_zfs_arc_mfu_size{${buildFilter()}}`).legendFormat("MFU Size"),
      )
      .unit("bytes")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 73, w: 12, h: 8 }),
  );

  // ARC Ghost Cache
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ARC Ghost Cache")
      .description("Ghost cache sizes (evicted but tracked)")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_mru_ghost_size{${buildFilter()}}`)
          .legendFormat("MRU Ghost"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_mfu_ghost_size{${buildFilter()}}`)
          .legendFormat("MFU Ghost"),
      )
      .unit("bytes")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 73, w: 12, h: 8 }),
  );

  // L2ARC Lock Retries
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("L2ARC Lock Retries")
      .description("L2ARC write and evict lock retries")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_l2_writes_lock_retry{${buildFilter()}}[5m])`)
          .legendFormat("Write Lock Retries"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_l2_evict_lock_retry{${buildFilter()}}[5m])`)
          .legendFormat("Evict Lock Retries"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 10, color: "yellow" },
          { value: 50, color: "red" },
        ]),
      )
      .gridPos({ x: 0, y: 81, w: 12, h: 8 }),
  );

  // ARC Prune Activity
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ARC Prune Activity")
      .description("ARC pruning and async upgrade sync operations")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_arc_prune{${buildFilter()}}[5m])`)
          .legendFormat("Prune Rate"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`rate(node_zfs_arc_async_upgrade_sync{${buildFilter()}}[5m])`)
          .legendFormat("Async Upgrade Sync"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 81, w: 12, h: 8 }),
  );

  return builder.build();
}

/**
 * Exports the dashboard as JSON string for use in ConfigMaps or API calls
 */
export function exportZfsDashboardJson(): string {
  const dashboard = createZfsDashboard();
  return exportDashboardWithHelmEscaping(dashboard);
}
