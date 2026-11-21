import { expect, test } from "vitest";
import { TmdbClient } from "#integrations/tmdb.ts";
import { CatalogDetailSchema, CatalogSearchSchema } from "#shared/api.ts";
import { TmdbCatalogApplication } from "./catalog.ts";
import { createDatabase } from "./database.ts";

// Search and detail never reach PostgreSQL; the client connects only on a query.
const database = createDatabase("postgres://unused@127.0.0.1:1/unused");

function catalogAnswering(payload: object) {
  return new TmdbCatalogApplication(
    database,
    new TmdbClient({ kind: "bearer", token: "fixture-token" }, () =>
      Promise.resolve(Response.json(payload)),
    ),
  );
}
const movie = {
  id: 11,
  title: "Fixture movie",
  original_title: "Fixture movie",
  overview: "A fixture.",
  release_date: "2020-01-01",
  poster_path: "/movie-poster.jpg",
  backdrop_path: "/movie-backdrop.jpg",
  original_language: "en",
};
const series = {
  id: 12,
  name: "Fixture series",
  original_name: "Fixture series",
  overview: "",
  first_air_date: "2021-02-03",
  poster_path: null,
  backdrop_path: null,
  original_language: "ja",
};

test("search results carry the TMDB backdrop beside the poster, including its absence", async () => {
  const result = await catalogAnswering({
    page: 1,
    total_pages: 1,
    results: [
      { ...movie, media_type: "movie" },
      { ...series, media_type: "tv" },
    ],
  }).search("Fixture");
  expect(CatalogSearchSchema.parse(result).results).toEqual([
    {
      externalId: 11,
      kind: "movie",
      title: "Fixture movie",
      overview: "A fixture.",
      date: "2020-01-01",
      posterPath: "/movie-poster.jpg",
      backdropPath: "/movie-backdrop.jpg",
      originalLanguage: "en",
    },
    {
      externalId: 12,
      kind: "series",
      title: "Fixture series",
      overview: "",
      date: "2021-02-03",
      posterPath: null,
      backdropPath: null,
      originalLanguage: "ja",
    },
  ]);
});

test("movie and series detail carry the TMDB backdrop", async () => {
  const movieDetail = await catalogAnswering({
    ...movie,
    imdb_id: null,
    runtime: 100,
  }).details("movie", 11);
  expect(CatalogDetailSchema.parse(movieDetail)).toMatchObject({
    externalId: 11,
    posterPath: "/movie-poster.jpg",
    backdropPath: "/movie-backdrop.jpg",
    seasons: [],
  });
  const seriesDetail = await catalogAnswering({
    ...series,
    backdrop_path: "/series-backdrop.jpg",
    seasons: [{ id: 1, season_number: 1, episode_count: 8, name: "Season 1" }],
  }).details("series", 12);
  expect(CatalogDetailSchema.parse(seriesDetail)).toMatchObject({
    externalId: 12,
    posterPath: null,
    backdropPath: "/series-backdrop.jpg",
    seasons: [{ seasonNumber: 1, episodeCount: 8 }],
  });
});
