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
import { DAY, NOW } from "#testing/fixture-api/support.ts";
import {
  backdropPath,
  catalogArtwork,
  posterPath,
  synopsis,
} from "./artwork.ts";
import { libraryEpisodes, libraryInterest, libraryPolicy } from "./library.ts";
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

function pageOf(items: readonly CatalogItem[], page: number): CatalogPage {
  return {
    page,
    totalPages: Math.min(
      CATALOG_MAX_PAGE,
      Math.max(1, Math.ceil(items.length / PAGE_SIZE)),
    ),
    libraryAccess: "current",
    results: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  };
}

export function catalogSearch(parameters: URLSearchParams): CatalogPage {
  const needle = (parameters.get("q") ?? "").trim().toLowerCase();
  return pageOf(
    CATALOG.filter((entry) =>
      entry.item.title.toLowerCase().includes(needle),
    ).map((entry) => entry.item),
    CatalogPageSchema.parse(parameters.get("page") ?? undefined),
  );
}

const ITEMS = CATALOG.map((entry) => entry.item);
const AIRING = new Set(AIRINGS.map((airing) => airing.series));

/** A stable shuffle, so a feed is not the library in its listing order. */
function mixed(items: readonly CatalogItem[], stride: number): CatalogItem[] {
  return items
    .map((item, index) => ({ item, rank: (index * stride) % items.length }))
    .sort((left, right) => left.rank - right.rank)
    .map((ranked) => ranked.item);
}

function upcomingDate(index: number): string {
  return new Date(NOW + (index * 9 + 4) * DAY).toISOString().slice(0, 10);
}

/** What each browse row lists, as the matching TMDB list would. */
const FEEDS: Record<CatalogFeed, readonly CatalogItem[]> = {
  trending: mixed(ITEMS, 31),
  popular_movies: mixed(
    ITEMS.filter((item) => item.kind === "movie"),
    17,
  ),
  popular_series: mixed(
    ITEMS.filter((item) => item.kind === "series"),
    13,
  ),
  // Not released yet: nothing the household could already hold a file of.
  upcoming_movies: ITEMS.filter(
    (item) =>
      item.kind === "movie" && item.library?.availability !== "available",
  ).map((item, index) => ({ ...item, date: upcomingDate(index) })),
  on_the_air: ITEMS.filter(
    (item) => item.kind === "series" && AIRING.has(item.title),
  ),
};

export function catalogDiscover(parameters: URLSearchParams): CatalogPage {
  return pageOf(
    FEEDS[CatalogFeedSchema.parse(parameters.get("feed"))],
    CatalogPageSchema.parse(parameters.get("page") ?? undefined),
  );
}

export function catalogDetail(
  kind: string,
  externalId: number,
): z.input<typeof CatalogDetailSchema> | null {
  const entry = CATALOG.find(
    (candidate) =>
      candidate.item.kind === kind && candidate.item.externalId === externalId,
  );
  if (entry === undefined) {
    return null;
  }
  return {
    ...entry.item,
    libraryAccess: "current",
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
