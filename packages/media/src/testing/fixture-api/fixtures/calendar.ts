import type { z } from "zod";
import type { Availability } from "#shared/contract.ts";
import {
  CalendarCursorSchema,
  CalendarQuerySchema,
  type CalendarEventSchema,
  type CalendarPageSchema,
} from "#shared/household/calendar.ts";
import type { FixtureScenario } from "#testing/fixture-api/scenario.ts";
import { DAY, HOUR, NOW, ago } from "#testing/fixture-api/support.ts";
import { storedArtwork } from "./artwork.ts";
import { AIRING_EPISODES, episodeId, titleNamed } from "./titles.ts";

type CalendarEvent = z.input<typeof CalendarEventSchema>;
type CalendarPage = z.input<typeof CalendarPageSchema>;
type MovieReleaseKind = Exclude<CalendarEvent["kind"], "episode">;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A civil date in the current month, or one a number of months before or
 * after it, matching how the calendar page asks.
 */
function dayOfMonth(day: number, monthsFromNow = 0): string {
  const today = new Date(NOW);
  const month = today.getFullYear() * 12 + today.getMonth() + monthsFromNow;
  return `${String(Math.floor(month / 12))}-${twoDigits((month % 12) + 1)}-${twoDigits(day)}`;
}

function episodeEvents(): CalendarEvent[] {
  return AIRING_EPISODES.map((airing) => {
    const id = episodeId(airing.title, airing.season, airing.episode);
    return {
      id: `air:${id}`,
      mediaId: id,
      rootMediaId: airing.title.id,
      artwork: storedArtwork(airing.title),
      title: airing.name,
      seriesTitle: airing.title.title,
      seasonNumber: airing.season,
      episodeNumber: airing.episode,
      kind: "episode",
      region: null,
      date: dayOfMonth(airing.day),
      precision: "day",
      availability: airing.availability,
      observedAt: ago(5 * HOUR),
    };
  });
}

type MovieReleaseSeed = readonly [
  title: string,
  kind: MovieReleaseKind,
  /** Day of the current month, or null when the provider has no date yet. */
  day: number | null,
  availability: Availability,
  /** Months from the current one; the current month when left out. */
  monthsFromNow?: number,
];

/** The day of the current month with more releases than a square lists. */
export const BUSY_DAY = 20;

const MOVIE_RELEASES: readonly MovieReleaseSeed[] = [
  ["Anora", "digital", 10, "searching"],
  ["Anora", "physical", 24, "searching"],
  ["Oppenheimer", "physical", 17, "wanted"],
  ["Dune: Part Two", "physical", 3, "available"],
  ["Arrival", "digital", 19, "downloading"],
  ["The Social Network", "theatrical", 20, "wanted"],
  ["Past Lives", "digital", 26, "available"],
  ["Poor Things", "theatrical", 8, "available"],
  // With the two episodes that air that day, five releases on one day.
  ["Parasite", "physical", BUSY_DAY, "available"],
  ["Spirited Away", "digital", BUSY_DAY, "available"],
  // The months either side, so stepping through the calendar finds something.
  ["Poor Things", "digital", 22, "available", -1],
  ["Oppenheimer", "digital", 5, "wanted", 1],
  ["The Social Network", "physical", 14, "wanted", 1],
  // No date yet: these belong to no day of any month.
  ["The Holdovers", "theatrical", null, "quarantined"],
  ["Anatomy of a Fall", "physical", null, "importing"],
];

function movieEvents(): CalendarEvent[] {
  return MOVIE_RELEASES.map(
    ([name, kind, day, availability, monthsFromNow]) => {
      const title = titleNamed(name);
      return {
        id: `release:${title.id}:${kind}:${String(monthsFromNow ?? 0)}`,
        mediaId: title.id,
        rootMediaId: title.id,
        artwork: storedArtwork(title),
        title: title.title,
        seriesTitle: null,
        seasonNumber: null,
        episodeNumber: null,
        kind,
        region: "US",
        date: day === null ? null : dayOfMonth(day, monthsFromNow),
        precision: day === null ? "unknown" : "day",
        availability,
        observedAt: day === null ? null : ago(DAY),
      };
    },
  );
}

/** In the order the API reads them: by date, the undated last, then by id. */
const EVENTS: readonly CalendarEvent[] = [
  ...episodeEvents(),
  ...movieEvents(),
].sort((left, right) => {
  if (left.date !== right.date) {
    if (left.date === null) return 1;
    return right.date === null ? -1 : left.date.localeCompare(right.date);
  }
  return left.id.localeCompare(right.id);
});

/**
 * The episodes and film releases of a range, filtered and paged like the
 * server does: releases with no date come back for every range, and a page
 * that is cut short names the release the next one starts after.
 */
export function calendarPage(
  parameters: URLSearchParams,
  scenario: FixtureScenario,
): CalendarPage {
  const query = CalendarQuerySchema.parse(Object.fromEntries(parameters));
  // A household that has asked for nothing has nothing with a date.
  const known = scenario === "new-household" ? [] : EVENTS;
  const matching = known.filter((event) => {
    return (
      (event.date === null ||
        (event.date >= query.from && event.date <= query.to)) &&
      (query.kind === "all" || event.kind === query.kind) &&
      (query.status === "all" ||
        (query.status === "available") === (event.availability === "available"))
    );
  });
  let start = 0;
  if (query.cursor !== null) {
    const after = CalendarCursorSchema.parse(JSON.parse(query.cursor));
    const position = matching.findIndex((event) => event.id === after.id);
    if (position === -1) {
      throw new Error(`Calendar cursor names an unknown release ${after.id}`);
    }
    start = position + 1;
  }
  const events = matching.slice(start, start + query.limit);
  const last = events.at(-1);
  return {
    events,
    nextCursor:
      last !== undefined && start + query.limit < matching.length
        ? JSON.stringify({ date: last.date, id: last.id })
        : null,
  };
}
