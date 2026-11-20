import type { z } from "zod";
import type { Availability } from "#shared/contract.ts";
import {
  CalendarQuerySchema,
  type CalendarEventSchema,
  type CalendarPageSchema,
} from "#shared/household/calendar.ts";
import { DAY, HOUR, NOW, ago } from "#testing/fixture-api/support.ts";
import { AIRING_EPISODES, episodeId, titleNamed } from "./titles.ts";

type CalendarEvent = z.input<typeof CalendarEventSchema>;
type CalendarPage = z.input<typeof CalendarPageSchema>;
type MovieReleaseKind = Exclude<CalendarEvent["kind"], "episode">;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** A civil date in the current month, matching how the calendar page asks. */
function dayOfMonth(day: number): string {
  const today = new Date(NOW);
  return `${String(today.getFullYear())}-${twoDigits(today.getMonth() + 1)}-${twoDigits(day)}`;
}

function episodeEvents(): CalendarEvent[] {
  return AIRING_EPISODES.map((airing) => {
    const id = episodeId(airing.title, airing.season, airing.episode);
    return {
      id: `air:${id}`,
      mediaId: id,
      rootMediaId: airing.title.id,
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
];

const MOVIE_RELEASES: readonly MovieReleaseSeed[] = [
  ["Anora", "digital", 10, "searching"],
  ["Anora", "physical", 24, "searching"],
  ["Oppenheimer", "physical", 17, "wanted"],
  ["Dune: Part Two", "physical", 3, "available"],
  ["Arrival", "digital", 19, "downloading"],
  ["The Social Network", "theatrical", 20, "wanted"],
  ["Past Lives", "digital", 26, "available"],
  ["Poor Things", "theatrical", 8, "available"],
  ["The Holdovers", "theatrical", null, "quarantined"],
  ["Anatomy of a Fall", "physical", null, "importing"],
];

function movieEvents(): CalendarEvent[] {
  return MOVIE_RELEASES.map(([name, kind, day, availability]) => {
    const title = titleNamed(name);
    return {
      id: `release:${title.id}:${kind}`,
      mediaId: title.id,
      rootMediaId: title.id,
      title: title.title,
      seriesTitle: null,
      seasonNumber: null,
      episodeNumber: null,
      kind,
      region: "US",
      date: day === null ? null : dayOfMonth(day),
      precision: day === null ? "unknown" : "day",
      availability,
      observedAt: day === null ? null : ago(DAY),
    };
  });
}

const EVENTS: readonly CalendarEvent[] = [...episodeEvents(), ...movieEvents()];

/** This month's episodes and movie releases, filtered like the server does. */
export function calendarPage(parameters: URLSearchParams): CalendarPage {
  const query = CalendarQuerySchema.parse(Object.fromEntries(parameters));
  const events = EVENTS.filter((event) => {
    return (
      (event.date === null ||
        (event.date >= query.from && event.date <= query.to)) &&
      (query.kind === "all" || event.kind === query.kind) &&
      (query.status === "all" ||
        (query.status === "available") === (event.availability === "available"))
    );
  });
  return { events, nextCursor: null };
}
