import type { CatalogApplication } from "#application/ports.ts";
import type { TmdbClient } from "#integrations/tmdb.ts";
import type { Database } from "./database.ts";
import type { CatalogSearch } from "#shared/api.ts";

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
      const movie = await this.tmdb.movie(externalId);
      const item = await this.db.mediaItem.upsert({
        where: { kind_tmdbId: { kind, tmdbId: movie.id } },
        create: {
          kind,
          tmdbId: movie.id,
          title: movie.title,
          year: year(movie.release_date),
          externalIds: { tmdb: movie.id, imdb: movie.imdb_id },
        },
        update: { title: movie.title, year: year(movie.release_date) },
      });
      return { mediaId: item.id };
    }
    const series = await this.tmdb.series(externalId);
    const seasons: {
      season: (typeof series.seasons)[number];
      episodes: Awaited<ReturnType<TmdbClient["season"]>>;
    }[] = [];
    for (const season of series.seasons)
      seasons.push({
        season,
        episodes: await this.tmdb.season(series.id, season.season_number),
      });
    return this.db.$transaction(
      async (db) => {
        const item = await db.mediaItem.upsert({
          where: { kind_tmdbId: { kind, tmdbId: series.id } },
          create: {
            kind,
            tmdbId: series.id,
            title: series.name,
            year: year(series.first_air_date),
            externalIds: { tmdb: series.id },
          },
          update: { title: series.name, year: year(series.first_air_date) },
        });
        for (const { season, episodes } of seasons) {
          const parent = await db.mediaItem.upsert({
            where: { kind_tmdbId: { kind: "season", tmdbId: season.id } },
            create: {
              kind: "season",
              tmdbId: season.id,
              title: `${series.name}: ${season.name}`,
              parentId: item.id,
              seasonNumber: season.season_number,
            },
            update: {
              title: `${series.name}: ${season.name}`,
              parentId: item.id,
              seasonNumber: season.season_number,
            },
          });
          for (const episode of episodes) {
            await db.mediaItem.upsert({
              where: { kind_tmdbId: { kind: "episode", tmdbId: episode.id } },
              create: {
                kind: "episode",
                tmdbId: episode.id,
                title: episode.name,
                parentId: parent.id,
                seasonNumber: episode.season_number,
                episodeNumber: episode.episode_number,
                year: year(episode.air_date),
                externalIds: { tmdb: episode.id, seriesTmdb: series.id },
              },
              update: {
                title: episode.name,
                parentId: parent.id,
                seasonNumber: episode.season_number,
                episodeNumber: episode.episode_number,
                year: year(episode.air_date),
              },
            });
          }
        }
        return { mediaId: item.id };
      },
      { timeout: 60_000 },
    );
  }
}
