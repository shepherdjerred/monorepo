import type { z } from "zod";
import type { CalendarEvent } from "#shared/household/calendar.ts";
import type { RecoveryListSchema } from "#shared/recovery.ts";
import { dayLabel, shiftDays, type CivilDate } from "#client/calendar/dates.ts";
import { releaseDays } from "#client/calendar/events.ts";
import type { LeavingEntry } from "#client/library/keep-run.ts";
import {
  awaitsAnswer,
  type Interest,
  type Request,
} from "#client/library/mine-model.ts";
import type { Copy } from "#client/presentation/copy.ts";
import { IN_FLIGHT_COPY } from "#client/presentation/progress.ts";
import { ASKED_FOR_COPY } from "#client/presentation/request.ts";

/*
 * What each section of Home shows, worked out from the read it comes from.
 * Everything here is a pure function of the read's answer, so it can run as
 * a query's `select`: an answer this client cannot make sense of then fails
 * that one section instead of the page.
 */

/** What a request asks for, in the words of the person who made it. */
function askedFor(request: Request): string {
  return ASKED_FOR_COPY[request.media.kind](request.media, {
    future: request.includeFutureEpisodes,
    specials: request.includeSpecials,
  });
}

/** A "still watching?" check that is waiting on the reader. */
export type InterestCheck = {
  interest: Interest;
  /** The film or series the check is about, and where its page is. */
  rootMediaId: string;
  name: string;
  /** The season or episode asked for, when it was not the whole title. */
  part: string | null;
  posterPath: string | null;
};

/**
 * The reader's own checks that still want an answer, the one with the
 * nearest deadline first and the ones with no deadline yet last.
 *
 * An interest names only what was asked for ("Season 2"); the request with
 * the same id names the series. `requests` may be empty while that read is
 * on its way, and a check then goes by its interest's own name.
 */
export function interestChecks(
  interests: readonly Interest[],
  requests: readonly Request[],
  userId: string,
): InterestCheck[] {
  const byId = new Map(requests.map((request) => [request.id, request]));
  return interests
    .filter((interest) => interest.userId === userId && awaitsAnswer(interest))
    .map((interest): InterestCheck => {
      const request = byId.get(interest.requestId);
      return {
        interest,
        rootMediaId: request?.rootMediaId ?? interest.mediaId,
        name: request?.rootTitle ?? interest.title,
        part:
          request !== undefined && request.mediaId !== request.rootMediaId
            ? askedFor(request)
            : null,
        posterPath:
          interest.artwork?.posterPath ?? request?.artwork.posterPath ?? null,
      };
    })
    .sort(byDeadline);
}

/** The nearest deadline first; checks with none yet last, by name. */
export function byDeadline(left: InterestCheck, right: InterestCheck): number {
  // ISO timestamps sort as text, and every one sorts before this.
  const never = "9999";
  return (
    (left.interest.replyBy ?? never).localeCompare(
      right.interest.replyBy ?? never,
    ) || left.name.localeCompare(right.name)
  );
}

type RecoveryList = z.infer<typeof RecoveryListSchema>;

/**
 * Whether a recovery review still waits on the household, by the states the
 * server gives one. The read types the state as a string; a state that is
 * not listed is a contract this client does not know.
 */
const REVIEW_IS_OPEN: Readonly<Record<string, boolean>> = {
  awaiting_responses: true,
  released: false,
};

/** Something only the library owner can decide, and the page it is on. */
export type OwnerDecision =
  | { kind: "review"; reviewId: string; titles: readonly string[] }
  | { kind: "held"; count: number };

/**
 * What waits on the owner after a restore from backup: each household
 * review that is still open, and the titles that stay protected until a
 * review covers them. Both are decided on the recovery pages.
 */
export function ownerDecisions(list: RecoveryList): OwnerDecision[] {
  const reviews = list.reviews.flatMap((review): OwnerDecision[] => {
    const open = REVIEW_IS_OPEN[review.state];
    if (open === undefined) {
      throw new Error(`Unknown recovery review state "${review.state}"`);
    }
    return open
      ? [{ kind: "review", reviewId: review.id, titles: review.titles }]
      : [];
  });
  return list.holds.length === 0
    ? reviews
    : [...reviews, { kind: "held", count: list.holds.length }];
}

/** A film or series the reader asked for that is not all there yet. */
export type OnTheWayTitle = {
  rootMediaId: string;
  name: string;
  posterPath: string | null;
  /** The step the part furthest along has reached. */
  stage: Copy;
  /** What is on the way, or how much of it has arrived. */
  detail: string;
};

