import type { z } from "zod";
import type {
  CatalogDetailSchema,
  CatalogItemSchema,
  CatalogSearchSchema,
} from "#shared/api.ts";
import {
  backdropPath,
  catalogArtwork,
  posterPath,
  synopsis,
} from "./artwork.ts";
import { TITLES } from "./titles.ts";

type CatalogItem = z.input<typeof CatalogItemSchema>;
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
    },
    seasons,
  })),
];

const SEARCH_PAGE_SIZE = 20;

export function catalogSearch(
  query: string,
): z.input<typeof CatalogSearchSchema> {
  const needle = query.trim().toLowerCase();
  const matches = CATALOG.filter((entry) =>
    entry.item.title.toLowerCase().includes(needle),
  );
  return {
    page: 1,
    totalPages: Math.max(1, Math.ceil(matches.length / SEARCH_PAGE_SIZE)),
    results: matches.slice(0, SEARCH_PAGE_SIZE).map((entry) => entry.item),
  };
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
