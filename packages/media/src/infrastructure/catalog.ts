import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { CatalogApplication } from "#application/ports.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { TmdbClient, TmdbTitle } from "#integrations/tmdb.ts";
import type { Database } from "./database.ts";
import type { CatalogDetail, CatalogSearch } from "#shared/api.ts";
import {
  CATALOG_MAX_PAGE,
  type CatalogFeed,
} from "#shared/catalog/contract.ts";
import { CatalogFeedCache } from "./catalog-feeds/cache.ts";
import {
  readCatalogLibraryState,
  type CatalogLibraryRead,
  type CatalogTitle,
} from "./library/views/catalog-state.ts";
import type { LibraryReadSettings } from "./library/views/plex-access.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import {
  loadMovieCatalogIdentity,
  loadSeriesCatalogIdentity,
} from "./catalog-identity/catalog.ts";
import {
  catalogArtwork,
  persistCatalogMedia,
} from "./catalog-identity/persist.ts";
import {
  normalizeMovieReleases,
  seriesLifecycleStatus,
} from "#domain/household/calendar.ts";

function year(date: string | null): number | null {
  if (date === null || date.length === 0) return null;
  const result = Number(date.slice(0, 4));
  if (!Number.isInteger(result) || result < 1800 || result > 3000)
    throw new Error("Catalog returned an invalid release year");
  return result;
}

const PageSchema = z.int().min(1).max(CATALOG_MAX_PAGE);

function catalogItem(item: TmdbTitle) {
  const movie = item.media_type === "movie";
  return {
    externalId: item.id,
    kind: movie ? ("movie" as const) : ("series" as const),
    title: movie ? item.title : item.name,
    overview: item.overview,
    date: movie ? item.release_date : item.first_air_date,
    posterPath: item.poster_path,
    backdropPath: item.backdrop_path,
    originalLanguage: item.original_language,
  };
}

/**
 * TMDB being down, throttled or unreadable is an expected upstream failure:
 * the caller gets a typed 502 and the rest of its page keeps working. A
 * rejected credential is ours to fix and stays an internal error.
 */
async function fromTmdb<T>(
  read: () => Promise<T>,
  missing?: MediaError,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof IntegrationError) || error.kind === "authentication")
      throw error;
    if (missing !== undefined && error.status === 404) throw missing;
    throw new MediaError(
      "catalog_unavailable",
      "The catalog is not answering right now. Try again in a moment.",
      502,
    );
  }
}

type CatalogLibraryReader = (
  actor: MediaActor,
  titles: readonly CatalogTitle[],
) => Promise<CatalogLibraryRead>;

export class TmdbCatalogApplication implements CatalogApplication {
  private readonly feeds: CatalogFeedCache<
    Awaited<ReturnType<TmdbClient["list"]>>
  >;
  private readonly library: CatalogLibraryReader;

  /**
   * Without the Plex `settings` no reader's library access can be confirmed,
   * so every read reports `libraryAccess: "stale"`; adoption does not use them.
   */
  constructor(
    private readonly db: Database,
    private readonly tmdb: TmdbClient,
    settings: LibraryReadSettings = {},
    options: { now?: () => number; library?: CatalogLibraryReader } = {},
  ) {
    this.feeds = new CatalogFeedCache(
      (feed, page) => tmdb.list(feed, page),
      options.now,
    );
    this.library =
      options.library ??
      ((actor, titles) => readCatalogLibraryState(db, settings, actor, titles));
  }

  async search(
    actor: MediaActor,
    query: string,
    page: number,
  ): Promise<CatalogSearch> {
    PageSchema.parse(page);
    return this.annotated(
      actor,
      await fromTmdb(() => this.tmdb.search(query, page)),
    );
  }

  async discover(
    actor: MediaActor,
    feed: CatalogFeed,
    page: number,
  ): Promise<CatalogSearch> {
    return this.annotated(
      actor,
      await fromTmdb(() => this.feeds.get(feed, page)),
    );
  }

  async details(
    actor: MediaActor,
    kind: "movie" | "series",
    externalId: number,
  ): Promise<CatalogDetail> {
    const item = await fromTmdb(
      () => this.title(kind, externalId),
      new MediaError(
        "catalog_title_not_found",
        "This title is not in the catalog",
        404,
      ),
    );
    const library = await this.library(actor, [item]);
    return {
      ...item,
      library: library.state(item),
      libraryAccess: library.libraryAccess,
    };
  }

  /** The household's copy of each title is read after TMDB answered, never inside that wait. */
  private async annotated(
    actor: MediaActor,
    result: Awaited<ReturnType<TmdbClient["search"]>>,
  ): Promise<CatalogSearch> {
    const items = result.results.map((item) => catalogItem(item));
    const library = await this.library(actor, items);
    return {
      page: result.page,
      totalPages: Math.min(result.totalPages, CATALOG_MAX_PAGE),
      libraryAccess: library.libraryAccess,
      results: items.map((item) => ({ ...item, library: library.state(item) })),
    };
  }

  private async title(kind: "movie" | "series", externalId: number) {
    if (kind === "movie")
      return {
        ...catalogItem({
          ...(await this.tmdb.movie(externalId)),
          media_type: "movie",
        }),
        seasons: [],
      };
    const item = await this.tmdb.series(externalId);
    return {
      ...catalogItem({ ...item, media_type: "tv" }),
      seasons: item.seasons.map((season) => ({
        externalId: season.id,
        seasonNumber: season.season_number,
        episodeCount: season.episode_count,
        title: season.name,
      })),
    };
  }

  async adopt(kind: "movie" | "series", externalId: number) {
    if (kind === "movie") {
      const { details: movie, identity } = await loadMovieCatalogIdentity(
        this.tmdb,
        externalId,
      );
      const item = await serializable(this.db, (tx) =>
        persistCatalogMedia(tx, {
          kind,
          tmdbId: movie.id,
          title: movie.title,
          year: year(movie.release_date),
          runtimeMinutes: movie.runtime,
          originalLanguage: movie.original_language,
          identity,
          artwork: catalogArtwork(movie),
          releaseDates: normalizeMovieReleases(
            movie.release_dates?.results ?? [],
          ),
        }),
      );
      return { mediaId: item.id };
    }
    const { details: series, identity } = await loadSeriesCatalogIdentity(
      this.tmdb,
      externalId,
    );
    return serializable(this.db, async (db) => {
      const item = await persistCatalogMedia(db, {
        kind,
        tmdbId: series.id,
        title: series.name,
        year: year(series.first_air_date),
        originalLanguage: series.original_language,
        runtimeMinutes: null,
        identity,
        artwork: catalogArtwork(series),
        seriesStatus: seriesLifecycleStatus(series.status),
      });
      await queueOperation(db, {
        key: `catalog:${item.id}:${String(Math.floor(Date.now() / 3_600_000))}`,
        kind: "refresh_catalog",
        targetId: item.id,
        payload: { mediaId: item.id, cursor: null },
      });
      return { mediaId: item.id };
    });
  }
}
