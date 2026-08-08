import { z } from "zod";
import {
  getNextCronRun,
  isValidCron,
} from "@shepherdjerred/birmel/scheduler/utils/cron.ts";
import { parseFlexibleTime } from "@shepherdjerred/birmel/scheduler/utils/time-parser.ts";

export const AgentJobScheduleKindSchema = z.enum(["at", "every", "cron"]);
export type AgentJobScheduleKind = z.infer<typeof AgentJobScheduleKindSchema>;

export type ResolvedAgentJobSchedule = {
  scheduleKind: AgentJobScheduleKind;
  scheduleValue: string;
  timezone: string;
  nextRunAt: Date;
};

export type AgentJobFailureTransition = {
  jobStatus: "active" | "failed" | "retrying";
  runStatus: "error" | "failed";
  nextRunAt: Date | null;
  attemptCount: number;
};

const EVERY_PATTERN =
  /^(?:every\s+)?(?<amount>\d+)\s*(?<unit>second|seconds|sec|secs|s|minute|minutes|min|mins|m|hour|hours|hr|hrs|h|day|days|d|week|weeks|w)$/i;

function durationToMilliseconds(value: string): number | null {
  const match = EVERY_PATTERN.exec(value.trim());
  const groups = match?.groups;
  if (groups == null) {
    return null;
  }
  const amount = Number(groups["amount"]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }
  const unitValue = groups["unit"];
  if (unitValue == null) {
    return null;
  }
  const unit = unitValue.toLowerCase();
  if (["second", "seconds", "sec", "secs", "s"].includes(unit)) {
    return amount * 1000;
  }
  if (["minute", "minutes", "min", "mins", "m"].includes(unit)) {
    return amount * 60 * 1000;
  }
  if (["hour", "hours", "hr", "hrs", "h"].includes(unit)) {
    return amount * 60 * 60 * 1000;
  }
  if (["day", "days", "d"].includes(unit)) {
    return amount * 24 * 60 * 60 * 1000;
  }
  if (["week", "weeks", "w"].includes(unit)) {
    return amount * 7 * 24 * 60 * 60 * 1000;
  }
  return null;
}

export function inferAgentJobScheduleKind(value: string): AgentJobScheduleKind {
  const trimmed = value.trim();
  if (/^[\d\s*,/-]+$/.test(trimmed) && trimmed.split(/\s+/).length === 5) {
    return "cron";
  }
  if (/^every\s+/i.test(trimmed) || /^\d+\s*[smhdw]$/i.test(trimmed)) {
    return "every";
  }
  return "at";
}

export function resolveAgentJobSchedule(options: {
  scheduleKind: AgentJobScheduleKind;
  scheduleValue: string;
  timezone?: string | undefined;
  from?: Date | undefined;
}): ResolvedAgentJobSchedule {
  const timezone = options.timezone ?? "UTC";
  const from = options.from ?? new Date();
  const value = options.scheduleValue.trim();
  if (value.length === 0) {
    throw new Error("scheduleValue is required");
  }

  if (options.scheduleKind === "cron") {
    if (!isValidCron(value)) {
      throw new Error(`Invalid cron expression: ${value}`);
    }
    return {
      scheduleKind: "cron",
      scheduleValue: value,
      timezone,
      nextRunAt: getNextCronRun(value, from, timezone),
    };
  }

  if (options.scheduleKind === "every") {
    const durationMs = durationToMilliseconds(value);
    if (durationMs == null) {
      throw new Error(
        "every schedules must look like '15m', '2 hours', or 'every 1 day'",
      );
    }
    return {
      scheduleKind: "every",
      scheduleValue: value,
      timezone,
      nextRunAt: new Date(from.getTime() + durationMs),
    };
  }

  const parsed = parseFlexibleTime(value, from);
  if (parsed?.type !== "date" || !(parsed.value instanceof Date)) {
    throw new Error(`Could not parse at schedule: ${value}`);
  }
  return {
    scheduleKind: "at",
    scheduleValue: value,
    timezone,
    nextRunAt: parsed.value,
  };
}

export function getNextAgentJobRun(options: {
  scheduleKind: AgentJobScheduleKind;
  scheduleValue: string;
  timezone: string;
  from?: Date | undefined;
}): Date | null {
  if (options.scheduleKind === "at") {
    return null;
  }
  return resolveAgentJobSchedule({
    scheduleKind: options.scheduleKind,
    scheduleValue: options.scheduleValue,
    timezone: options.timezone,
    from: options.from,
  }).nextRunAt;
}

export function getAgentJobFailureTransition(options: {
  scheduleKind: AgentJobScheduleKind;
  scheduleValue: string;
  timezone: string;
  currentAttemptCount: number;
  maxAttempts: number;
  finishedAt: Date;
}): AgentJobFailureTransition {
  const nextAttemptCount = options.currentAttemptCount + 1;
  const shouldRetry = nextAttemptCount < options.maxAttempts;
  const boundedAttempt = Math.min(Math.max(nextAttemptCount, 1), 6);
  const retryAt = new Date(
    options.finishedAt.getTime() + 30_000 * 2 ** (boundedAttempt - 1),
  );
  const recurringRun = getNextAgentJobRun({
    scheduleKind: options.scheduleKind,
    scheduleValue: options.scheduleValue,
    timezone: options.timezone,
    from: options.finishedAt,
  });
  const nextRunAt = shouldRetry ? retryAt : recurringRun;
  return {
    jobStatus: shouldRetry
      ? "retrying"
      : nextRunAt == null
        ? "failed"
        : "active",
    runStatus: shouldRetry ? "error" : "failed",
    nextRunAt,
    attemptCount: shouldRetry ? nextAttemptCount : 0,
  };
}

export async function withAgentJobTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Agent job timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