/**
 * The reader's requests that are still arriving, one entry per film or
 * series, the ones furthest along first.
 *
 * A request for a series fans out to a request for each episode, and it is
 * the episodes that arrive. So where a title has episode rows they are what
 * is counted; otherwise the request itself says where it stands. The owner's
 * read lists everyone's requests, so only the reader's own are kept.
 */
export function onTheWay(
  requests: readonly Request[],
  userId: string,
): OnTheWayTitle[] {
  const titles = new Map<string, Request[]>();
  for (const request of requests) {
    if (!request.active || request.userId !== userId) continue;
    const rows = titles.get(request.rootMediaId) ?? [];
    rows.push(request);
    titles.set(request.rootMediaId, rows);
  }
  return [...titles.values()]
    .flatMap((rows) => {
      const [first] = rows;
      if (first === undefined) return [];
      const episodes = rows.filter((row) => row.media.kind === "episode");
      const counted = episodes.length > 0 ? episodes : rows;
      const arriving = counted.flatMap(
        (row) => IN_FLIGHT_COPY[row.media.availability] ?? [],
      );
      const furthest = arriving.toSorted(
        (left, right) => right.step - left.step,
      )[0];
      if (furthest === undefined) return [];
      const ready = counted.length - arriving.length;
      const asked = rows.find((row) => row.mediaId === row.rootMediaId);
      return [
        {
          step: furthest.step,
          title: {
            rootMediaId: first.rootMediaId,
            name: first.rootTitle,
            posterPath:
              rows.find((row) => row.artwork.posterPath !== null)?.artwork
                .posterPath ?? null,
            stage: { label: furthest.label, tone: furthest.tone },
            detail:
              episodes.length > 1
                ? `${String(ready)} of ${String(episodes.length)} episodes ready to watch`
                : askedFor(asked ?? first),
          } satisfies OnTheWayTitle,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.step - left.step ||
        left.title.name.localeCompare(right.title.name),
    )
    .map(({ title }) => title);
}

/** No title is listed while this many others leave sooner. */
export const LEAVING_SHOWN = 3;

/**
 * The entries of Leaving soon that Home shows: the titles that leave first,
 * and every entry a "keep all" has a report on, wherever it stands in the
 * list, so a report is never dropped by a title moving up.
 */
export function soonestEntries(
  entries: readonly LeavingEntry[],
): LeavingEntry[] {
  return entries.filter(
    (entry, index) => index < LEAVING_SHOWN || entry.run !== null,
  );
}

/** Home's week is today and the six days after it. */
export const WEEK_DAYS = 7;

/** The first and last day of the week that starts today. */
export function weekFrom(today: CivilDate): { from: CivilDate; to: CivilDate } {
  return { from: today, to: shiftDays(today, WEEK_DAYS - 1) };
}

/** One day of the week ahead that has something coming out. */
export type WeekDay = { date: CivilDate; events: readonly CalendarEvent[] };

/**
 * What comes out in the seven days from `today`, a day at a time, sorted
 * onto its days as the Calendar sorts them. The calendar read also lists
 * releases with no date yet, whatever range is asked for, and a cached
 * answer may be an earlier day's; neither is this week's.
 */
export function thisWeek(
  events: readonly CalendarEvent[],
  today: CivilDate,
): WeekDay[] {
  const { from, to } = weekFrom(today);
  return [...releaseDays(events).days]
    .filter(([date]) => date >= from && date <= to)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, listed]) => ({ date, events: listed }));
}

/**
 * The first `limit` releases of a week, still a day at a time, and how many
 * were left out for the calendar to show.
 */
export function firstOfWeek(
  days: readonly WeekDay[],
  limit: number,
): { days: WeekDay[]; more: number } {
  const shown: WeekDay[] = [];
  let room = limit;
  let more = 0;
  for (const day of days) {
    const events = day.events.slice(0, room);
    if (events.length > 0) shown.push({ date: day.date, events });
    room -= events.length;
    more += day.events.length - events.length;
  }
  return { days: shown, more };
}

/**
 * What a day of the week ahead is called: "Today" and "Tomorrow" by how
 * near they are, with the date beside them, and any later day by its date
 * in full ("Monday, November 23").
 */
export function dayHeading(
  date: CivilDate,
  today: CivilDate,
  locale?: string,
): { name: string; date: string | null } {
  const full = dayLabel(date, locale);
  if (date === today) return { name: "Today", date: full };
  return date === shiftDays(today, 1)
    ? { name: "Tomorrow", date: full }
    : { name: full, date: null };
}

/** "31 of 51 min", for a stream that has played 31 minutes of 51. */
export function playedOf(progressMs: number, durationMs: number): string {
  const minutes = (ms: number) => String(Math.round(ms / 60_000));
  return `${minutes(Math.min(progressMs, durationMs))} of ${minutes(durationMs)} min`;
}
