import { z } from "zod";
import {
  WEEKLY_PARLAY_LIFECYCLE,
  WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS,
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

export const ScoutWeeklyParlayActionSchema = z
  .strictObject({
    periodKey: z.iso.date(),
    slot: z.number().int().nonnegative().default(0),
    action: z.enum(WEEKLY_PARLAY_LIFECYCLE.actions),
    updateIndex: z
      .number()
      .int()
      .min(0)
      .max(UPDATE_COUNT - 1)
      .optional(),
  })
  .superRefine((action, context) => {
    if (action.action === "progress" && action.updateIndex === undefined) {
      context.addIssue({
        code: "custom",
        path: ["updateIndex"],
        message: "Progress actions require an update index.",
      });
    }
    if (action.action !== "progress" && action.updateIndex !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["updateIndex"],
        message: "Only progress actions accept an update index.",
      });
    }
  });
export type ScoutWeeklyParlayAction = z.infer<
  typeof ScoutWeeklyParlayActionSchema
>;

export const ScoutWeeklyParlayTimelineSchema = z.strictObject({
  periodKey: z.iso.date(),
  openAt: z.iso.datetime(),
  reminderAt: z.iso.datetime(),
  startsAt: z.iso.datetime(),
  updatesAt: z.array(z.iso.datetime()).length(UPDATE_COUNT),
  finalizesAt: z.iso.datetime(),
});
export type ScoutWeeklyParlayTimeline = z.infer<
  typeof ScoutWeeklyParlayTimelineSchema
>;

const ScoutWeeklyParlayControlResultSchema = z.strictObject({
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
        // Opening can deterministically replay player history and generate a
        // priced market, so it needs more time than the bounded reminder and
        // settlement calls. The activity timeout is sized to cover this
        // request and still lets Temporal retry a genuinely unavailable Scout.
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
  invokeScoutWeeklyParlayAction: (
    action: ScoutWeeklyParlayAction,
  ) => Promise<ScoutWeeklyParlayControlResult>;
};

export const scoutWeeklyParlayActivities = {
  resolveScoutWeeklyParlayTimeline: (
    scheduledStartAt: string,
  ): Promise<ScoutWeeklyParlayTimeline> =>
    Promise.resolve(buildScoutWeeklyParlayTimeline(scheduledStartAt)),
  invokeScoutWeeklyParlayAction,
} satisfies ScoutWeeklyParlayActivities;
