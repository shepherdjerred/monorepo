import CronParser from "cron-parser";
import { loggers } from "@shepherdjerred/birmel/utils/index.js";

const logger = loggers.scheduler;

/**
 * Validate a cron expression
 */
export function isValidCron(pattern: string): boolean {
  try {
    CronParser.parse(pattern);
    return true;
  } catch (error) {
    logger.debug(`Invalid cron pattern: ${pattern}`, { error: String(error) });
    return false;
  }
}

/**
 * Calculate the next run time for a cron pattern
 * @param pattern Cron expression (e.g., "0 9 * * *" for 9am daily)
 * @param from Start time (defaults to now)
 * @returns Next execution date
 */
export function getNextCronRun(pattern: string, from?: Date): Date {
  try {
    const interval = CronParser.parse(pattern, {
      currentDate: from ?? new Date(),
      tz: "UTC",
    });
    return interval.next().toDate();
  } catch (error) {
    logger.error(`Failed to parse cron pattern: ${pattern}`, {
      error: String(error),
    });
    throw new Error(`Invalid cron pattern: ${pattern}`);
  }
}

/**
 * Get human-readable description of a cron pattern
 */
export function describeCron(pattern: string): string {
  try {
    const parts = pattern.split(" ");
    if (parts.length !== 5) {
      return "Invalid cron pattern";
    }

    const minute = parts[0] ?? "";
    const hour = parts[1] ?? "";
    const dayOfMonth = parts[2] ?? "";
    const month = parts[3] ?? "";
    const dayOfWeek = parts[4] ?? "";

    // Simple descriptions for common patterns
    if (pattern === "* * * * *") {
      return "Every minute";
    }
    if (pattern === "0 * * * *") {
      return "Every hour";
    }
    if (pattern === "0 0 * * *") {
      return "Daily at midnight";
    }
    if (pattern === "0 9 * * *") {
      return "Daily at 9 AM";
    }
    if (pattern === "0 0 * * 0") {
      return "Weekly on Sunday at midnight";
    }
    if (pattern === "0 0 1 * *") {
      return "Monthly on the 1st at midnight";
    }

    // Generic description
    let desc = "At";
    desc += minute === "*" ? " every minute" : ` minute ${minute}`;

    if (hour !== "*") {
      desc += ` of hour ${hour}`;
    }

    if (dayOfMonth !== "*") {
      desc += ` on day ${dayOfMonth}`;
    }

    if (month !== "*") {
      desc += ` in month ${month}`;
    }

    if (dayOfWeek !== "*") {
      desc += ` on weekday ${dayOfWeek}`;
    }

    return desc;
  } catch {
    return "Unable to describe cron pattern";
  }
}

/**
 * Convert a simple schedule string to a cron pattern
 * @param schedule Simple schedule like "daily", "hourly", "weekly"
 * @param time Optional time in HH:MM format (defaults to 00:00)
 * @returns Cron pattern
 */
export function simpleToCron(
  schedule: "hourly" | "daily" | "weekly" | "monthly",
  time = "00:00",
): string {
  const [hour, minute] = time.split(":").map(Number);

  switch (schedule) {
    case "hourly":
      return `${String(minute ?? 0)} * * * *`;
    case "daily":
      return `${String(minute ?? 0)} ${String(hour ?? 0)} * * *`;
    case "weekly":
      return `${String(minute ?? 0)} ${String(hour ?? 0)} * * 0`; // Sunday
    case "monthly":
      return `${String(minute ?? 0)} ${String(hour ?? 0)} 1 * *`; // 1st of month
    default:
      throw new Error(`Unknown schedule type: ${String(schedule as unknown)}`); // exhaustive check
  }
}
