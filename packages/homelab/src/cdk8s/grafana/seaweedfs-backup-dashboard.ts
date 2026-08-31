import * as common from "@grafana/grafana-foundation-sdk/common";
import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

const PROMETHEUS = { type: "prometheus", uid: "Prometheus" };

function statPanel(input: {
  title: string;
  description: string;
  expression: string;
  legend: string;
  x: number;
  y: number;
  width: number;
  unit?: string;
}): stat.PanelBuilder {
  const panel = new stat.PanelBuilder()
    .title(input.title)
    .description(input.description)
    .datasource(PROMETHEUS)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(input.expression)
        .legendFormat(input.legend),
    )
    .gridPos({ x: input.x, y: input.y, w: input.width, h: 5 })
    .graphMode(common.BigValueGraphMode.Area);
  if (input.unit !== undefined) panel.unit(input.unit);
  return panel;
}

function timeSeriesPanel(input: {
  title: string;
  description: string;
  expression: string;
  legend: string;
  x: number;
  y: number;
  width: number;
  unit?: string;
}): timeseries.PanelBuilder {
  const panel = new timeseries.PanelBuilder()
    .title(input.title)
    .description(input.description)
    .datasource(PROMETHEUS)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(input.expression)
        .legendFormat(input.legend),
    )
    .gridPos({ x: input.x, y: input.y, w: input.width, h: 8 });
  if (input.unit !== undefined) panel.unit(input.unit);
  return panel;
}

export function createSeaweedFsBackupDashboard() {
  const builder = new dashboard.DashboardBuilder("SeaweedFS - Off-site Backup")
    .uid("seaweedfs-backup")
    .tags(["seaweedfs", "backup", "r2", "temporal"])
    .time({ from: "now-30d", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable();

  builder.withPanel(
    statPanel({
      title: "Backup Freshness",
      description: "Seconds since the last completed recovery point.",
      expression: "time() - seaweedfs_backup_last_success_timestamp_seconds",
      legend: "{{bucket}} / {{cadence}}",
      x: 0,
      y: 0,
      width: 8,
      unit: "s",
    }),
  );
  builder.withPanel(
    statPanel({
      title: "Current Stage",
      description: "The active stage has value 1.",
      expression: "seaweedfs_backup_stage == 1",
      legend: "{{cadence}} / {{stage}}",
      x: 8,
      y: 0,
      width: 8,
    }),
  );
  builder.withPanel(
    statPanel({
      title: "Projected Monthly R2 Cost",
      description:
        "Standard storage projection at $0.015 per decimal GB-month.",
      expression:
        'cloudflare_r2_storage_bytes{bucket="seaweedfs-backups"} / 1000000000 * 0.015',
      legend: "R2 storage",
      x: 16,
      y: 0,
      width: 8,
      unit: "currencyUSD",
    }),
  );
  builder.withPanel(
    timeSeriesPanel({
      title: "Run Duration",
      description: "P95 duration by cadence and outcome.",
      expression:
        "histogram_quantile(0.95, sum by (le, bucket, cadence, outcome) (rate(seaweedfs_backup_duration_seconds_bucket[24h])))",
      legend: "{{bucket}} / {{cadence}} / {{outcome}}",
      x: 0,
      y: 5,
      width: 8,
      unit: "s",
    }),
  );
  builder.withPanel(
    timeSeriesPanel({
      title: "Source vs Protected Storage",
      description:
        "Latest source inventory and protected manifest bytes by bucket.",
      expression:
        "seaweedfs_backup_source_bytes or seaweedfs_backup_protected_bytes",
      legend: "{{bucket}} / {{__name__}}",
      x: 8,
      y: 5,
      width: 8,
      unit: "bytes",
    }),
  );
  builder.withPanel(
    timeSeriesPanel({
      title: "Changed and Reused Objects",
      description: "Object counts from the latest completed bucket manifests.",
      expression: "seaweedfs_backup_objects",
      legend: "{{bucket}} / {{result}}",
      x: 16,
      y: 5,
      width: 8,
    }),
  );
  builder.withPanel(
    timeSeriesPanel({
      title: "Transferred Bytes",
      description: "Bytes copied to R2 by bucket and cadence.",
      expression: "seaweedfs_backup_copied_bytes",
      legend: "{{bucket}} / {{cadence}}",
      x: 0,
      y: 13,
      width: 8,
      unit: "bytes",
    }),
  );
  builder.withPanel(
    timeSeriesPanel({
      title: "Verification Results",
      description: "Read-back and integrity verification outcomes.",
      expression: "increase(seaweedfs_backup_verification_total[24h])",
      legend: "{{outcome}}",
      x: 8,
      y: 13,
      width: 8,
    }),
  );
  builder.withPanel(
    timeSeriesPanel({
      title: "Retention Points",
      description: "Current retained recovery points by GFS tier.",
      expression: "seaweedfs_backup_retained_points",
      legend: "{{tier}}",
      x: 16,
      y: 13,
      width: 8,
    }),
  );
  builder.withPanel(
    timeSeriesPanel({
      title: "GC Backlog",
      description: "Candidate sets and objects waiting for revalidation.",
      expression: "seaweedfs_backup_gc_backlog or seaweedfs_backup_gc_objects",
      legend: "{{__name__}}",
      x: 0,
      y: 21,
      width: 12,
    }),
  );
  builder.withPanel(
    timeSeriesPanel({
      title: "R2 Growth",
      description: "Backup bucket storage growth over time.",
      expression: 'cloudflare_r2_storage_bytes{bucket="seaweedfs-backups"}',
      legend: "seaweedfs-backups",
      x: 12,
      y: 21,
      width: 12,
      unit: "bytes",
    }),
  );
  return builder.build();
}

export function exportSeaweedFsBackupDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createSeaweedFsBackupDashboard());
}
