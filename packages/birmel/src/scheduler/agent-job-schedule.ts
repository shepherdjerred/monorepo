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

const EVERY_PATTERN =
  /^(?:every\s+)?(?<amount>\d+)\s*(?<unit>second|seconds|sec|secs|s|minute|minutes|min|mins|m|hour|hours|hr|hrs|h|day|days|d|week|weeks|w)$/i;

function durationToMilliseconds(value: string): number | null {
  const match = EVERY_PATTERN.exec(value.trim());
  const groups = match?.groups;
  if (groups == null) {
    return null;
  }
  const amount = Number(groups.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }
  const unit = groups.unit.toLowerCase();
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
  if (parsed == null || parsed.type !== "date" || !(parsed.value instanceof Date)) {
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
