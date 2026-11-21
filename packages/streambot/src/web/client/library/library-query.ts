import { apiUrl } from "@shepherdjerred/streambot/web/client/api.ts";
import { readOffset } from "./query-params.ts";

export type LibraryFilters = {
  readonly query: string;
  readonly library: string;
  readonly series: string;
  readonly offset: number;
};

/** The library filters held in the address bar. */
export function readLibraryFilters(params: URLSearchParams): LibraryFilters {
  return {
    query: params.get("q") ?? "",
    library: params.get("library") ?? "",
    series: params.get("series") ?? "",
    offset: readOffset(params),
  };
}

/**
 * `/api/library` for the filters: titles (posters) with no series chosen, and a series' episodes
 * once one is. The server only groups titles when Plex posters are on; otherwise it answers with
 * plain entries either way.
 */
export function libraryUrl(guildId: string, filters: LibraryFilters): string {
  return apiUrl("/api/library", {
    guildId,
    view: filters.series === "" ? "titles" : "entries",
    query: filters.query,
    library: filters.library,
    series: filters.series,
    offset: filters.offset === 0 ? "" : String(filters.offset),
  });
}

export type SeasonGroup<T> = {
  readonly season: number | undefined;
  readonly items: readonly T[];
};

/**
 * Episodes in the server's order (season, then episode), gathered under their season. Entries
 * with no season share one group, which keeps its place in the order.
 */
export function groupSeasons<
  T extends { readonly season?: number | undefined },
>(items: readonly T[]): readonly SeasonGroup<T>[] {
  const groups: { season: number | undefined; items: T[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last !== undefined && last.season === item.season)
      last.items.push(item);
    else groups.push({ season: item.season, items: [item] });
  }
  return groups;
}

export function seasonTitle(season: number | undefined): string {
  return season === undefined ? "Episodes" : "Season " + String(season);
}
