import { match } from "ts-pattern";
import clashCupsJson from "#src/model/competitions/clash-cups.json" with { type: "json" };
import {
  ClashCupsFileSchema,
  ClashCupQueueSchema,
  type ClashCup,
  type ClashCupDay,
  type ClashCupQueue,
} from "#src/model/competitions/clash-cups.schema.ts";
import type { PlatformRoute } from "#src/model/core/routes.ts";
import { calendarDateInTimeZone } from "#src/model/core/calendar-date.ts";
import type { QueueType } from "#src/model/core/state.ts";

const cupsFile = ClashCupsFileSchema.parse(clashCupsJson);

export const CLASH_CUPS: readonly ClashCup[] = cupsFile.cups;

export type ClashCupMatch = {
  nameKey: string;
  cupDay: ClashCupDay;
  queue: ClashCupQueue;
};

export function platformToClashTimezone(platform: PlatformRoute): string {
  return match(platform)
    .with("NA1", "PBE1", () => "America/Los_Angeles")
    .with("BR1", () => "America/Sao_Paulo")
    .with("LA1", () => "America/Mexico_City")
    .with("LA2", () => "America/Argentina/Buenos_Aires")
    .with("EUW1", () => "Europe/Paris")
    .with("EUN1", () => "Europe/Bucharest")
    .with("TR1", () => "Europe/Istanbul")
    .with("RU", () => "Europe/Moscow")
    .with("ME1", () => "Asia/Riyadh")
    .with("KR", () => "Asia/Seoul")
    .with("JP1", () => "Asia/Tokyo")
    .with("OC1", () => "Australia/Sydney")
    .with("SG2", () => "Asia/Singapore")
    .with("TW2", () => "Asia/Taipei")
    .with("VN2", () => "Asia/Ho_Chi_Minh")
    .exhaustive();
}

export function clashCalendarDateForPlatform(
  at: Date,
  platform: PlatformRoute,
): string {
  return calendarDateInTimeZone(at, platformToClashTimezone(platform));
}

export function clashIsoWeekKey(dateOnly: string): string {
  const [yearText, monthText, dayText] = dateOnly.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - dayNum + 3);
  const weekYear = utc.getUTCFullYear();
  const jan4 = new Date(Date.UTC(weekYear, 0, 4));
  const week =
    1 +
    Math.round((utc.getTime() - jan4.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${weekYear.toString()}-W${week.toString().padStart(2, "0")}`;
}

function cupAllowsPlatform(cup: ClashCup, platform: PlatformRoute): boolean {
  return cup.shards === undefined || cup.shards.includes(platform);
}

function cupDayForDate(cup: ClashCup, date: string): ClashCupDay | undefined {
  return date === cup.saturday
    ? "day_1"
    : cup.sunday !== null && date === cup.sunday
      ? "day_2"
      : undefined;
}

export function clashQueueFromQueueType(
  queue: QueueType,
): ClashCupQueue | undefined {
  const parsed = ClashCupQueueSchema.safeParse(queue);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Best-effort cup for a Clash lobby or finished match Scout already saw.
 *
 * Matches the platform-local calendar date + queue. Regional makeup cups
 * require `platform` to be in `shards`. Does not invent a team name.
 */
export function resolveClashCupFromCalendar(input: {
  queue: QueueType;
  at: Date;
  platform: PlatformRoute;
}): ClashCupMatch | undefined {
  const queue = clashQueueFromQueueType(input.queue);
  if (queue === undefined) {
    return undefined;
  }
  const date = clashCalendarDateForPlatform(input.at, input.platform);
  for (const cup of CLASH_CUPS) {
    if (cup.queue !== queue) {
      continue;
    }
    if (!cupAllowsPlatform(cup, input.platform)) {
      continue;
    }
    const cupDay = cupDayForDate(cup, date);
    if (cupDay === undefined) {
      continue;
    }
    return { nameKey: cup.nameKey, cupDay, queue: cup.queue };
  }
  return undefined;
}
