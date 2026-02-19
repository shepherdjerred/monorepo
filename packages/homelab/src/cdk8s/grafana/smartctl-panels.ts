import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";

type Datasource = { type: string; uid: string };

/**
 * Add error tracking panels (UDMA CRC errors, raw read error rate)
 */
export function addErrorTrackingPanels(
  builder: dashboard.DashboardBuilder,
  ds: Datasource,
  buildFilter: () => string,
): void {
  builder.withRow(new dashboard.RowBuilder("Error Tracking"));

  // UDMA CRC Errors
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("UDMA CRC Errors")
      .description("UDMA CRC error count (indicates cable/interface issues)")
      .datasource(ds)
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
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
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
      .datasource(ds)
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
}

/**
 * Add device lifecycle panels (power on hours, power cycle count)
 */
export function addLifecyclePanels(
  builder: dashboard.DashboardBuilder,
  ds: Datasource,
  buildFilter: () => string,
): void {
  builder.withRow(new dashboard.RowBuilder("Device Lifecycle"));

  // Power On Hours
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Power On Hours")
      .description("Total power-on hours per device")
      .datasource(ds)
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
      .datasource(ds)
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
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 10_000, color: "yellow" },
          ]),
      )
      .gridPos({ x: 12, y: 29, w: 12, h: 8 }),
  );
}

/**
 * Add sector health panels (reallocated, pending, uncorrectable)
 */
export function addSectorHealthPanels(
  builder: dashboard.DashboardBuilder,
  ds: Datasource,
  buildFilter: () => string,
): void {
  builder.withRow(new dashboard.RowBuilder("Sector Health"));

  // Reallocated Sectors
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Reallocated Sectors")
      .description("Number of reallocated sectors per device")
      .datasource(ds)
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
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
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
      .datasource(ds)
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
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
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
      .datasource(ds)
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
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 1, color: "red" },
          ]),
      )
      .gridPos({ x: 16, y: 13, w: 8, h: 8 }),
  );
}
