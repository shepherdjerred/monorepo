import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";

type Datasource = { type: string; uid: string };
type BuildFilter = () => string;

/**
 * Add advanced metrics panels (MRU/MFU distribution, ghost cache, lock retries, prune activity)
 */
export function addAdvancedMetricsPanels(
  builder: dashboard.DashboardBuilder,
  prometheusDatasource: Datasource,
  buildFilter: BuildFilter,
): void {
  builder.withRow(new dashboard.RowBuilder("Advanced Metrics"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ARC MRU/MFU Distribution")
      .description("Most Recently Used vs Most Frequently Used sizes")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_mru_size{${buildFilter()}}`)
          .legendFormat("MRU Size"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`node_zfs_arc_mfu_size{${buildFilter()}}`)
          .legendFormat("MFU Size"),
      )
      .unit("bytes")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 73, w: 12, h: 8 }),
  );

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
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 10, color: "yellow" },
            { value: 50, color: "red" },
          ]),
      )
      .gridPos({ x: 0, y: 81, w: 12, h: 8 }),
  );

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
}
