/**
 * Velero backup schedule configuration - single source of truth
 *
 * This configuration is used to generate both:
 * 1. Velero Schedule resources (in argo-applications/velero.ts)
 * 2. Prometheus monitoring alerts (in monitoring/monitoring/rules/velero.ts)
 *
 * This ensures that backup schedules and their monitoring alerts never drift apart.
 * When you add, modify, or remove a backup schedule, both the Velero resource
 * and its corresponding monitoring alert will be updated automatically.
 *
 * Monitoring windows are automatically calculated from the cron expression:
 * - Alert window is set to 1.4x the typical interval between backups
 * - Alert delay and severity are based on the backup frequency
 */

import { calculateMonitoringFromCron } from "./velero-cron-utils.ts";

export type VeleroScheduleConfig = {
  /** Unique identifier for the schedule */
  id: string;
  /** Display name for the backup */
  name: string;
  /** Cron expression for the schedule */
  cronSchedule: string;
  /** TTL for backups (e.g., "72h") */
  ttl: string;
  /** Backup type label */
  backupType: string;
  /** Human-readable description */
  description: string;
};

/** Extended schedule config with calculated monitoring parameters */
export type VeleroScheduleConfigWithMonitoring = VeleroScheduleConfig & {
  monitoring: {
    /** Time window to check for successful backups (auto-calculated from cron) */
    noBackupWindow: string;
    /** How long to wait before firing alert (auto-calculated) */
    alertFor: string;
    /** Alert severity (auto-calculated based on frequency) */
    severity: "critical" | "warning" | "info";
    /** Pattern to match this schedule in metrics (regex) */
    schedulePattern: string;
  };
};

const VELERO_SCHEDULE_CONFIGS: VeleroScheduleConfig[] = [
  {
    id: "velero-backup-6hourly",
    name: "6hourly-backup",
    cronSchedule: "15 */6 * * *",
    ttl: "72h", // 3 days (12 backups)
    backupType: "6hourly",
    description: "Every 6 hours - keep 3 days (12 backups)",
  },
  {
    id: "velero-backup-daily",
    name: "daily-backup",
    cronSchedule: "30 2 * * *", // Daily at 2:30 AM
    ttl: "168h", // 7 days (7 backups)
    backupType: "daily",
    description: "Daily backups - keep 7 days",
  },
  {
    id: "velero-backup-weekly",
    name: "weekly-backup",
    cronSchedule: "45 3 * * 1",
    ttl: "720h", // 30 days (4 backups)
    backupType: "weekly",
    description: "Weekly backups - keep 30 days",
  },
  {
    id: "velero-backup-monthly",
    name: "monthly-backup",
    cronSchedule: "0 5 1 * *", // 1st of month at 5 AM
    ttl: "2160h", // 90 days / 3 months
    backupType: "monthly",
    description: "Monthly backups - keep 3 months",
  },
];

/**
 * Enrich schedules with auto-calculated monitoring parameters
 */
function enrichSchedulesWithMonitoring(schedules: VeleroScheduleConfig[]): VeleroScheduleConfigWithMonitoring[] {
  return schedules.map((schedule) => {
    const monitoring = calculateMonitoringFromCron(schedule.cronSchedule);
    return {
      ...schedule,
      monitoring: {
        ...monitoring,
        schedulePattern: `.*${schedule.backupType}.*`,
      },
    };
  });
}

/**
 * Export schedules with monitoring parameters calculated from cron expressions
 */
export const VELERO_SCHEDULES = enrichSchedulesWithMonitoring(VELERO_SCHEDULE_CONFIGS);
