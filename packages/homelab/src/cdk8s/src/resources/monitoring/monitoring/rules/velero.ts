import { PrometheusRuleSpecGroups } from "../../../../../generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "../../../../../generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared";
import { VELERO_SCHEDULES } from "../../../velero-schedules.ts";

export function getVeleroRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // Velero backup size monitoring
    {
      name: "velero-backup-size",
      rules: [
        {
          // Recording rule to calculate total size of volumes eligible for backup
          record: "velero:backup_eligible_volume_size_bytes",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled"}) by (namespace)`,
          ),
        },
        {
          // Recording rule for total cluster-wide backup size
          record: "velero:backup_eligible_total_size_bytes",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled"})`,
          ),
        },
        {
          alert: "VeleroLargeVolumeAddedToBackup",
          annotations: {
            summary: "Large volume added to Velero backups",
            message: escapePrometheusTemplate(
              "A PVC larger than 200GB has the velero.io/backup label in namespace {{ $labels.namespace }}: {{ $labels.persistentvolumeclaim }} ({{ $value | humanize1024 }}B). Consider excluding this volume.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled"} > 200 * 1024 * 1024 * 1024`,
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroTotalBackupSizeExcessive",
          annotations: {
            summary: "Total backup volume size is very large",
            message: escapePrometheusTemplate(
              "Total size of volumes eligible for Velero backup is {{ $value | humanize1024 }}B. This may cause long backup times and storage costs. Review excluded volumes.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled"}) > 2 * 1024 * 1024 * 1024 * 1024`,
          ),
          for: "15m",
          labels: {
            severity: "info",
          },
        },
        {
          alert: "VeleroNamespaceBackupSizeExcessive",
          annotations: {
            summary: "Namespace has large backup volume size",
            message: escapePrometheusTemplate(
              "Namespace {{ $labels.namespace }} has {{ $value | humanize1024 }}B of volumes eligible for backup. Review if all volumes need backup.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(kube_persistentvolumeclaim_resource_requests_storage_bytes{label_velero_io_backup="enabled"}) by (namespace) > 500 * 1024 * 1024 * 1024`,
          ),
          for: "15m",
          labels: {
            severity: "info",
          },
        },
      ],
    },
    // Velero backup monitoring
    {
      name: "velero-backup",
      rules: [
        {
          alert: "VeleroBackupFailed",
          annotations: {
            summary: "Velero backup has failed",
            message: escapePrometheusTemplate("Velero backup {{ $labels.schedule }} has failed"),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max(velero_backup_last_status{schedule!=""}) by (schedule) != 1',
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroBackupFailing",
          annotations: {
            summary: "Velero backup has been failing for extended period",
            message: escapePrometheusTemplate("Velero backup {{ $labels.schedule }} has been failing for the last 12h"),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max(velero_backup_last_status{schedule!=""}) by (schedule) != 1',
          ),
          for: "12h",
          labels: {
            severity: "critical",
          },
        },
        // Dynamically generate "no new backup" alerts from schedule configuration
        // Only alerts if the schedule has had at least one successful backup (prevents false positives for new schedules)
        ...VELERO_SCHEDULES.map((scheduleConfig) => ({
          alert: `VeleroNoNew${scheduleConfig.backupType.charAt(0).toUpperCase() + scheduleConfig.backupType.slice(1)}Backup`,
          annotations: {
            summary: `No new successful ${scheduleConfig.backupType} Velero backup`,
            message: escapePrometheusTemplate(
              `Velero backup {{ $labels.schedule }} has not had any successful backups in the last ${scheduleConfig.monitoring.noBackupWindow}`,
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(max(increase(velero_backup_success_total{schedule!="",schedule=~"${scheduleConfig.monitoring.schedulePattern}"}[${scheduleConfig.monitoring.noBackupWindow}])) by (schedule) == 0)
and on(schedule) (max(velero_backup_success_total{schedule!="",schedule=~"${scheduleConfig.monitoring.schedulePattern}"}) by (schedule) > 0)`,
          ),
          for: scheduleConfig.monitoring.alertFor,
          labels: {
            severity: scheduleConfig.monitoring.severity,
          },
        })),
        {
          alert: "VeleroBackupPartialFailures",
          annotations: {
            summary: "Velero backup experiencing partial failures",
            message: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} has {{ $value | humanizePercentage }} partially failed backups",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(rate(velero_backup_partial_failure_total{schedule!=""}[25m])) by (schedule)
  / sum(rate(velero_backup_attempt_total{schedule!=""}[25m])) by (schedule) > 0.5`,
          ),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    // Velero restore monitoring
    {
      name: "velero-restore",
      rules: [
        {
          alert: "VeleroRestoreFailed",
          annotations: {
            summary: "Velero restore has failed",
            message: escapePrometheusTemplate("Velero restore has failed - {{ $value }} failures in the last 15m"),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("rate(velero_restore_failed_total[15m]) > 0"),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "VeleroRestorePartialFailure",
          annotations: {
            summary: "Velero restore partially failed",
            message: escapePrometheusTemplate(
              "Velero restore has partial failures - {{ $value }} partial failures in the last 15m",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("rate(velero_restore_partial_failure_total[15m]) > 0"),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroRestoreValidationFailed",
          annotations: {
            summary: "Velero restore validation failed",
            message: escapePrometheusTemplate(
              "Velero restore validation has failed - {{ $value }} validation failures in the last 15m",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("rate(velero_restore_validation_failed_total[15m]) > 0"),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    // Velero volume snapshot monitoring
    {
      name: "velero-snapshots",
      rules: [
        {
          alert: "VeleroVolumeSnapshotFailed",
          annotations: {
            summary: "Velero volume snapshot failed",
            message: escapePrometheusTemplate(
              "Velero volume snapshot has failed - {{ $value }} failures in the last 15m",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("rate(velero_volume_snapshot_failure_total[15m]) > 0"),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "VeleroCSISnapshotFailed",
          annotations: {
            summary: "Velero CSI snapshot failed",
            message: escapePrometheusTemplate("Velero CSI snapshot has failed - {{ $value }} failures in the last 15m"),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("rate(velero_csi_snapshot_failure_total[15m]) > 0"),
          for: "5m",
          labels: {
            severity: "critical",
          },
        },
        {
          alert: "VeleroLargeVolumeBackupFailed",
          annotations: {
            summary: "Large volume backup attempt failed",
            message: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} failed with {{ $value }} volume snapshot errors. This may indicate attempts to backup large volumes that should be excluded.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(sum(rate(velero_volume_snapshot_failure_total[15m])) by (schedule) > 0)
  and on(schedule) (max(velero_backup_items_errors) by (schedule) > 0)`,
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroBackupDurationExcessive",
          annotations: {
            summary: "Velero backup taking too long",
            message: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} has exceeded 30 minutes duration. This may indicate large volumes are being backed up that should be excluded.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "max(velero_backup_duration_seconds) by (schedule) > 1800",
          ),
          for: "5m",
          labels: {
            severity: "info",
          },
        },
      ],
    },
    // Velero backup quality monitoring
    {
      name: "velero-backup-quality",
      rules: [
        {
          alert: "VeleroBackupValidationFailed",
          annotations: {
            summary: "Velero backup validation failed",
            message: escapePrometheusTemplate(
              "Velero backup validation has increased day-over-day - {{ $value }} new validation failures in the last 24h",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(velero_backup_validation_failure_total[6h]) > 0",
          ),
          for: "5m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroBackupWarnings",
          annotations: {
            summary: "Velero backup has warnings",
            message: escapePrometheusTemplate("Velero backup has warnings - {{ $value }} warnings in the last 15m"),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("rate(velero_backup_warning_total[15m]) > 0"),
          for: "15m",
          labels: {
            severity: "info",
          },
        },
        {
          alert: "VeleroBackupItemErrors",
          annotations: {
            summary: "Velero backup has item errors",
            message: escapePrometheusTemplate("Velero backup {{ $labels.schedule }} has {{ $value }} item errors"),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("max(velero_backup_items_errors) by (schedule) > 0"),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
        {
          alert: "VeleroHighErrorRate",
          annotations: {
            summary: "High percentage of backup item errors",
            message: escapePrometheusTemplate(
              "Velero backup {{ $labels.schedule }} has {{ $value | humanizePercentage }} error rate. Check for large volumes or excluded resources causing failures.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(max(velero_backup_items_errors) by (schedule) / max(velero_backup_items_total) by (schedule)) > 0.1`,
          ),
          for: "10m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
    // Velero operational monitoring
    {
      name: "velero-operations",
      rules: [
        {
          alert: "VeleroBackupDeletionFailed",
          annotations: {
            summary: "Velero backup deletion failed",
            message: escapePrometheusTemplate(
              "Velero backup deletion has failed - {{ $value }} deletion failures in the last 30m. This may cause storage exhaustion.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("rate(velero_backup_deletion_failure_total[30m]) > 0"),
          for: "15m",
          labels: {
            severity: "warning",
          },
        },
      ],
    },
  ];
}
