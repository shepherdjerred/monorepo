import { z } from "zod";
import { endpoint, json, request, type FetchTransport } from "./http.ts";

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
    return await json(response, "tmdb");
  }
}
