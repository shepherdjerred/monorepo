import { formatRiotId } from "#src/lib/format/riot-id-format.ts";
import { regionName } from "#src/lib/regions.ts";
import { compactPoints } from "#src/lib/champions/champion-pages.ts";
import type { PlayerSummary } from "#src/lib/player/player-page.ts";

type Accounts = PlayerSummary["accounts"];

/** "A, B and C". */
export function joinWithAnd(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/** "Northstar#NA1 and MapleCarry#NOVA, both in North America." */
export function accountsSentence(accounts: Accounts): string {
  const named = accounts.map((account) => ({
    name: formatRiotId(account, "Riot ID pending"),
    region: regionName(account.region),
  }));
  const regions = [...new Set(named.map((account) => account.region))];
  const only = regions[0];
  if (only !== undefined && regions.length === 1) {
    const where =
      named.length === 1 ? "in" : named.length === 2 ? "both in" : "all in";
    return `${joinWithAnd(named.map((account) => account.name))}, ${where} ${only}.`;
  }
  return `${joinWithAnd(named.map((account) => `${account.name} in ${account.region}`))}.`;
}

/** "Ahri is the highest, level 12 with 412K points." Undefined without mastery. */
export function masterySentence(accounts: Accounts): string | undefined {
  const top = accounts
    .flatMap((account) => account.mastery?.champions ?? [])
    .toSorted(
      (left, right) =>
        right.points - left.points ||
        left.championName.localeCompare(right.championName),
    )[0];
  return top === undefined
    ? undefined
    : `${top.championName} is the highest, level ${top.level.toString()} with ${compactPoints(top.points)} points.`;
}

/** The fewest games that say anything about when someone plays. */
export const MIN_GAMES_FOR_PLAY_TIMES = 10;
const MIN_PART_SHARE = 0.4;
const MIN_DAY_SHARE = 0.25;

type DayPart = "mornings" | "afternoons" | "evenings" | "nights";

function partOfDay(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "mornings";
  if (hour >= 12 && hour < 17) return "afternoons";
  return hour >= 17 && hour < 22 ? "evenings" : "nights";
}

function mostCommon(values: readonly string[]): {
  value: string;
  share: number;
} | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const [top] = [...counts.entries()].toSorted(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  return top === undefined
    ? null
    : { value: top[0], share: top[1] / values.length };
}

/**
 * "Mostly evenings, and most of all on Saturdays." from the times of the
 * games read. A pattern too even to name leaves its half out; with neither,
 * or too few games, undefined.
 */
export function playTimesSentence(
  gameTimesMs: readonly number[],
  timeZone?: string,
): string | undefined {
  if (gameTimesMs.length < MIN_GAMES_FOR_PLAY_TIMES) return undefined;
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    weekday: "long",
    ...(timeZone === undefined ? {} : { timeZone }),
  });
  const seen = gameTimesMs.map((at) => {
    const parts = clock.formatToParts(at);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const day = parts.find((part) => part.type === "weekday")?.value ?? "";
    return { part: partOfDay(hour), day };
  });
  const part = mostCommon(seen.map((game) => game.part));
  const day = mostCommon(seen.map((game) => game.day));
  const timeText =
    part !== null && part.share >= MIN_PART_SHARE
      ? `Mostly ${part.value}`
      : undefined;
  const dayText =
    day !== null && day.share >= MIN_DAY_SHARE ? `${day.value}s` : undefined;
  if (timeText !== undefined && dayText !== undefined) {
    return `${timeText}, and most of all on ${dayText}.`;
  }
  if (timeText !== undefined) return `${timeText}.`;
  return dayText === undefined ? undefined : `Most often on ${dayText}.`;
}
