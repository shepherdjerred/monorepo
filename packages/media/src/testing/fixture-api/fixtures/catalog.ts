import type { z } from "zod";
import type {
  CatalogDetailSchema,
  CatalogItemSchema,
  CatalogSearchSchema,
} from "#shared/api.ts";
import {
  CATALOG_MAX_PAGE,
  CatalogFeedSchema,
  CatalogPageSchema,
  type CatalogFeed,
  type CatalogLibraryState,
} from "#shared/catalog/contract.ts";
import {
  FixtureFailure,
  type FixtureScenario,
} from "#testing/fixture-api/scenario.ts";
import { DAY, NOW } from "#testing/fixture-api/support.ts";
import {
  backdropPath,
  catalogArtwork,
  filmRuntimeMinutes,
  posterPath,
  synopsis,
} from "./artwork.ts";
import {
  EXTERNALLY_HELD,
  libraryEpisodes,
  libraryInterest,
  libraryPolicy,
} from "./library.ts";
import { AIRINGS, TITLES, type Title } from "./titles.ts";

type CatalogItem = z.input<typeof CatalogItemSchema>;
type CatalogPage = z.input<typeof CatalogSearchSchema>;
type CatalogEntry = { item: CatalogItem; seasons: readonly number[] };

type OutsideLibrarySeed = readonly [
  title: string,
  kind: "movie" | "series",
  date: string,
  externalId: number,
  seasons: readonly number[],
];

/** Search results the household has not requested yet. */
const OUTSIDE_LIBRARY: readonly OutsideLibrarySeed[] = [
  ["The Dark Knight", "movie", "2008-07-16", 155, []],
  ["The Shining", "movie", "1980-05-23", 694, []],
  ["The Batman", "movie", "2022-03-01", 414_906, []],
  ["The Substance", "movie", "2024-09-07", 933_260, []],
  ["The Brutalist", "movie", "2024-12-20", 549_509, []],
  ["The Sopranos", "series", "1999-01-10", 1398, [13, 13, 13, 13, 13, 21]],
  [
    "The Office",
    "series",
    "2005-03-24",
    2316,
    [6, 22, 25, 19, 28, 26, 26, 24, 25],
  ],
  ["The Crown", "series", "2016-11-04", 65_494, [10, 10, 10, 10, 10, 10]],
  ["The Boys", "series", "2019-07-25", 76_479, [8, 8, 8, 8]],
  ["The Leftovers", "series", "2014-06-29", 54_344, [10, 10, 8]],
  ["The Truman Show", "movie", "1998-06-04", 37_165, []],
  ["The White Lotus", "series", "2021-07-11", 111_803, [6, 7, 8]],
  // What a browse feed mostly holds: titles nobody here has asked for. None
  // has "the" in its name, so the search the tests make is unchanged.
  ["Sinners", "movie", "2025-04-16", 1_233_413, []],
  ["Conclave", "movie", "2024-10-25", 974_576, []],
  ["Nosferatu", "movie", "2024-12-25", 426_063, []],
  ["Flow", "movie", "2024-08-29", 823_219, []],
  ["Challengers", "movie", "2024-04-18", 937_287, []],
  ["Civil War", "movie", "2024-04-10", 929_590, []],
  ["Inside Out 2", "movie", "2024-06-11", 1_022_789, []],
  ["Furiosa: A Mad Max Saga", "movie", "2024-05-22", 786_892, []],
  ["A Real Pain", "movie", "2024-11-01", 1_013_850, []],
  ["Wicked", "movie", "2024-11-20", 402_431, []],
  ["Perfect Days", "movie", "2023-11-10", 976_893, []],
  ["Aftersun", "movie", "2022-10-21", 965_150, []],
  ["Adolescence", "series", "2025-03-13", 249_042, [4]],
  ["Shrinking", "series", "2023-01-26", 136_311, [10, 12]],
  ["Fallout", "series", "2024-04-10", 106_379, [8]],
  ["Ripley", "series", "2024-04-04", 94_028, [8]],
  ["Baby Reindeer", "series", "2024-04-11", 241_259, [7]],
  ["Industry", "series", "2020-11-09", 98_123, [8, 8, 8]],
  ["Pluribus", "series", "2025-11-06", 225_171, [9]],
  ["Paradise", "series", "2025-01-26", 245_927, [8]],
];

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * What the household has of one of its own titles. It agrees with the library
 * fixture: the same interest, and a standing request wherever the library
 * shows a title as held by somebody's interest or the viewer follows it.
 */
