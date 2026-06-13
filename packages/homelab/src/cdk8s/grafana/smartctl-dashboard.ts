import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";
import {
  addErrorTrackingPanels,
  addLifecyclePanels,
  addSectorHealthPanels,
} from "./smartctl-panels.ts";

// smartmon_* metrics are keyed by the unstable `disk` path (/dev/nvme0, /dev/sda),
// which can change across reboots / controller re-enumeration. The stable
// serial_number + device_model live only on smartmon_device_info, so join it in
// via group_left and filter/group on serial_number. The join is per-scrape, so
// the result always tracks the physical drive even when device paths swap.
// smartmon_device_info has value 1, leaving the original metric value intact.
const SERIAL_INFO = 'smartmon_device_info{serial_number=~"$serial"}';
function bySerial(metric: string): string {
  return `${metric} * on(disk) group_left(serial_number, device_model) ${SERIAL_INFO}`;
}

// Legend that names the physical drive rather than its (unstable) /dev path.
const DRIVE_LEGEND = "{{device_model}} {{serial_number}}";

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

  // Filter by stable serial number (survives /dev-path re-enumeration across reboots).
  const serialVariable = new dashboard.QueryVariableBuilder("serial")
    .label("Drive")
    .query("label_values(smartmon_device_info, serial_number)")
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

  // Build the main dashboard
  const builder = new dashboard.DashboardBuilder(
    "SMART Monitoring - Device Health",
  )
    .uid("smartctl-dashboard")
    .tags(["smartctl", "hardware", "storage", "monitoring"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable()
    .withVariable(serialVariable)
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
          .expr(`count(${bySerial("smartmon_device_smart_healthy")})`)
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
          .expr(`count(${bySerial("smartmon_device_smart_healthy")} == 1)`)
          .legendFormat("Healthy"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.None)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
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
      .description(
        "Devices failing SMART health check. 0 means no failing devices detected.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `count(${bySerial("smartmon_device_smart_healthy")} == 0) or vector(0)`,
          )
          .legendFormat("Unhealthy"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.None)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
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
            `(count(${bySerial("smartmon_device_smart_healthy")} == 1) / count(${bySerial("smartmon_device_smart_healthy")})) * 100`,
          )
          .legendFormat("Health Ratio"),
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
      .description(
        "Count of devices with sector reallocation. 0 means no issues detected.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `count(${bySerial("smartmon_reallocated_sector_ct_raw_value")} > 0) or vector(0)`,
          )
          .legendFormat("With Reallocated"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.None)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
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
      .description(
        "Count of devices with pending sector reallocation. 0 means no issues detected.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `count(${bySerial("smartmon_current_pending_sector_raw_value")} > 0) or vector(0)`,
          )
          .legendFormat("With Pending"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.None)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
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
          .expr(bySerial("smartmon_temperature_celsius_value"))
          .legendFormat(DRIVE_LEGEND),
      )
      .unit("celsius")
      .decimals(1)
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
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
          .expr(`max(${bySerial("smartmon_temperature_celsius_value")})`)
          .legendFormat("Max Temp"),
      )
      .unit("celsius")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
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
          .expr(`avg(${bySerial("smartmon_temperature_celsius_value")})`)
          .legendFormat("Avg Temp"),
      )
      .unit("celsius")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
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
          .expr(`min(${bySerial("smartmon_temperature_celsius_value")})`)
          .legendFormat("Min"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`avg(${bySerial("smartmon_temperature_celsius_value")})`)
          .legendFormat("Avg"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`max(${bySerial("smartmon_temperature_celsius_value")})`)
          .legendFormat("Max"),
      )
      .unit("celsius")
      .decimals(1)
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 9, w: 12, h: 4 }),
  );

  // Sector health, error tracking, and lifecycle panels
  addSectorHealthPanels(builder, prometheusDatasource, bySerial);
  addErrorTrackingPanels(builder, prometheusDatasource, bySerial);
  addLifecyclePanels(builder, prometheusDatasource, bySerial);

  return builder.build();
}

/**
 * Exports the dashboard as JSON string for use in ConfigMaps or API calls
 */
export function exportSmartctlDashboardJson(): string {
  const dashboardModel = createSmartctlDashboard();
  return exportDashboardWithHelmEscaping(dashboardModel);
}
