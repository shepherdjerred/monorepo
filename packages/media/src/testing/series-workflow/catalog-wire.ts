import { TmdbClient } from "#integrations/tmdb.ts";

/** Native catalog parsing and persistence consume these synthetic remote responses. */
export function futureSeriesCatalog(title: string, tmdbId: number) {
  const seasonId = tmdbId + 1;
  const episodeId = tmdbId + 2;
  const client = new TmdbClient(
    { kind: "api-key", apiKey: "synthetic" },
    (url) => {
      if (url.pathname.endsWith("/alternative_titles"))
        return Promise.resolve(Response.json({ id: tmdbId, results: [] }));
      if (url.pathname.endsWith("/external_ids"))
        return Promise.resolve(
          Response.json({ id: tmdbId, imdb_id: null, tvdb_id: null }),
        );
      if (url.pathname.endsWith(`/tv/${String(tmdbId)}`))
        return Promise.resolve(
          Response.json({
            id: tmdbId,
            name: title,
            original_name: title,
            overview: "",
            first_air_date: "2020-01-01",
            poster_path: null,
            original_language: "en",
            seasons: [
              {
                id: seasonId,
                season_number: 2,
                episode_count: 1,
                name: "Season 2",
              },
            ],
          }),
        );
      if (url.pathname.endsWith("/season/2"))
        return Promise.resolve(
          Response.json({
            episodes: [
              {
                id: episodeId,
                name: "Later episode",
                overview: "",
                season_number: 2,
                episode_number: 3,
                air_date: "2020-02-03",
                runtime: 1,
              },
            ],
          }),
        );
      throw new Error("Unexpected future episode metadata route");
    },
  );
  return { client, seasonId, episodeId };
}
