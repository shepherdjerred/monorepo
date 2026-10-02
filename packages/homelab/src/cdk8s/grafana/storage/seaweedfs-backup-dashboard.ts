import * as common from "@grafana/grafana-foundation-sdk/common";
import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import { exportDashboardWithHelmEscaping } from "@shepherdjerred/homelab/cdk8s/grafana/dashboard-export.ts";

const PROMETHEUS = { type: "prometheus", uid: "Prometheus" };

const SCHEDULE = 'schedule_id=~"seaweedfs-backup-(daily|six-hourly)"';
const LATEST_OBSERVATION = `temporal_schedule_observation_timestamp_seconds{${SCHEDULE}} == on(temporal_namespace,schedule_id,workflow_type) group_left max by(temporal_namespace,schedule_id,workflow_type) (temporal_schedule_observation_timestamp_seconds{${SCHEDULE}})`;
const FRESH_SCHEDULE = `(${LATEST_OBSERVATION}) > time() - 1800`;
const RUNNING = `label_replace(max by(schedule_id) (temporal_schedule_running{${SCHEDULE}} and on(namespace,pod,temporal_namespace,schedule_id,workflow_type) (${FRESH_SCHEDULE}) and on(namespace,pod,temporal_namespace,schedule_id,workflow_type) (temporal_schedule_health_unknown{${SCHEDULE}} == 0)), "cadence", "$1", "schedule_id", "seaweedfs-backup-(daily|six-hourly)")`;
const WORKER_UP =
  'max(up{namespace="temporal",service=~".*temporal-infra-worker.*metrics.*"}) == 1';
const LATEST_STAGE_OBSERVATION =
  "seaweedfs_backup_stage_observation_timestamp_seconds == on(cadence) group_left max by(cadence) (seaweedfs_backup_stage_observation_timestamp_seconds)";
const FRESH_STAGE_OWNER = `(${LATEST_STAGE_OBSERVATION}) > time() - 1800 and on(namespace,pod) (up{namespace="temporal",service=~".*temporal-infra-worker.*metrics.*"} == 1)`;

export const SEAWEEDFS_STAGE_QUERY = `((seaweedfs_backup_stage{stage!="complete"} == 1 and on(namespace,pod,cadence) (${FRESH_STAGE_OWNER}) and on(cadence) (${RUNNING} == 1)) or label_replace((${RUNNING} == bool 0) == 1, "stage", "Idle", "cadence", ".*")) and on() (${WORKER_UP})`;

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
      description:
        "The newest stage from its live worker, observed within 30 minutes. Idle requires a recent known Temporal Schedule observation and a live infra worker. Missing telemetry remains unknown.",
      expression: SEAWEEDFS_STAGE_QUERY,
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
        "Last observed source inventory and protected manifest bytes by bucket. These are run observations; see Inventory Observed At for freshness.",
      expression:
        'label_replace(seaweedfs_backup_source_bytes,"measurement","source","bucket",".*") or label_replace(seaweedfs_backup_protected_bytes,"measurement","protected","bucket",".*")',
      legend: "{{bucket}} / {{measurement}}",
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
  builder.withPanel(
    statPanel({
      title: "Inventory Observed At",
      description:
        "Timestamp of the last successful inventory/manifest measurement. Missing or old measurements are unknown, including zero object/byte gauges.",
      expression: "seaweedfs_backup_observation_timestamp_seconds * 1000",
      legend: "{{bucket}} / {{cadence}}",
      x: 0,
      y: 29,
      width: 24,
      unit: "dateTimeAsIso",
    }),
  );
  return builder.build();
}

export function exportSeaweedFsBackupDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createSeaweedFsBackupDashboard());
}
