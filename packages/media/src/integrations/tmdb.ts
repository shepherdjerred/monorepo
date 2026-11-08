import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  request,
  type FetchTransport,
} from "./http.ts";
import { boundedBytes } from "./providers.ts";
import {
  GroupIdSchema,
  MovieTitlesSchema,
  SeriesTitlesSchema,
  EpisodeGroupsSchema,
  EpisodeGroupSchema,
  normalizeEpisodeGroup,
} from "./tmdb/catalog.ts";

const MovieSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  original_title: z.string(),
  overview: z.string(),
  release_date: z.string(),
  poster_path: z.string().nullable(),
  original_language: z.string(),
});
const SeriesSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  original_name: z.string(),
  overview: z.string(),
  first_air_date: z.string(),
  poster_path: z.string().nullable(),
  original_language: z.string(),
});
const SearchSchema = z.object({
  page: z.number().int().positive(),
  total_pages: z.number().int().nonnegative(),
  results: z.array(
    z.discriminatedUnion("media_type", [
      MovieSchema.extend({ media_type: z.literal("movie") }),
      SeriesSchema.extend({ media_type: z.literal("tv") }),
      z.object({
        media_type: z.literal("person"),
        id: z.number().int(),
        name: z.string(),
      }),
    ]),
  ),
});
const EpisodeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  overview: z.string(),
  season_number: z.number().int().nonnegative(),
  episode_number: z.number().int().nonnegative(),
  air_date: z.string().nullable(),
  runtime: z.number().int().positive().nullable().optional(),
});

export type TmdbCredential =
  { kind: "bearer"; token: string } | { kind: "api-key"; apiKey: string };

export class TmdbClient {
  constructor(
    private readonly credential: TmdbCredential,
    private readonly transport: FetchTransport = fetch,
  ) {}

  async search(query: string, page = 1, signal?: AbortSignal) {
    z.string().trim().min(1).max(200).parse(query);
    z.number().int().min(1).max(500).parse(page);
    const result = SearchSchema.parse(
      await this.get(
        "search/multi",
        { query, page: String(page), include_adult: "false" },
        signal,
      ),
    );
    return {
      page: result.page,
      totalPages: result.total_pages,
      results: result.results.filter((item) => item.media_type !== "person"),
    };
  }

  async movie(id: number, signal?: AbortSignal) {
    z.number().int().positive().parse(id);
    return MovieSchema.extend({
      imdb_id: z.string().nullable(),
      runtime: z.number().nullable(),
    }).parse(await this.get(`movie/${String(id)}`, {}, signal));
  }

  async series(id: number, signal?: AbortSignal) {
    z.number().int().positive().parse(id);
    return SeriesSchema.extend({
      seasons: z.array(
        z.object({
          id: z.number().int(),
          season_number: z.number().int(),
          episode_count: z.number().int(),
          name: z.string(),
        }),
      ),
    }).parse(await this.get(`tv/${String(id)}`, {}, signal));
  }

  async season(seriesId: number, season: number, signal?: AbortSignal) {
    z.number().int().positive().parse(seriesId);
    z.number().int().nonnegative().parse(season);
    return z
      .object({ episodes: z.array(EpisodeSchema) })
      .parse(
        await this.get(
          `tv/${String(seriesId)}/season/${String(season)}`,
          {},
          signal,
        ),
      ).episodes;
  }

  async findExternal(
    source: "tvdb_id" | "imdb_id",
    id: string,
    signal?: AbortSignal,
  ) {
    (source === "tvdb_id"
      ? z.string().regex(/^[1-9]\d{0,10}$/u)
      : z.string().regex(/^tt\d{1,12}$/u)
    ).parse(id);
    const result = z.object({
      movie_results: z
        .array(z.object({ id: z.number().int().positive() }))
        .max(100),
      tv_results: z
        .array(z.object({ id: z.number().int().positive() }))
        .max(100),
    });
    return result.parse(
      await this.get(`find/${id}`, { external_source: source }, signal),
    );
  }

  async seriesExternalIds(id: number, signal?: AbortSignal) {
    z.number().int().positive().parse(id);
    return z
      .object({
        id: z.number().int().positive(),
        tvdb_id: z.number().int().positive().nullable(),
        imdb_id: z
          .string()
          .regex(/^tt\d+$/u)
          .nullable(),
      })
      .parse(await this.get(`tv/${String(id)}/external_ids`, {}, signal));
  }

  async alternativeTitles(
    kind: "movie" | "series",
    id: number,
    signal?: AbortSignal,
  ) {
    z.int().positive().parse(id);
    const wire = await this.get(
      `${kind === "movie" ? "movie" : "tv"}/${String(id)}/alternative_titles`,
      {},
      signal,
    );
    const result =
      kind === "movie"
        ? MovieTitlesSchema.parse(wire)
        : SeriesTitlesSchema.parse(wire);
    if (result.id !== id)
      throw new IntegrationError("tmdb", "invalid-response");
    const titles = "titles" in result ? result.titles : result.results;
    return {
      id,
      titles: titles.map((title) => ({
        title: title.title,
        country: title.iso_3166_1,
        type: title.type,
      })),
    };
  }

  async episodeGroups(seriesId: number, signal?: AbortSignal) {
    z.int().positive().parse(seriesId);
    const result = EpisodeGroupsSchema.parse(
      await this.get(`tv/${String(seriesId)}/episode_groups`, {}, signal),
    );
    if (result.id !== seriesId)
      throw new IntegrationError("tmdb", "invalid-response");
    return {
      seriesId,
      groups: result.results.map((group) => ({
        id: group.id,
        name: group.name,
        type: group.type,
        episodeCount: group.episode_count,
        groupCount: group.group_count,
      })),
    };
  }

  async episodeGroup(groupId: string, signal?: AbortSignal) {
    GroupIdSchema.parse(groupId);
    const result = EpisodeGroupSchema.parse(
      await this.get(`tv/episode_group/${groupId}`, {}, signal),
    );
    if (result.id !== groupId)
      throw new IntegrationError("tmdb", "invalid-response");
    return normalizeEpisodeGroup(result);
  }

  private async get(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = endpoint("https://api.themoviedb.org/3", path);
    url.search = new URLSearchParams(params).toString();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.credential.kind === "api-key")
      url.searchParams.set("api_key", this.credential.apiKey);
    else headers["Authorization"] = `Bearer ${this.credential.token}`;
    const response = await request(this.transport, "tmdb", url, {
      headers,
      ...(signal === undefined ? {} : { signal }),
    });
    const bytes = await boundedBytes(response, 8 * 1024 * 1024, "tmdb");
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new IntegrationError("tmdb", "invalid-response");
    }
  }
}
