import * as chrono from "chrono-node";
import { loggers } from "@shepherdjerred/birmel/utils/index.js";

const logger = loggers.scheduler;

export type ParsedTime = {
  date: Date;
  confidence: "high" | "medium" | "low";
  originalText: string;
  parsedText: string;
};

/**
 * Parse natural language time expression to a Date
 * Examples:
 * - "in 5 minutes"
 * - "tomorrow at 3pm"
 * - "next Monday at 9am"
 * - "in 2 hours"
 * - "December 25th at noon"
 */
export function parseNaturalTime(
  text: string,
  referenceDate?: Date,
): ParsedTime | null {
  try {
    const results = chrono.parse(text, referenceDate ?? new Date(), {
      forwardDate: true,
    });

    if (results.length === 0) {
      logger.debug(`No time found in natural language: "${text}"`);
      return null;
    }

    // Take the first (most confident) result
    const result = results[0];
    if (result == null) {
      return null;
    }

    const date = result.start.date();
    const now = referenceDate ?? new Date();

    // If parsed date is in the past, return null
    if (date < now) {
      logger.debug(
        `Parsed time is in the past: "${text}" -> ${date.toISOString()}`,
        {
          now,
          date,
        },
      );
      return null;
    }

    // Map chrono confidence to our scale
    // chrono doesn't expose confidence directly, so we infer from the result
    let confidence: "high" | "medium" | "low" = "medium";

    // High confidence: explicit dates/times
    if (result.start.isCertain("hour") && result.start.isCertain("day")) {
      confidence = "high";
    }
    // Low confidence: vague references
    else if (!result.start.isCertain("day")) {
      confidence = "low";
    }

    return {
      date,
      confidence,
      originalText: text,
      parsedText: result.text,
    };
  } catch (error) {
    logger.error(`Failed to parse natural language time: "${text}"`, {
      error: String(error),
    });
    return null;
  }
}

/**
 * Check if a natural language expression might be a recurring schedule
 * Returns suggested cron pattern if it seems recurring
 */
export function detectRecurringPattern(text: string): string | null {
  const lower = text.toLowerCase().trim();

  // Common recurring patterns
  const patterns: Record<string, string> = {
    "every minute": "* * * * *",
    "every hour": "0 * * * *",
    hourly: "0 * * * *",
    "every day": "0 0 * * *",
    daily: "0 0 * * *",
    "every week": "0 0 * * 0",
    weekly: "0 0 * * 0",
    "every month": "0 0 1 * *",
    monthly: "0 0 1 * *",
    "every monday": "0 0 * * 1",
    "every tuesday": "0 0 * * 2",
    "every wednesday": "0 0 * * 3",
    "every thursday": "0 0 * * 4",
    "every friday": "0 0 * * 5",
    "every saturday": "0 0 * * 6",
    "every sunday": "0 0 * * 0",
  };

  for (const [phrase, cron] of Object.entries(patterns)) {
    if (lower.includes(phrase)) {
      return cron;
    }
  }

  return null;
}

/**
 * Parse time with multiple strategies
 * 1. Try as cron pattern
 * 2. Try as natural language
 * 3. Try as ISO date string
 */
export function parseFlexibleTime(
  text: string,
  referenceDate?: Date,
): { type: "cron" | "date"; value: string | Date } | null {
  // Strategy 1: Check if it looks like a cron pattern
  if (/^[\d\s*,/-]+$/.test(text.trim())) {
    const parts = text.trim().split(/\s+/);
    if (parts.length === 5) {
      return { type: "cron", value: text.trim() };
    }
  }

  // Strategy 2: Try ISO date
  try {
    const isoDate = new Date(text);
    if (!Number.isNaN(isoDate.getTime())) {
      const now = referenceDate ?? new Date();
      if (isoDate > now) {
        return { type: "date", value: isoDate };
      }
    }
  } catch {
    // Not an ISO date, continue
  }

  // Strategy 3: Natural language
  const parsed = parseNaturalTime(text, referenceDate);
  if (parsed != null) {
    return { type: "date", value: parsed.date };
  }

  return null;
}

/**
 * Format a Date into a human-readable string
 */
export function formatScheduleTime(date: Date): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  // If within 24 hours, show relative time
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

    if (hours === 0) {
      return `in ${String(minutes)} minute${minutes === 1 ? "" : "s"}`;
    }
    return `in ${String(hours)} hour${hours === 1 ? "" : "s"} and ${String(minutes)} minute${minutes === 1 ? "" : "s"}`;
  }

  // Otherwise show date and time
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
