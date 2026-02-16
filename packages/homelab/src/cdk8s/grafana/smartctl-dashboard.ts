import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

/**
 * Creates a Grafana dashboard for SMART monitoring
 * Tracks device health, temperature, sector errors, and lifecycle metrics
 */
export function createSmartctlDashboard() {
  // Create Prometheus datasource reference
  const prometheusDatasource = {
    type: "prometheus",
    uid: "Prometheus",
  };

  // Create device variable for filtering
  const deviceVariable = new dashboard.QueryVariableBuilder("device")
    .label("Device")
    .query("label_values(smartmon_device_smart_healthy, disk)")
    .datasource(prometheusDatasource)
    .multi(true)
    .includeAll(true)
    .allValue(".*");

  // Create instance variable for filtering by node
  // Use a query that will work even if metrics don't have instance label yet
  const instanceVariable = new dashboard.QueryVariableBuilder("instance")
    .label("Instance")
    .query('label_values({__name__=~"smartmon_.*"}, instance)')
    .datasource(prometheusDatasource)
    .multi(true)
    .includeAll(true)
    .allValue(".*");

  // Helper function to build filter expression
  // Note: instance label may not always be present on textfile collector metrics
  const buildFilter = () => {
    // Only include instance filter if it's not "All" (.*)
    // This makes queries work even if instance label is missing
    return 'disk=~"$device"';
  };

  // Build the main dashboard
  const builder = new dashboard.DashboardBuilder("SMART Monitoring - Device Health")
    .uid("smartctl-dashboard")
    .tags(["smartctl", "hardware", "storage", "monitoring"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable()
    .withVariable(deviceVariable)
    .withVariable(instanceVariable);

  // Row 1: Overview Stats
  builder.withRow(new dashboard.RowBuilder("Overview"));

  // Total Devices
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Total Devices")
      .description("Number of monitored devices")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`count(smartmon_device_smart_healthy{${buildFilter()}})`)
          .legendFormat("Total"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.None)
      .gridPos({ x: 0, y: 1, w: 4, h: 4 }),
  );

  // Healthy Devices
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Healthy Devices")
      .description("Devices passing SMART health check")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`count(smartmon_device_smart_healthy{${buildFilter()}} == 1)`)
          .legendFormat("Healthy"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.None)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "red" },
          { value: 1, color: "green" },
        ]),
      )
      .gridPos({ x: 4, y: 1, w: 4, h: 4 }),
  );

  // Unhealthy Devices
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Unhealthy Devices")
      .description("Devices failing SMART health check. 0 means no failing devices detected.")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`count(smartmon_device_smart_healthy{${buildFilter()}} == 0) or vector(0)`)
          .legendFormat("Unhealthy"),
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
      .gridPos({ x: 8, y: 1, w: 4, h: 4 }),
  );

  // Health Ratio
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Health Ratio")
      .description("Percentage of healthy devices")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `(count(smartmon_device_smart_healthy{${buildFilter()}} == 1) / count(smartmon_device_smart_healthy{${buildFilter()}})) * 100`,
          )
          .legendFormat("Health Ratio"),
      )
      .unit("percent")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "red" },
          { value: 50, color: "yellow" },
          { value: 100, color: "green" },
        ]),
      )
      .gridPos({ x: 12, y: 1, w: 4, h: 4 }),
  );

  // Devices with Reallocated Sectors
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Devices with Reallocated Sectors")
      .description("Count of devices with sector reallocation. 0 means no issues detected.")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`count(smartmon_reallocated_sector_ct_raw_value{${buildFilter()}} > 0) or vector(0)`)
          .legendFormat("With Reallocated"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.None)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1, color: "yellow" },
          { value: 2, color: "red" },
        ]),
      )
      .gridPos({ x: 16, y: 1, w: 4, h: 4 }),
  );

  // Devices with Pending Sectors
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Devices with Pending Sectors")
      .description("Count of devices with pending sector reallocation. 0 means no issues detected.")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`count(smartmon_current_pending_sector_raw_value{${buildFilter()}} > 0) or vector(0)`)
          .legendFormat("With Pending"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.None)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1, color: "yellow" },
          { value: 2, color: "red" },
        ]),
      )
      .gridPos({ x: 20, y: 1, w: 4, h: 4 }),
  );

  // Row 2: Temperature Monitoring
  builder.withRow(new dashboard.RowBuilder("Temperature Monitoring"));

  // Current Temperature by Device
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Temperature by Device")
      .description("Current temperature for each device")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`smartmon_temperature_celsius_value{${buildFilter()}}`)
          // Use a static legend here to avoid complex templating that breaks Helm linting
          // (the dynamic disk/model legend is nice-to-have but not essential)
          .legendFormat("{{disk}}"),
      )
      .unit("celsius")
      .decimals(1)
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "blue" },
          { value: 40, color: "green" },
          { value: 60, color: "yellow" },
          { value: 70, color: "red" },
        ]),
      )
      .gridPos({ x: 0, y: 5, w: 12, h: 8 }),
  );

  // Max Temperature
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Max Temperature")
      .description("Highest temperature across all devices")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`max(smartmon_temperature_celsius_value{${buildFilter()}})`)
          .legendFormat("Max Temp"),
      )
      .unit("celsius")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "blue" },
          { value: 40, color: "green" },
          { value: 60, color: "yellow" },
          { value: 70, color: "red" },
        ]),
      )
      .gridPos({ x: 12, y: 5, w: 6, h: 4 }),
  );

  // Average Temperature
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Average Temperature")
      .description("Average temperature across all devices")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`avg(smartmon_temperature_celsius_value{${buildFilter()}})`)
          .legendFormat("Avg Temp"),
      )
      .unit("celsius")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "blue" },
          { value: 40, color: "green" },
          { value: 60, color: "yellow" },
          { value: 70, color: "red" },
        ]),
      )
      .gridPos({ x: 18, y: 5, w: 6, h: 4 }),
  );

  // Temperature Distribution
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Temperature Distribution")
      .description("Min, Avg, Max temperature over time")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`min(smartmon_temperature_celsius_value{${buildFilter()}})`)
          .legendFormat("Min"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`avg(smartmon_temperature_celsius_value{${buildFilter()}})`)
          .legendFormat("Avg"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`max(smartmon_temperature_celsius_value{${buildFilter()}})`)
          .legendFormat("Max"),
      )
      .unit("celsius")
      .decimals(1)
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 9, w: 12, h: 4 }),
  );

  // Row 3: Sector Health
  builder.withRow(new dashboard.RowBuilder("Sector Health"));

  // Reallocated Sectors
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Reallocated Sectors")
      .description("Number of reallocated sectors per device")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `smartmon_reallocated_sector_ct_raw_value{${buildFilter()}} * on(disk) group_left(device_model) smartmon_device_info{${buildFilter()}}`,
          )
          .legendFormat("{{disk}} - {{device_model}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1, color: "yellow" },
          { value: 10, color: "red" },
        ]),
      )
      .gridPos({ x: 0, y: 13, w: 8, h: 8 }),
  );

  // Pending Sectors
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Pending Sectors")
      .description("Number of pending sectors waiting for reallocation")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `smartmon_current_pending_sector_raw_value{${buildFilter()}} * on(disk) group_left(device_model) smartmon_device_info{${buildFilter()}}`,
          )
          .legendFormat("{{disk}} - {{device_model}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1, color: "yellow" },
          { value: 5, color: "red" },
        ]),
      )
      .gridPos({ x: 8, y: 13, w: 8, h: 8 }),
  );

  // Uncorrectable Errors
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Uncorrectable Errors")
      .description("Number of uncorrectable errors per device")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `smartmon_offline_uncorrectable_raw_value{${buildFilter()}} * on(disk) group_left(device_model) smartmon_device_info{${buildFilter()}}`,
          )
          .legendFormat("{{disk}} - {{device_model}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1, color: "red" },
        ]),
      )
      .gridPos({ x: 16, y: 13, w: 8, h: 8 }),
  );

  // Row 4: Error Tracking
  builder.withRow(new dashboard.RowBuilder("Error Tracking"));

  // UDMA CRC Errors
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("UDMA CRC Errors")
      .description("UDMA CRC error count (indicates cable/interface issues)")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `smartmon_udma_crc_error_count_raw_value{${buildFilter()}} * on(disk) group_left(device_model) smartmon_device_info{${buildFilter()}}`,
          )
          .legendFormat("{{disk}} - {{device_model}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1, color: "yellow" },
        ]),
      )
      .gridPos({ x: 0, y: 21, w: 12, h: 8 }),
  );

  // Raw Read Error Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Raw Read Error Rate")
      .description("Raw read error rate per device")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `smartmon_raw_read_error_rate_raw_value{${buildFilter()}} * on(disk) group_left(device_model) smartmon_device_info{${buildFilter()}}`,
          )
          .legendFormat("{{disk}} - {{device_model}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 21, w: 12, h: 8 }),
  );

  // Row 5: Device Lifecycle
  builder.withRow(new dashboard.RowBuilder("Device Lifecycle"));

  // Power On Hours
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Power On Hours")
      .description("Total power-on hours per device")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `smartmon_power_on_hours_raw_value{${buildFilter()}} * on(disk) group_left(device_model) smartmon_device_info{${buildFilter()}}`,
          )
          .legendFormat("{{disk}} - {{device_model}}"),
      )
      .unit("h")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 29, w: 12, h: 8 }),
  );

  // Power Cycle Count
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Power Cycle Count")
      .description("Number of power cycles per device")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `smartmon_power_cycle_count_raw_value{${buildFilter()}} * on(disk) group_left(device_model) smartmon_device_info{${buildFilter()}}`,
          )
          .legendFormat("{{disk}} - {{device_model}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 10000, color: "yellow" },
        ]),
      )
      .gridPos({ x: 12, y: 29, w: 12, h: 8 }),
  );

  return builder.build();
}

/**
 * Exports the dashboard as JSON string for use in ConfigMaps or API calls
 */
export function exportSmartctlDashboardJson(): string {
  const dashboard = createSmartctlDashboard();
  return exportDashboardWithHelmEscaping(dashboard);
}
