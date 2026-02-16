import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";
import * as text from "@grafana/grafana-foundation-sdk/text";

/**
 * Creates a Grafana dashboard for Velero backup monitoring
 * Shows backup health, storage size, and what is/isn't backed up
 */
export function createVeleroDashboard() {
  // Create Prometheus datasource reference
  const prometheusDatasource = {
    type: "prometheus",
    uid: "Prometheus",
  };

  // Create schedule variable for filtering
  const scheduleVariable = new dashboard.QueryVariableBuilder("schedule")
    .label("Schedule")
    .query('label_values(velero_backup_attempt_total{schedule!=""}, schedule)')
    .datasource(prometheusDatasource)
    .multi(true)
    .includeAll(true)
    .allValue(".*");

  // Create namespace variable for storage monitoring
  const namespaceVariable = new dashboard.QueryVariableBuilder("namespace")
    .label("Namespace")
    .query("label_values(kube_persistentvolumeclaim_resource_requests_storage_bytes, namespace)")
    .datasource(prometheusDatasource)
    .multi(true)
    .includeAll(true)
    .allValue(".*");

  // Helper function to build filter expression
  const buildScheduleFilter = () => {
    return 'schedule=~"$schedule"';
  };

  const buildNamespaceFilter = () => {
    return 'namespace=~"$namespace"';
  };

  // Build the main dashboard
  const builder = new dashboard.DashboardBuilder("Velero - Backup Monitoring")
    .uid("velero-dashboard")
    .tags(["velero", "backup", "storage", "kubernetes"])
    .time({ from: "now-7d", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable()
    .withVariable(scheduleVariable)
    .withVariable(namespaceVariable);

  // Add descriptive text panel
  builder.withPanel(
    new text.PanelBuilder()
      .title("Info")
      .content(
        `## Velero Backup Monitoring
This dashboard provides an overview of Velero backup health, performance, and storage usage.

**If you see panels with 'No data':**

This usually means that Prometheus is not successfully scraping metrics from the Velero pod. Please verify the following:
1. The Velero pod is running and healthy.
2. The Prometheus \`ServiceMonitor\` or scrape configuration for Velero is correct and targeting the Velero pod's \`/metrics\` endpoint on port 8085.
3. Check for metrics like \`velero_backup_attempt_total\` in your Prometheus instance to confirm data is being collected.`,
      )
      .gridPos({ x: 0, y: 0, w: 24, h: 4 }),
  );

  const overallStatusPanel = new stat.PanelBuilder()
    .title("Overall Backup Status")
    .description("Overall backup status. 1 = Healthy (no failures in last 24h), 0 = Unhealthy.")
    .datasource(prometheusDatasource)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(`count(increase(velero_backup_failure_total{schedule!=""}[24h]) > 0) == 0`)
        .legendFormat("Status"),
    )
    .gridPos({ x: 0, y: 4, w: 24, h: 4 })
    .graphMode(common.BigValueGraphMode.None)
    .colorMode(common.BigValueColorMode.Value);

  builder.withPanel(overallStatusPanel);

  const createStatPanel = (
    title: string,
    description: string,
    expr: string,
    legend: string,
    gridPos: dashboard.GridPos,
    unit?: string,
    graphMode?: common.BigValueGraphMode,
    decimals?: number,
  ) => {
    const panel = new stat.PanelBuilder()
      .title(title)
      .description(description)
      .datasource(prometheusDatasource)
      .withTarget(new prometheus.DataqueryBuilder().expr(expr).legendFormat(legend))
      .gridPos(gridPos);

    if (unit) {
      panel.unit(unit);
    }

    if (graphMode) {
      panel.graphMode(graphMode);
    }

    if (decimals !== undefined) {
      panel.decimals(decimals);
    }

    return panel;
  };

  // Row 1: Backup Health Overview
  builder.withRow(new dashboard.RowBuilder("Backup Health Overview"));

  // Backup Success Rate by Schedule
  builder.withPanel(
    createStatPanel(
      "Backup Success Rate",
      "Percentage of successful backups per schedule",
      `(sum by (schedule) (increase(velero_backup_success_total{${buildScheduleFilter()}}[7d])) / sum by (schedule) (increase(velero_backup_attempt_total{${buildScheduleFilter()}}[7d]))) * 100`,
      "{{schedule}}",
      { x: 0, y: 9, w: 6, h: 4 },
      "percent",
      common.BigValueGraphMode.Area,
      1,
    ).thresholds(
      new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
        { value: 0, color: "red" },
        { value: 95, color: "yellow" },
        { value: 99, color: "green" },
      ]),
    ),
  );

  // Total Backup Attempts (7 days)
  builder.withPanel(
    createStatPanel(
      "Total Backup Attempts (7d)",
      "Total backup attempts in the last 7 days",
      `sum by (schedule) (increase(velero_backup_attempt_total{${buildScheduleFilter()}}[7d]))`,
      "{{schedule}}",
      { x: 6, y: 9, w: 6, h: 4 },
    ),
  );

  // Total Successful Backups (7 days)
  builder.withPanel(
    createStatPanel(
      "Successful Backups (7d)",
      "Total successful backups in the last 7 days",
      `sum by (schedule) (increase(velero_backup_success_total{${buildScheduleFilter()}}[7d]))`,
      "{{schedule}}",
      { x: 12, y: 9, w: 6, h: 4 },
    ),
  );

  // Total Failed Backups (7 days)
  builder.withPanel(
    createStatPanel(
      "Failed Backups (7d)",
      "Total failed backups in the last 7 days",
      `sum by (schedule) (increase(velero_backup_failure_total{${buildScheduleFilter()}}[7d]))`,
      "{{schedule}}",
      { x: 18, y: 9, w: 6, h: 4 },
    ).thresholds(
      new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
        { value: 0, color: "green" },
        { value: 1, color: "yellow" },
        { value: 5, color: "red" },
      ]),
    ),
  );

  // Row 2: Schedule Status
  builder.withRow(new dashboard.RowBuilder("Schedule Status"));

  // Last Successful Backup Time
  builder.withPanel(
    createStatPanel(
      "Last Successful Backup",
      "Time since last successful backup per schedule",
      `time() - velero_backup_last_successful_timestamp{${buildScheduleFilter()}}`,
      "{{schedule}}",
      { x: 0, y: 13, w: 6, h: 4 },
      "dtdurations",
      common.BigValueGraphMode.None,
    ),
  );

  // Total Backup Items
  builder.withPanel(
    createStatPanel(
      "Total Backup Items",
      "Total items backed up per schedule",
      `velero_backup_items_total{${buildScheduleFilter()}}`,
      "{{schedule}}",
      { x: 6, y: 13, w: 6, h: 4 },
    ),
  );

  // Backup Item Errors
  builder.withPanel(
    createStatPanel(
      "Backup Item Errors",
      "Number of items with errors per schedule",
      `velero_backup_items_errors{${buildScheduleFilter()}}`,
      "{{schedule}}",
      { x: 12, y: 13, w: 6, h: 4 },
    ).thresholds(
      new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
        { value: 0, color: "green" },
        { value: 1, color: "yellow" },
        { value: 5, color: "red" },
      ]),
    ),
  );

  // Backup Success Status (Current)
  builder.withPanel(
    createStatPanel(
      "Current Backup Status",
      "1 = Success in last hour, 0 = No success",
      `(sum by (schedule) (increase(velero_backup_success_total{${buildScheduleFilter()}}[1h])) > 0)`,
      "{{schedule}}",
      { x: 18, y: 13, w: 6, h: 4 },
    ).thresholds(
      new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
        { value: 0, color: "red" },
        { value: 1, color: "green" },
      ]),
    ),
  );

  // Row 3: Backup Performance
  builder.withRow(new dashboard.RowBuilder("Backup Performance"));

  // Backup Duration (95th percentile)
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Average Backup Duration")
      .description("Average time taken for backups to complete")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum(rate(velero_backup_duration_seconds_sum{${buildScheduleFilter()}}[5m])) by (schedule) / sum(rate(velero_backup_duration_seconds_count{${buildScheduleFilter()}}[5m])) by (schedule)`,
          )
          .legendFormat("{{schedule}}"),
      )
      .unit("s")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 21, w: 12, h: 8 }),
  );

  // Backup Success Rate Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Backup Success Rate Over Time")
      .description("Percentage of successful backups")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `(sum by (schedule) (rate(velero_backup_success_total{${buildScheduleFilter()}}[5m])) / sum by (schedule) (rate(velero_backup_attempt_total{${buildScheduleFilter()}}[5m]))) * 100`,
          )
          .legendFormat("{{schedule}}"),
      )
      .unit("percent")
      .decimals(1)
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "red" },
          { value: 95, color: "yellow" },
          { value: 99, color: "green" },
        ]),
      )
      .gridPos({ x: 12, y: 21, w: 12, h: 8 }),
  );

  // Backup Attempt Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Backup Attempt Rate")
      .description("Number of backup attempts per hour")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`sum by (schedule) (rate(velero_backup_attempt_total{${buildScheduleFilter()}}[5m])) * 3600`)
          .legendFormat("{{schedule}}"),
      )
      .unit("ops/hr")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 29, w: 12, h: 8 }),
  );

  // Backup Item Error Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Backup Item Error Rate")
      .description("Percentage of backup items with errors")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `(sum by (schedule) (velero_backup_items_errors{${buildScheduleFilter()}}) / sum by (schedule) (velero_backup_items_total{${buildScheduleFilter()}})) * 100`,
          )
          .legendFormat("{{schedule}}"),
      )
      .unit("percent")
      .decimals(2)
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1, color: "yellow" },
          { value: 5, color: "red" },
        ]),
      )
      .gridPos({ x: 12, y: 29, w: 12, h: 8 }),
  );

  // Row 4: Storage Size Monitoring
  builder.withRow(new dashboard.RowBuilder("Storage Size Monitoring"));

  // Total Backup Eligible Storage
  builder.withPanel(
    createStatPanel(
      "Total Backup Eligible Storage",
      "Total size of PVCs marked for backup",
      `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled",${buildNamespaceFilter()}})`,
      "Total",
      { x: 0, y: 37, w: 6, h: 4 },
      "bytes",
    ),
  );

  // Backup Eligible Storage by Namespace
  builder.withPanel(
    createStatPanel(
      "Backup Eligible Storage by Namespace",
      "Total size of PVCs marked for backup by namespace",
      `sum by (namespace) (kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled",${buildNamespaceFilter()}})`,
      "{{namespace}}",
      { x: 6, y: 37, w: 6, h: 4 },
      "bytes",
    ),
  );

  // Total Storage (All PVCs)
  builder.withPanel(
    createStatPanel(
      "Total Storage (All PVCs)",
      "Total size of all PVCs in cluster",
      `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{${buildNamespaceFilter()}})`,
      "Total",
      { x: 12, y: 37, w: 6, h: 4 },
      "bytes",
    ),
  );

  // Backup Coverage Percentage
  builder.withPanel(
    createStatPanel(
      "Backup Coverage",
      "Percentage of storage covered by backups",
      `(sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled",${buildNamespaceFilter()}}) / sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{${buildNamespaceFilter()}})) * 100`,
      "Coverage",
      { x: 18, y: 37, w: 6, h: 4 },
      "percent",
      common.BigValueGraphMode.None,
      1,
    ).thresholds(
      new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
        { value: 0, color: "red" },
        { value: 50, color: "yellow" },
        { value: 80, color: "green" },
      ]),
    ),
  );

  // Storage Size Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Backup Eligible Storage Over Time")
      .description("Total size of volumes eligible for backup")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled",${buildNamespaceFilter()}})`,
          )
          .legendFormat("Total Eligible"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{${buildNamespaceFilter()}})`)
          .legendFormat("Total All PVCs"),
      )
      .unit("bytes")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 41, w: 12, h: 8 }),
  );

  // Storage by Namespace Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Storage by Namespace Over Time")
      .description("Storage size by namespace (backup eligible vs all)")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (namespace) (kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled",${buildNamespaceFilter()}})`,
          )
          .legendFormat("{{namespace}} (Backup Eligible)"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (namespace) (kube_persistentvolumeclaim_resource_requests_storage_bytes{${buildNamespaceFilter()}})`,
          )
          .legendFormat("{{namespace}} (All)"),
      )
      .unit("bytes")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 41, w: 12, h: 8 }),
  );

  // Row 5: What is/isn't Backed Up
  builder.withRow(new dashboard.RowBuilder("Backup Coverage Analysis"));

  // Storage Not Backed Up
  builder.withPanel(
    createStatPanel(
      "Storage Not Backed Up",
      "Total size of PVCs without velero.io/backup label",
      `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup!="enabled",${buildNamespaceFilter()}})`,
      "Not Backed Up",
      { x: 0, y: 49, w: 6, h: 4 },
      "bytes",
    ),
  );

  // Storage Backed Up
  builder.withPanel(
    createStatPanel(
      "Storage Backed Up",
      "Total size of PVCs with velero.io/backup=enabled label",
      `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled",${buildNamespaceFilter()}})`,
      "Backed Up",
      { x: 6, y: 49, w: 6, h: 4 },
      "bytes",
    ),
  );

  // Number of PVCs Not Backed Up
  builder.withPanel(
    createStatPanel(
      "PVCs Not Backed Up",
      "Count of PVCs without backup label",
      `count(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup!="enabled",${buildNamespaceFilter()}})`,
      "Count",
      { x: 12, y: 49, w: 6, h: 4 },
      "short",
      common.BigValueGraphMode.None,
    ),
  );

  // Number of PVCs Backed Up
  builder.withPanel(
    createStatPanel(
      "PVCs Backed Up",
      "Count of PVCs with backup label",
      `count(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled",${buildNamespaceFilter()}})`,
      "Count",
      { x: 18, y: 49, w: 6, h: 4 },
      "short",
      common.BigValueGraphMode.None,
    ),
  );

  // Row 6: Backup Operations
  builder.withRow(new dashboard.RowBuilder("Backup Operations"));

  // Backup Deletion Success Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Backup Deletion Success Rate")
      .description("Rate of successful backup deletions (old backups cleanup)")
      .datasource(prometheusDatasource)
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
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
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
      .description("Rate of backup deletion failures (may cause storage exhaustion)")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`sum(rate(velero_backup_deletion_failure_total[5m]))`)
          .legendFormat("Deletion Failures"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 0.01, color: "yellow" },
          { value: 0.1, color: "red" },
        ]),
      )
      .gridPos({ x: 12, y: 57, w: 12, h: 8 }),
  );

  return builder.build();
}

/**
 * Exports the dashboard as JSON string for use in ConfigMaps or API calls
 */
export function exportVeleroDashboardJson(): string {
  const dashboard = createVeleroDashboard();
  return exportDashboardWithHelmEscaping(dashboard);
}
