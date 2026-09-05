import { z } from "zod";
import {
  WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_MS,
  WEEKLY_PARLAY_LIFECYCLE,
  WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS,
  WeeklyParlayControlActionSchema as ScoutWeeklyParlayActionSchema,
  type WeeklyParlayControlAction as ScoutWeeklyParlayAction,
} from "@scout-for-lol/data/model/weekly-parlay.ts";
import {
  scoutWeeklyParlayActionDurationSeconds,
  scoutWeeklyParlayActionsTotal,
} from "#observability/metrics-scout-weekly-parlay.ts";
import { createStructuredLogger } from "#observability/logging.ts";

const log = createStructuredLogger("scout-weekly-parlay");
const PACIFIC_TIME_ZONE = WEEKLY_PARLAY_LIFECYCLE.timezone;
const OPEN_HOUR = WEEKLY_PARLAY_LIFECYCLE.openHour;
const REMINDER_HOUR = WEEKLY_PARLAY_LIFECYCLE.updateHour;
const START_HOUR = WEEKLY_PARLAY_LIFECYCLE.bettingCloseHour;
const FINAL_HOUR = WEEKLY_PARLAY_LIFECYCLE.finalHour;
const UPDATE_HOUR = WEEKLY_PARLAY_LIFECYCLE.updateHour;
const UPDATE_COUNT = WEEKLY_PARLAY_LIFECYCLE.updateCount;
const OPEN_ACTION_TIMEOUT_MS = WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS;
const STANDARD_ACTION_TIMEOUT_MS = 20 * 1000;

export const ScoutWeeklyParlayTimelineSchema = z.strictObject({
  periodKey: z.iso.date(),
  openAt: z.iso.datetime(),
  reminderAt: z.iso.datetime().optional(),
  startsAt: z.iso.datetime(),
  updatesAt: z.array(z.iso.datetime()).max(UPDATE_COUNT),
  finalizesAt: z.iso.datetime(),
});
export type ScoutWeeklyParlayTimeline = z.infer<
  typeof ScoutWeeklyParlayTimelineSchema
>;

export const ScoutWeeklyParlayControlResultSchema = z.strictObject({
  status: z.enum(["reconciled", "skipped"]),
  detail: z.string(),
  marketId: z.number().int().positive().optional(),
});
export type ScoutWeeklyParlayControlResult = z.infer<
  typeof ScoutWeeklyParlayControlResultSchema
>;

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function dateOffset(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError(`Invalid calendar date ${date}.`);
  }
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function requiredPart(
  parts: ReadonlyMap<string, number>,
  key: "year" | "month" | "day" | "hour" | "minute" | "second",
): number {
  const value = parts.get(key);
  if (value === undefined) {
    throw new Error(`Missing ${key} timezone part.`);
  }
  return value;
}

function pacificWallTime(date: string, hour: number): Date {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(date);
  const groups = match?.groups;
  if (groups === undefined || !Number.isInteger(hour)) {
    throw new Error(`Invalid Pacific wall time ${date} ${hour.toString()}:00.`);
  }
  const target = {
    year: Number(groups["year"]),
    month: Number(groups["month"]),
    day: Number(groups["day"]),
    hour,
  };
  let timestamp = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
  );
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = new Map(
      formatter
        .formatToParts(new Date(timestamp))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const actualTimestamp = Date.UTC(
      requiredPart(parts, "year"),
      requiredPart(parts, "month") - 1,
      requiredPart(parts, "day"),
      requiredPart(parts, "hour"),
      requiredPart(parts, "minute"),
      requiredPart(parts, "second"),
    );
    timestamp +=
      Date.UTC(target.year, target.month - 1, target.day, target.hour) -
      actualTimestamp;
  }
  return new Date(timestamp);
}

function pacificCalendarDate(instant: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = new Map(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("Could not derive the Pacific calendar date.");
  }
  return `${year}-${month}-${day}`;
}

export function buildScoutWeeklyParlayTimeline(
  scheduledStartAt: string,
): ScoutWeeklyParlayTimeline {
  const scheduledStart = new Date(z.iso.datetime().parse(scheduledStartAt));
  const openDate = pacificCalendarDate(scheduledStart);
  const periodKey = dateOffset(openDate, 1);
  const finalDate = dateOffset(periodKey, 6);
  return ScoutWeeklyParlayTimelineSchema.parse({
    periodKey,
    openAt: pacificWallTime(openDate, OPEN_HOUR).toISOString(),
    reminderAt: pacificWallTime(openDate, REMINDER_HOUR).toISOString(),
    startsAt: pacificWallTime(periodKey, START_HOUR).toISOString(),
    updatesAt: Array.from({ length: UPDATE_COUNT }, (_, index) =>
      pacificWallTime(dateOffset(periodKey, index), UPDATE_HOUR).toISOString(),
    ),
    finalizesAt: pacificWallTime(finalDate, FINAL_HOUR).toISOString(),
  });
}