function libraryState(title: Title): CatalogLibraryState {
  const myInterest = libraryInterest(title);
  return {
    mediaId: title.id,
    availability: title.kind === "movie" ? title.availability : null,
    episodes: libraryEpisodes(title),
    requested:
      myInterest === "following" || libraryPolicy(title) === "temporary",
    myInterest,
  };
}

const CATALOG: readonly CatalogEntry[] = [
  ...TITLES.map((title) => ({
    item: {
      externalId: title.tmdbId,
      kind: title.kind,
      title: title.title,
      overview: synopsis(title.title),
      date: `${String(title.year)}-${twoDigits((title.index % 12) + 1)}-${twoDigits(((title.index * 7) % 27) + 1)}`,
      // Some provider entries have no artwork; pages must render without it.
      ...catalogArtwork(title),
      originalLanguage: title.language,
      library: libraryState(title),
    },
    seasons: title.seasons,
  })),
  ...OUTSIDE_LIBRARY.map(([title, kind, date, externalId, seasons]) => ({
    item: {
      externalId,
      kind,
      title,
      overview: synopsis(title),
      date,
      posterPath: posterPath(title),
      backdropPath: backdropPath(title),
      originalLanguage: "en",
      library: null,
    },
    seasons,
  })),
];

/** TMDB's page size, so paging behaves as it does against the real catalog. */
const PAGE_SIZE = 20;

/** The feed that is down in the `feed-unavailable` scenario. */
export const UNAVAILABLE_FEED: CatalogFeed = "popular_series";

/** What the catalog answers while TMDB is down, as the real route words it. */
function catalogUnavailable(): FixtureFailure {
  return new FixtureFailure(
    502,
    "catalog_unavailable",
    "The catalog is not answering right now. Try again in a moment.",
  );
}

/**
 * Whether Media could confirm the reader's Plex access. When it could not,
 * no title says what the household has of it.
 */
function libraryAccess(
  scenario: FixtureScenario,
): CatalogPage["libraryAccess"] {
  return scenario === "stale-library-access" ? "stale" : "current";
}

function asRead(item: CatalogItem, scenario: FixtureScenario): CatalogItem {
  return libraryAccess(scenario) === "stale"
    ? { ...item, library: null }
    : item;
}

function pageOf(
  items: readonly CatalogItem[],
  page: number,
  scenario: FixtureScenario,
): CatalogPage {
  return {
    page,
    totalPages: Math.min(
      CATALOG_MAX_PAGE,
      Math.max(1, Math.ceil(items.length / PAGE_SIZE)),
    ),
    libraryAccess: libraryAccess(scenario),
    results: items
      .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      .map((item) => asRead(item, scenario)),
  };
}

export function catalogSearch(
  parameters: URLSearchParams,
  scenario: FixtureScenario,
): CatalogPage {
  if (scenario === "catalog-unavailable") throw catalogUnavailable();
  const needle = (parameters.get("q") ?? "").trim().toLowerCase();
  return pageOf(
    CATALOG.filter((entry) =>
      entry.item.title.toLowerCase().includes(needle),
    ).map((entry) => entry.item),
    CatalogPageSchema.parse(parameters.get("page") ?? undefined),
    scenario,
  );
}

const ITEMS = CATALOG.map((entry) => entry.item);
const AIRING = new Set(AIRINGS.map((airing) => airing.series));

