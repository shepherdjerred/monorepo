/** Contract published on Velero Schedules by the infrastructure owner. */
export const BACKUP_MONITORING_ANNOTATIONS = {
  maxAgeSeconds: "ops.sjer.red/backup-max-age-seconds",
  alertForSeconds: "ops.sjer.red/backup-alert-for-seconds",
  severity: "ops.sjer.red/backup-alert-severity",
} as const;

export function monitoringDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/u.exec(value);
  if (match === null)
    throw new Error(`Invalid backup monitoring duration: ${value}`);
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
  const seconds = Number(match[1]) * (units[match[2] ?? ""] ?? Number.NaN);
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error(`Invalid backup monitoring duration: ${value}`);
  return seconds;
}

export function backupMonitoringAnnotations(policy: {
  noBackupWindow: string;
  alertFor: string;
  severity: "critical" | "warning" | "info";
}): Record<string, string> {
  return {
    [BACKUP_MONITORING_ANNOTATIONS.maxAgeSeconds]: String(
      monitoringDurationSeconds(policy.noBackupWindow),
    ),
    [BACKUP_MONITORING_ANNOTATIONS.alertForSeconds]: String(
      monitoringDurationSeconds(policy.alertFor),
    ),
    [BACKUP_MONITORING_ANNOTATIONS.severity]: policy.severity,
  };
}

/** Matches the SeaweedFS PrometheusRule windows and five-minute pending time. */
export const SEAWEEDFS_BACKUP_FRESHNESS = {
  "six-hourly": {
    warningSeconds: 8 * 3600,
    errorSeconds: 8 * 3600,
    alertForSeconds: 300,
  },
  daily: {
    warningSeconds: 36 * 3600,
    errorSeconds: 48 * 3600,
    alertForSeconds: 300,
  },
} as const;
