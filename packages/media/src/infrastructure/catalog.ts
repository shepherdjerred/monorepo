import type { CatalogApplication } from "#application/ports.ts";
import type { TmdbClient } from "#integrations/tmdb.ts";
import type { Database } from "./database.ts";
import type { CatalogSearch } from "#shared/api.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import {
  loadMovieCatalogIdentity,
  loadSeriesCatalogIdentity,
} from "./catalog-identity/catalog.ts";
import { persistCatalogMedia } from "./catalog-identity/persist.ts";

function year(date: string | null): number | null {
  if (date === null || date.length === 0) return null;
  const result = Number(date.slice(0, 4));
  if (!Number.isInteger(result) || result < 1800 || result > 3000)
    throw new Error("Catalog returned an invalid release year");
  return result;
}

export class TmdbCatalogApplication implements CatalogApplication {
  constructor(
    private readonly db: Database,
    private readonly tmdb: TmdbClient,
  ) {}

  async search(query: string): Promise<CatalogSearch> {
    const result = await this.tmdb.search(query);
    return {
      page: result.page,
      totalPages: result.totalPages,
      results: result.results.map((item) => ({
        externalId: item.id,
        kind: item.media_type === "movie" ? "movie" : "series",
        title: item.media_type === "movie" ? item.title : item.name,
        overview: item.overview,
        date:
          item.media_type === "movie" ? item.release_date : item.first_air_date,
        posterPath: item.poster_path,
        originalLanguage: item.original_language,
      })),
    };
  }

  async details(kind: "movie" | "series", externalId: number) {
    if (kind === "movie") {
      const item = await this.tmdb.movie(externalId);
      return {
        externalId: item.id,
        kind,
        title: item.title,
        overview: item.overview,
        date: item.release_date,
        posterPath: item.poster_path,
        originalLanguage: item.original_language,
        seasons: [],
      };
    }
    const item = await this.tmdb.series(externalId);
    return {
      externalId: item.id,
      kind,
      title: item.name,
      overview: item.overview,
      date: item.first_air_date,
      posterPath: item.poster_path,
      originalLanguage: item.original_language,
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
