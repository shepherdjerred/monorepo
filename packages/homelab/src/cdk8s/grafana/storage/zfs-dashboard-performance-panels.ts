import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";

type Datasource = { type: string; uid: string };
type BuildFilter = () => string;

export function addPerformancePanels(
  builder: dashboard.DashboardBuilder,
  prometheusDatasource: Datasource,
  buildFilter: BuildFilter,
): void {
  builder.withRow(new dashboard.RowBuilder("Performance Metrics"));

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
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 1000, color: "yellow" },
            { value: 5000, color: "red" },
          ]),
      )
      .gridPos({ x: 0, y: 45, w: 12, h: 8 }),
  );

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
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 20, color: "yellow" },
            { value: 50, color: "red" },
          ]),
      )
      .gridPos({ x: 12, y: 45, w: 12, h: 8 }),
  );

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
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 100, color: "yellow" },
            { value: 500, color: "red" },
          ]),
      )
      .gridPos({ x: 0, y: 53, w: 12, h: 8 }),
  );

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
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 100, color: "yellow" },
            { value: 500, color: "red" },
          ]),
      )
      .gridPos({ x: 12, y: 53, w: 12, h: 8 }),
  );
}
