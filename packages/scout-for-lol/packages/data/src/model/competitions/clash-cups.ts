import clashCupsJson from "#src/model/competitions/clash-cups.json" with { type: "json" };
import {
  ClashCupsFileSchema,
  ClashCupQueueSchema,
  type ClashCup,
  type ClashCupDay,
  type ClashCupQueue,
} from "#src/model/competitions/clash-cups.schema.ts";
import type { PlatformRoute } from "#src/model/core/routes.ts";
import type { QueueType } from "#src/model/core/state.ts";

const cupsFile = ClashCupsFileSchema.parse(clashCupsJson);

export const CLASH_CUPS: readonly ClashCup[] = cupsFile.cups;

export type ClashCupMatch = {
  nameKey: string;
  cupDay: ClashCupDay;
  queue: ClashCupQueue;
};

function utcDateOnly(at: Date): string {
  const year = at.getUTCFullYear().toString();
  const month = (at.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = at.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cupAllowsPlatform(cup: ClashCup, platform: PlatformRoute): boolean {
  if (cup.shards === undefined) {
    return true;
  }
  return cup.shards.includes(platform);
}

function cupDayForDate(cup: ClashCup, date: string): ClashCupDay | undefined {
  if (date === cup.saturday) {
    return "day_1";
  }
  if (cup.sunday !== null && date === cup.sunday) {
    return "day_2";
  }
  return undefined;
}

export function clashQueueFromQueueType(
  queue: QueueType,
): ClashCupQueue | undefined {
  const parsed = ClashCupQueueSchema.safeParse(queue);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

/**
 * Best-effort cup for a Clash lobby or finished match Scout already saw.
 *
 * Matches UTC calendar date + queue. Regional makeup cups require `platform`
 * to be in `shards`. Does not invent a team name.
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
  const date = utcDateOnly(input.at);
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