/** A stable shuffle, so a feed is not the library in its listing order. */
function mixed(items: readonly CatalogItem[], stride: number): CatalogItem[] {
  return items
    .map((item, index) => ({
      item,
      rank: ((index + 1) * stride) % items.length,
    }))
    .sort((left, right) => left.rank - right.rank)
    .map((ranked) => ranked.item);
}

/**
 * A feed's order. Most of what a real feed lists is not in anybody's
 * library, so two titles nobody here has asked for follow each one the
 * household holds, for as long as there are both. `lead` is a held title the
 * feed opens with, for a state that would otherwise be pages down.
 */
function browse(
  items: readonly CatalogItem[],
  stride: number,
  lead?: string,
): CatalogItem[] {
  const held = mixed(
    items.filter((item) => item.library !== null),
    stride,
  ).sort(
    (left, right) => Number(right.title === lead) - Number(left.title === lead),
  );
  const outside = mixed(
    items.filter((item) => item.library === null),
    stride,
  );
  const order: CatalogItem[] = [];
  while (held.length > 0 || outside.length > 0) {
    order.push(...held.splice(0, 1), ...outside.splice(0, 2));
  }
  return order;
}

function upcomingDate(index: number): string {
  return new Date(NOW + (index * 3 + 2) * DAY).toISOString().slice(0, 10);
}

/** What each browse row lists, as the matching TMDB list would. */
const FEEDS: Record<CatalogFeed, readonly CatalogItem[]> = {
  popular_movies: browse(
    ITEMS.filter((item) => item.kind === "movie"),
    17,
  ),
  popular_series: browse(
    ITEMS.filter((item) => item.kind === "series"),
    13,
  ),
  // Opens with the series whose episodes a Plex library outside Media holds.
  trending: browse(ITEMS, 31, EXTERNALLY_HELD.title),
  // Not released yet: nothing the household could already hold a file of.
  upcoming_movies: browse(
    ITEMS.filter(
      (item) =>
        item.kind === "movie" && item.library?.availability !== "available",
    ),
    7,
  ).map((item, index) => ({ ...item, date: upcomingDate(index) })),
  on_the_air: browse(
    ITEMS.filter(
      (item) =>
        item.kind === "series" &&
        (item.library === null || AIRING.has(item.title)),
    ),
    5,
  ),
};

export function catalogDiscover(
  parameters: URLSearchParams,
  scenario: FixtureScenario,
): CatalogPage {
  const feed = CatalogFeedSchema.parse(parameters.get("feed"));
  const page = CatalogPageSchema.parse(parameters.get("page") ?? undefined);
  if (
    scenario === "catalog-unavailable" ||
    (scenario === "feed-unavailable" && feed === UNAVAILABLE_FEED)
  ) {
    throw catalogUnavailable();
  }
  return pageOf(FEEDS[feed], page, scenario);
}

export function catalogDetail(
  kind: string,
  externalId: number,
  scenario: FixtureScenario,
): z.input<typeof CatalogDetailSchema> | null {
  if (scenario === "catalog-unavailable") throw catalogUnavailable();
  const entry = CATALOG.find(
    (candidate) =>
      candidate.item.kind === kind && candidate.item.externalId === externalId,
  );
  if (entry === undefined) {
    return null;
  }
  return {
    ...asRead(entry.item, scenario),
    libraryAccess: libraryAccess(scenario),
    // TMDB lists a runtime for a film and none for a series.
    runtimeMinutes:
      entry.item.kind === "movie" ? filmRuntimeMinutes(externalId) : null,
    seasons:
      entry.item.kind === "movie"
        ? []
        : [
            {
              externalId: externalId * 100,
              seasonNumber: 0,
              episodeCount: 3,
              title: "Specials",
            },
            ...entry.seasons.map((episodeCount, index) => ({
              externalId: externalId * 100 + index + 1,
              seasonNumber: index + 1,
              episodeCount,
              title: `Season ${String(index + 1)}`,
            })),
          ],
  };
}
