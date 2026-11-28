import type { MetaContext } from "@scout-for-lol/data/meta/meta-serving.ts";
import { bracketLabel, queueLabel } from "./snapshot.ts";
import type { SnapshotIndex } from "./snapshot-v2-schema.ts";

/**
 * The one context line a public page states: the games, the patch, the queue,
 * the rank bracket and the days the games were played. It is built from what
 * the snapshot records, so the page cannot claim a window or bracket it does
 * not hold.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

type Day = { year: number; month: number; day: number };

function parseDay(value: string): Day {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const month = Number(match?.[2]);
  if (match === null || month < 1 || month > 12) {
    throw new Error(`Snapshot day ${value} is not YYYY-MM-DD`);
  }
  return { year: Number(match[1]), month, day: Number(match[3]) };
}

function dayText(day: Day, withYear: boolean): string {
  const month = MONTHS[day.month - 1];
  if (month === undefined) {
    throw new Error(`Month ${day.month.toString()} is not 1 to 12`);
  }
  return `${day.day.toString()} ${month}${withYear ? ` ${day.year.toString()}` : ""}`;
}

/** "7 to 20 Nov", "28 Oct to 20 Nov", "30 Dec 2026 to 12 Jan 2027". */
export function dayRange(firstDay: string, lastDay: string): string {
  const first = parseDay(firstDay);
  const last = parseDay(lastDay);
  if (firstDay === lastDay) return dayText(first, false);
  if (first.year !== last.year) {
    return `${dayText(first, true)} to ${dayText(last, true)}`;
  }
  return first.month === last.month
    ? `${first.day.toString()} to ${dayText(last, false)}`
    : `${dayText(first, false)} to ${dayText(last, false)}`;
}

export function contextWords(context: MetaContext): string {
  return `patch ${context.patch}, ${queueLabel(context.queue)}, ${bracketLabel(context.bracket)}`;
}

function sourceOf(index: SnapshotIndex) {
  if (index.source === null || index.context === null) {
    throw new Error("A snapshot with champions states its source and context");
  }
  return { source: index.source, context: index.context };
}

/** The window the games were played in, for example "7 to 20 Nov". */
export function gamesWindow(index: SnapshotIndex): string {
  const { source } = sourceOf(index);
  return dayRange(source.firstDay, source.lastDay);
}

/** The lane window when it is narrower than the games', otherwise null. */
export function laneWindow(index: SnapshotIndex): string | null {
  const { source } = sourceOf(index);
  if (source.lane === null) return null;
  return source.lane.firstDay === source.firstDay &&
    source.lane.lastDay === source.lastDay
    ? null
    : dayRange(source.lane.firstDay, source.lane.lastDay);
}

/** "Patch 16.23, Ranked Solo/Duo, Emerald to Diamond, 7 to 20 Nov." */
export function indexContextLine(index: SnapshotIndex): string {
  const { context } = sourceOf(index);
  const words = contextWords(context);
  const lane = laneWindow(index);
  const line = `${words.charAt(0).toUpperCase()}${words.slice(1)}, ${gamesWindow(index)}.`;
  return lane === null ? line : `${line} Lane figures from ${lane}.`;
}

/** "From 12,480 games on patch 16.23, Ranked Solo/Duo, Emerald to Diamond, 7 to 20 Nov." */
export function championContextLine(
  games: number,
  index: SnapshotIndex,
  hasLane: boolean,
): string {
  const { context } = sourceOf(index);
  const line = `From ${games.toLocaleString("en-US")} ${games === 1 ? "game" : "games"} on ${contextWords(context)}, ${gamesWindow(index)}.`;
  const lane = hasLane ? laneWindow(index) : null;
  return lane === null ? line : `${line} Lane figures from ${lane}.`;
}
