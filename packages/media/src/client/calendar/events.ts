import type { CalendarEvent } from "#shared/household/calendar.ts";
import { RELEASE_KIND_COPY } from "#client/presentation/calendar.ts";
import type { CivilDate } from "./dates.ts";

/** A page of releases sorted onto their days. */
export type ReleaseDays = {
  /** Each day that has releases, keyed by the date exactly as the API sent it. */
  days: ReadonlyMap<CivilDate, readonly CalendarEvent[]>;
  /** Releases with no date yet. They belong to no day and are never guessed onto one. */
  undated: readonly CalendarEvent[];
};

/** The name a release goes by: its series for an episode, itself for a film. */
export function releaseTitle(event: CalendarEvent): string {
  return event.seriesTitle ?? event.title;
}

function byTitle(left: CalendarEvent, right: CalendarEvent): number {
  return (
    releaseTitle(left).localeCompare(releaseTitle(right)) ||
    (left.seasonNumber ?? 0) - (right.seasonNumber ?? 0) ||
    (left.episodeNumber ?? 0) - (right.episodeNumber ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Sorts releases onto their days. A date is used as the key it arrived as:
 * it is never read as a moment, so no time zone can move a release to the
 * day before or after.
 */
export function releaseDays(events: readonly CalendarEvent[]): ReleaseDays {
  const days = new Map<CivilDate, CalendarEvent[]>();
  const undated: CalendarEvent[] = [];
  for (const event of events) {
    if (event.date === null) {
      undated.push(event);
      continue;
    }
    const day = days.get(event.date);
    if (day === undefined) days.set(event.date, [event]);
    else day.push(event);
  }
  for (const day of days.values()) day.sort(byTitle);
  undated.sort(byTitle);
  return { days, undated };
}

/** Which episode a release is, when the catalog has numbered it. */
function episodeNumbers(
  event: CalendarEvent,
): { season: number; episode: number } | null {
  return event.seasonNumber === null || event.episodeNumber === null
    ? null
    : { season: event.seasonNumber, episode: event.episodeNumber };
}

/**
 * What a release is, in a sentence's worth: which episode, or which kind of
 * film release.
 */
export function releaseDetail(event: CalendarEvent): string {
  if (event.kind !== "episode") return RELEASE_KIND_COPY[event.kind].label;
  const numbers = episodeNumbers(event);
  return numbers === null
    ? event.title
    : `Season ${String(numbers.season)}, episode ${String(numbers.episode)}: ${event.title}`;
}

/** The same in the room a calendar square has: "S2 E7", or the kind. */
export function releaseShortDetail(event: CalendarEvent): string {
  if (event.kind !== "episode") return RELEASE_KIND_COPY[event.kind].label;
  const numbers = episodeNumbers(event);
  return numbers === null
    ? event.title
    : `S${String(numbers.season)} E${String(numbers.episode)}`;
}

/** How many releases, in words: "1 release", "3 releases". */
export function releaseCount(count: number): string {
  return count === 1 ? "1 release" : `${String(count)} releases`;
}

/** How many releases of a day a calendar square lists before it says "more". */
const SQUARE_ROOM = 3;

/**
 * The releases a square lists and how many it leaves for the agenda. A day
 * that fits is listed whole; a fuller one gives its last line to the count.
 */
export function squareReleases(events: readonly CalendarEvent[]): {
  listed: readonly CalendarEvent[];
  more: number;
} {
  if (events.length <= SQUARE_ROOM) return { listed: events, more: 0 };
  const listed = events.slice(0, SQUARE_ROOM - 1);
  return { listed, more: events.length - listed.length };
}
