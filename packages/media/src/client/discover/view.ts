import type { CatalogFeed } from "#shared/catalog/contract.ts";

/**
 * What Discover shows, as its address says it:
 *
 * - `/discover` is the browse rows;
 * - `/discover?q=dune` is a search, so a result list can be linked to and
 *   survives a reload;
 * - `/discover/popular-films` is one feed, all of it.
 *
 * The address is something a person can type, so one this page does not
 * know reads as the browse rows instead of failing.
 */
export const DISCOVER_PATH = "/discover";

/** The catalog search accepts at most 200 characters. */
export const QUERY_LIMIT = 200;

/** The rows, top to bottom. */
export const FEED_ORDER = [
  "trending",
  "popular_movies",
  "popular_series",
  "on_the_air",
  "upcoming_movies",
] as const satisfies readonly CatalogFeed[];

/** A feed's name in an address, in the words its row is headed with. */
const FEED_SLUGS = {
  trending: "trending",
  popular_movies: "popular-films",
  popular_series: "popular-series",
  upcoming_movies: "upcoming-films",
  on_the_air: "airing-this-week",
} as const satisfies Record<CatalogFeed, string>;

/** The search an address asks for; empty when it asks for none. */
export function readSearch(params: URLSearchParams): string {
  return (params.get("q") ?? "").trim().slice(0, QUERY_LIMIT).trim();
}

/** The address of a search, or of the browse rows for an empty one. */
export function searchAddress(query: string): string {
  const text = query.trim().slice(0, QUERY_LIMIT).trim();
  return text === ""
    ? DISCOVER_PATH
    : `${DISCOVER_PATH}?${new URLSearchParams({ q: text }).toString()}`;
}

export function feedAddress(feed: CatalogFeed): string {
  return `${DISCOVER_PATH}/${FEED_SLUGS[feed]}`;
}

/** The feed a `/discover/:feed` address names, or null when it names none. */
export function feedFromSlug(slug: string | undefined): CatalogFeed | null {
  return FEED_ORDER.find((feed) => FEED_SLUGS[feed] === slug) ?? null;
}

/** What a list of catalog titles is a list of. */
export type CatalogSource =
  { kind: "search"; query: string } | { kind: "feed"; feed: CatalogFeed };

/** The API read for one page of a search or a feed. */
export function catalogReadPath(source: CatalogSource, page: number): string {
  const params =
    source.kind === "search"
      ? new URLSearchParams({ q: source.query })
      : new URLSearchParams({ feed: source.feed });
  params.set("page", String(page));
  return `/catalog/${source.kind === "search" ? "search" : "discover"}?${params.toString()}`;
}