export function buildScoutWeeklyParlayCatchupTimeline(
  workflowStartAt: string,
  periodKey: string,
): ScoutWeeklyParlayTimeline {
  const workflowStart = new Date(z.iso.datetime().parse(workflowStartAt));
  const parsedPeriod = new Date(
    `${z.iso.date().parse(periodKey)}T00:00:00.000Z`,
  );
  if (parsedPeriod.getUTCDay() !== 1) {
    throw new Error(`Weekly parlay period ${periodKey} must be a Monday.`);
  }
  const standardOpen = pacificWallTime(dateOffset(periodKey, -1), OPEN_HOUR);
  const finalizesAt = pacificWallTime(dateOffset(periodKey, 6), FINAL_HOUR);
  if (workflowStart < standardOpen || workflowStart >= finalizesAt) {
    throw new Error("Catch-up workflow start is outside its weekly period.");
  }
  const earliestStart =
    workflowStart.getTime() +
    WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_MS +
    OPEN_ACTION_TIMEOUT_MS;
  const startsAt = Array.from({ length: 7 }, (_, dayOffset) =>
    pacificWallTime(dateOffset(periodKey, dayOffset), START_HOUR),
  ).find(
    (candidate) =>
      candidate.getTime() >= earliestStart && candidate < finalizesAt,
  );
  if (startsAt === undefined) {
    throw new Error("No catch-up scoring window remains before finalization.");
  }
  const actionTimes = Array.from({ length: 8 }, (_, index) =>
    pacificWallTime(dateOffset(periodKey, index - 1), UPDATE_HOUR),
  );
  const reminderAt = actionTimes.findLast(
    (candidate) => candidate > workflowStart && candidate < startsAt,
  );
  const updatesAt = actionTimes.filter(
    (candidate) => candidate >= startsAt && candidate < finalizesAt,
  );
  return ScoutWeeklyParlayTimelineSchema.parse({
    periodKey,
    openAt: workflowStart.toISOString(),
    ...(reminderAt === undefined
      ? {}
      : { reminderAt: reminderAt.toISOString() }),
    startsAt: startsAt.toISOString(),
    updatesAt: updatesAt.map((candidate) => candidate.toISOString()),
    finalizesAt: finalizesAt.toISOString(),
  });
}

export function scoutWeeklyParlayActionKey(
  action: ScoutWeeklyParlayAction,
): string {
  return [
    "scout-weekly-parlay",
    action.periodKey,
    action.slot.toString(),
    action.action,
    action.updateIndex?.toString() ?? "-",
  ].join(":");
}

export async function invokeScoutWeeklyParlayAction(
  rawAction: ScoutWeeklyParlayAction,
): Promise<ScoutWeeklyParlayControlResult> {
  const action = ScoutWeeklyParlayActionSchema.parse(rawAction);
  const startedAt = performance.now();
  let result = "error";
  try {
    const response = await fetch(
      z.url().parse(requiredEnvironment("SCOUT_WEEKLY_PARLAY_CONTROL_URL")),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requiredEnvironment("SCOUT_WEEKLY_PARLAY_CONTROL_TOKEN")}`,
          "Content-Type": "application/json",
          "Idempotency-Key": scoutWeeklyParlayActionKey(action),
        },
        body: JSON.stringify(action),
        signal: AbortSignal.timeout(
          action.action === "open"
            ? OPEN_ACTION_TIMEOUT_MS
            : STANDARD_ACTION_TIMEOUT_MS,
        ),
      },
    );
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Scout weekly parlay control returned HTTP ${response.status.toString()}: ${body.slice(0, 500)}`,
      );
    }
    const parsed = ScoutWeeklyParlayControlResultSchema.parse(JSON.parse(body));
    result = parsed.status;
    log("info", "Scout weekly parlay action completed", {
      periodKey: action.periodKey,
      slot: action.slot,
      action: action.action,
      ...(action.updateIndex === undefined
        ? {}
        : { updateIndex: action.updateIndex }),
      result: parsed.status,
      detail: parsed.detail,
    });
    return parsed;
  } finally {
    scoutWeeklyParlayActionsTotal.inc({ action: action.action, result });
    scoutWeeklyParlayActionDurationSeconds.observe(
      { action: action.action, result },
      (performance.now() - startedAt) / 1000,
    );
  }
}

export type ScoutWeeklyParlayActivities = {
  resolveScoutWeeklyParlayTimeline: (
    scheduledStartAt: string,
  ) => Promise<ScoutWeeklyParlayTimeline>;
  resolveScoutWeeklyParlayCatchupTimeline: (
    workflowStartAt: string,
    periodKey: string,
  ) => Promise<ScoutWeeklyParlayTimeline>;
  invokeScoutWeeklyParlayAction: (
    action: ScoutWeeklyParlayAction,
  ) => Promise<ScoutWeeklyParlayControlResult>;
};

export const scoutWeeklyParlayActivities = {
  resolveScoutWeeklyParlayTimeline: (
    scheduledStartAt: string,
  ): Promise<ScoutWeeklyParlayTimeline> =>
    Promise.resolve(buildScoutWeeklyParlayTimeline(scheduledStartAt)),
  resolveScoutWeeklyParlayCatchupTimeline: (
    workflowStartAt: string,
    periodKey: string,
  ): Promise<ScoutWeeklyParlayTimeline> =>
    Promise.resolve(
      buildScoutWeeklyParlayCatchupTimeline(workflowStartAt, periodKey),
    ),
  invokeScoutWeeklyParlayAction,
} satisfies ScoutWeeklyParlayActivities;
