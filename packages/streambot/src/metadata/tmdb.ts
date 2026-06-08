import { z } from "zod";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("tmdb");

const TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/multi";
/** TMDB image CDN base for a reasonably-sized poster (w500 is plenty for a Discord embed). */
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const REQUEST_TIMEOUT_MS = 8000;

/** A poster lookup result: the CDN image URL plus TMDB's canonical title for the match. */
export type PosterInfo = {
  readonly posterUrl: string;
  readonly tmdbTitle: string;
};

/** Fetch a poster for a title/year; resolves null when unavailable. */
export type PosterFetcher = (
  title: string,
  year: number | null,
) => Promise<PosterInfo | null>;

/** The slice of a TMDB `/search/multi` result we use. Unknown fields are dropped. */
const TmdbResultSchema = z.object({
  poster_path: z.string().nullish(),
  title: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
});
const TmdbResponseSchema = z.object({
  results: z.array(TmdbResultSchema).default([]),
});
type TmdbResult = z.infer<typeof TmdbResultSchema>;

function resultYear(result: TmdbResult): string | null {
  const date = result.release_date ?? result.first_air_date;
  return date !== undefined && date.length >= 4 ? date.slice(0, 4) : null;
}

/**
 * Pick the best match: prefer a result whose year matches the requested year (movie and TV reissues
 * share titles), otherwise the first result that actually has a poster.
 */
export function pickPoster(
  results: readonly TmdbResult[],
  year: number | null,
): PosterInfo | null {
  const withPoster = results.filter(
    (result) => result.poster_path !== null && result.poster_path !== undefined,
  );
  const yearStr = year === null ? null : String(year);
  const chosen =
    (yearStr === null
      ? undefined
      : withPoster.find((result) => resultYear(result) === yearStr)) ??
    withPoster[0];
  if (chosen?.poster_path === null || chosen?.poster_path === undefined) {
    return null;
  }
  return {
    posterUrl: `${TMDB_IMAGE_BASE}${chosen.poster_path}`,
    tmdbTitle: chosen.title ?? chosen.name ?? "",
  };
}

/**
 * Look up a movie/TV poster on TMDB by title (+ optional year). Best-effort: any failure (bad key,
 * network error, no match, schema drift) resolves to `null` — the caller falls back to text-only.
 * Results are cached in-process so loops/replays don't refetch.
 */
export function createPosterFetcher(apiKey: string): PosterFetcher {
  const cache = new Map<string, PosterInfo | null>();

  return async (title, year) => {
    const key = `${title.toLowerCase()}|${year === null ? "" : String(year)}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = await fetchPoster(apiKey, title, year);
    cache.set(key, result);
    return result;
  };
}

/** One-shot poster lookup (no caching). Used by {@link createPosterFetcher} and tests. */
export async function fetchPoster(
  apiKey: string,
  title: string,
  year: number | null,
): Promise<PosterInfo | null> {
  const url = new URL(TMDB_SEARCH_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", title);
  url.searchParams.set("include_adult", "false");
  if (year !== null) {
    url.searchParams.set("year", String(year));
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn("tmdb search failed", { title, status: response.status });
      return null;
    }
    const parsed = TmdbResponseSchema.parse(await response.json());
    const poster = pickPoster(parsed.results, year);
    if (poster === null) {
      log.debug("tmdb no poster", { title, year });
    }
    return poster;
  } catch (error) {
    log.warn("tmdb search errored", { title, error: getErrorMessage(error) });
    return null;
  }
}
