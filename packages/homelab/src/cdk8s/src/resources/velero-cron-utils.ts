import { CronExpressionParser } from "cron-parser";

/**
 * Calculate appropriate monitoring window and alert settings from a cron expression
 */
export function calculateMonitoringFromCron(cronExpression: string): {
  noBackupWindow: string;
  alertFor: string;
  severity: "critical" | "warning" | "info";
} {
  // Parse the cron expression
  const interval = CronExpressionParser.parse(cronExpression);

  // Calculate the next 3 execution times to determine the typical interval
  const exec1 = interval.next().toDate();
  const exec2 = interval.next().toDate();
  const exec3 = interval.next().toDate();

  // Calculate average interval between executions in milliseconds
  const intervals = [exec2.getTime() - exec1.getTime(), exec3.getTime() - exec2.getTime()];
  const avgIntervalMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;

  // Convert to hours
  const avgIntervalHours = avgIntervalMs / (1000 * 60 * 60);

  // Calculate monitoring window: 1.4x the interval (with buffer)
  // This ensures we catch missed backups while avoiding false positives
  const monitoringWindowHours = Math.ceil(avgIntervalHours * 1.4);

  // Determine the format for the monitoring window
  let noBackupWindow: string;
  let alertFor: string;
  let severity: "critical" | "warning" | "info";

  if (monitoringWindowHours < 48) {
    // Less than 2 days - use hours
    noBackupWindow = `${String(monitoringWindowHours)}h`;
    alertFor = "1h";
    severity = "critical";
  } else if (monitoringWindowHours < 24 * 14) {
    // Less than 2 weeks - use days
    const days = Math.ceil(monitoringWindowHours / 24);
    noBackupWindow = `${String(days)}d`;
    alertFor = `${String(Math.min(6, Math.ceil(days / 4)))}h`;
    severity = "critical";
  } else {
    // More than 2 weeks - use days, lower severity
    const days = Math.ceil(monitoringWindowHours / 24);
    noBackupWindow = `${String(days)}d`;
    alertFor = `${String(Math.min(24, Math.ceil(days / 4)))}h`;
    severity = "warning";
  }

  return {
    noBackupWindow,
    alertFor,
    severity,
  };
}

/**
 * Get a human-readable description of the cron schedule
 */
export function getCronDescription(cronExpression: string): string {
  const interval = CronExpressionParser.parse(cronExpression);

  // Calculate the next 2 execution times to understand frequency
  const next1 = interval.next().toDate();
  const next2 = interval.next().toDate();

  const diffMs = next2.getTime() - next1.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffHours / 24;

  if (diffHours < 24) {
    return `every ${String(Math.round(diffHours))} hours`;
  } else if (diffDays < 7) {
    return `every ${String(Math.round(diffDays))} days`;
  } else if (diffDays < 30) {
    return `weekly`;
  } else if (diffDays < 90) {
    return `monthly`;
  } else {
    return `quarterly`;
  }
}
