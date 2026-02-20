import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";

type Datasource = { type: string; uid: string };

type StatPanelOptions = {
  title: string;
  description: string;
  expr: string;
  legend: string;
  gridPos: dashboard.GridPos;
  unit?: string;
  graphMode?: common.BigValueGraphMode;
  decimals?: number;
};

function createStatPanel(ds: Datasource, options: StatPanelOptions) {
  const panel = new stat.PanelBuilder()
    .title(options.title)
    .description(options.description)
    .datasource(ds)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(options.expr)
        .legendFormat(options.legend),
    )
    .gridPos(options.gridPos);

  if (options.unit != null && options.unit !== "") {
    panel.unit(options.unit);
  }

  if (options.graphMode !== undefined) {
    panel.graphMode(options.graphMode);
  }

  if (options.decimals !== undefined) {
    panel.decimals(options.decimals);
  }

  return panel;
}

/**
 * Add backup coverage analysis panels
 */
export function addBackupCoveragePanels(
  builder: dashboard.DashboardBuilder,
  ds: Datasource,
  buildNamespaceFilter: () => string,
): void {
  builder.withRow(new dashboard.RowBuilder("Backup Coverage Analysis"));

  // Storage Not Backed Up
  builder.withPanel(
    createStatPanel(ds, {
      title: "Storage Not Backed Up",
      description: "Total size of PVCs without velero.io/backup label",
      expr: `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup!="enabled",${buildNamespaceFilter()}})`,
      legend: "Not Backed Up",
      gridPos: { x: 0, y: 49, w: 6, h: 4 },
      unit: "bytes",
    }),
  );

  // Storage Backed Up
  builder.withPanel(
    createStatPanel(ds, {
      title: "Storage Backed Up",
      description: "Total size of PVCs with velero.io/backup=enabled label",
      expr: `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled",${buildNamespaceFilter()}})`,
      legend: "Backed Up",
      gridPos: { x: 6, y: 49, w: 6, h: 4 },
      unit: "bytes",
    }),
  );

  // Number of PVCs Not Backed Up
  builder.withPanel(
    createStatPanel(ds, {
      title: "PVCs Not Backed Up",
      description: "Count of PVCs without backup label",
      expr: `count(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup!="enabled",${buildNamespaceFilter()}})`,
      legend: "Count",
      gridPos: { x: 12, y: 49, w: 6, h: 4 },
      unit: "short",
      graphMode: common.BigValueGraphMode.None,
    }),
  );

  // Number of PVCs Backed Up
  builder.withPanel(
    createStatPanel(ds, {
      title: "PVCs Backed Up",
      description: "Count of PVCs with backup label",
      expr: `count(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled",${buildNamespaceFilter()}})`,
      legend: "Count",
      gridPos: { x: 18, y: 49, w: 6, h: 4 },
      unit: "short",
      graphMode: common.BigValueGraphMode.None,
    }),
  );
}

/**
 * Add backup operations panels (deletion success rate, deletion failures)
 */
export function addBackupOperationsPanels(
  builder: dashboard.DashboardBuilder,
  ds: Datasource,
): void {
  builder.withRow(new dashboard.RowBuilder("Backup Operations"));

  // Backup Deletion Success Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Backup Deletion Success Rate")
      .description("Rate of successful backup deletions (old backups cleanup)")
      .datasource(ds)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `(sum(rate(velero_backup_deletion_success_total[5m])) / sum(rate(velero_backup_deletion_attempt_total[5m]))) * 100`,
          )
          .legendFormat("Success Rate"),
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
            { value: 95, color: "yellow" },
            { value: 99, color: "green" },
          ]),
      )
      .gridPos({ x: 0, y: 57, w: 12, h: 8 }),
  );

  // Backup Deletion Failures
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Backup Deletion Failures")
      .description(
        "Rate of backup deletion failures (may cause storage exhaustion)",
      )
      .datasource(ds)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`sum(rate(velero_backup_deletion_failure_total[5m]))`)
          .legendFormat("Deletion Failures"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 0.01, color: "yellow" },
            { value: 0.1, color: "red" },
          ]),
      )
      .gridPos({ x: 12, y: 57, w: 12, h: 8 }),
  );
}
