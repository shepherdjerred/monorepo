import { expect, test } from "vitest";
import { TmdbClient } from "#integrations/tmdb.ts";
import type { CatalogFeed } from "#shared/catalog/contract.ts";

// Synthetic wire fixtures follow the documented TMDB v3 list envelopes
// (trending/all, movie/popular, tv/popular, movie/upcoming, tv/on_the_air);
// they are not live acceptance evidence.
const movie = {
  adult: false,
  backdrop_path: "/movie-backdrop.jpg",
  genre_ids: [28, 12],
  id: 11,
  original_language: "en",
  original_title: "Fixture movie",
  overview: "A fixture.",
  popularity: 91.5,
  poster_path: "/movie-poster.jpg",
  release_date: "2026-12-18",
  title: "Fixture movie",
  video: false,
  vote_average: 7.4,
  vote_count: 120,
};
const series = {
  backdrop_path: null,
  first_air_date: "",
  genre_ids: [18],
  id: 12,
  name: "Fixture series",
  origin_country: ["JP"],
  original_language: "ja",
  original_name: "Fixture series original",
  overview: "",
  popularity: 40.1,
  poster_path: null,
  vote_average: 6.1,
  vote_count: 9,
};
const envelope = (results: object[], page = 1) => ({
  page,
  results,
  total_pages: 500,
  total_results: 10_000,
});

function recording(answer: (url: URL) => object) {
  const requests: string[] = [];
  const client = new TmdbClient(
    { kind: "bearer", token: "fixture-token" },
    (url, init) => {
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer fixture-token",
      );
      requests.push(`${url.pathname}?${url.searchParams.toString()}`);
      return Promise.resolve(Response.json(answer(url)));
    },
  );
  return { client, requests };
}

const kept = {
  movie: {
    media_type: "movie",
    id: 11,
    title: "Fixture movie",
    original_title: "Fixture movie",
    overview: "A fixture.",
    release_date: "2026-12-18",
    poster_path: "/movie-poster.jpg",
    backdrop_path: "/movie-backdrop.jpg",
    original_language: "en",
  },
  series: {
    media_type: "tv",
    id: 12,
    name: "Fixture series",
    original_name: "Fixture series original",
    overview: "",
    first_air_date: "",
    poster_path: null,
    backdrop_path: null,
    original_language: "ja",
  },
};

test.each<[CatalogFeed, string, object, object]>([
  ["popular_movies", "/3/movie/popular?page=2", movie, kept.movie],
  ["popular_series", "/3/tv/popular?page=2", series, kept.series],
  ["upcoming_movies", "/3/movie/upcoming?region=US&page=2", movie, kept.movie],
  ["on_the_air", "/3/tv/on_the_air?page=2", series, kept.series],
])(
  "the %s feed reads %s and labels its single kind of title",
  async (feed, request, item, expected) => {
    const { client, requests } = recording(() => ({
      ...envelope([item], 2),
      dates: { maximum: "2026-12-31", minimum: "2026-11-20" },
    }));
    expect(await client.list(feed, 2)).toEqual({
      page: 2,
      totalPages: 500,
      results: [expected],
    });
    expect(requests).toEqual([request]);
  },
);

test("the trending feed reads the week's mixed list and keeps only movies and series", async () => {
  const { client, requests } = recording(() =>
    envelope([
      { ...series, media_type: "tv" },
      {
        id: 13,
        media_type: "person",
        name: "Fixture person",
        known_for_department: "Acting",
        profile_path: null,
      },
      { ...movie, media_type: "movie" },
    ]),
  );
  expect(await client.list("trending")).toEqual({
    page: 1,
    totalPages: 500,
    results: [kept.series, kept.movie],
  });
  expect(requests).toEqual(["/3/trending/all/week?page=1"]);
});

test("a list result TMDB labels with an unknown kind, or one missing its title, is rejected rather than guessed at", async () => {
  await expect(
    recording(() =>
      envelope([{ ...movie, media_type: "collection" }]),
    ).client.list("trending"),
  ).rejects.toThrow();
  const { title: _title, ...untitled } = movie;
  await expect(
    recording(() => envelope([untitled])).client.list("popular_movies"),
  ).rejects.toThrow();
  // A series row is not a movie row: the feed's kind decides how it is read.
  await expect(
    recording(() => envelope([series])).client.list("upcoming_movies"),
  ).rejects.toThrow();
});

test("a list that answers with a different page than was asked for is an invalid response", async () => {
  await expect(
    recording(() => envelope([movie], 1)).client.list("popular_movies", 3),
  ).rejects.toMatchObject({ message: "tmdb: invalid-response" });
});

test("list refuses a page TMDB cannot serve before any request is made", async () => {
  const { client, requests } = recording(() => envelope([]));
  for (const page of [0, 501, 1.5])
    await expect(client.list("trending", page)).rejects.toThrow();
  expect(requests).toEqual([]);
});

test("list failures keep the typed integration error without the provider's body", async () => {
  const failing = (response: () => Response) =>
    new TmdbClient({ kind: "api-key", apiKey: "fixture-secret" }, (url) => {
      expect(url.searchParams.get("api_key")).toBe("fixture-secret");
      return Promise.resolve(response());
    });
  await expect(
    failing(
      () =>
        new Response("sensitive provider body", {
          status: 429,
          headers: { "retry-after": "30" },
        }),
    ).list("trending"),
  ).rejects.toMatchObject({
    kind: "rate-limited",
    retryAfterSeconds: 30,
    message: "tmdb: rate-limited",
  });
  await expect(
    failing(
      () => new Response("sensitive provider body", { status: 503 }),
    ).list("popular_series"),
  ).rejects.toMatchObject({
    kind: "unavailable",
    message: "tmdb: unavailable",
  });
  await expect(
    failing(
      () => new Response("sensitive provider body", { status: 401 }),
    ).list("on_the_air"),
  ).rejects.toMatchObject({ kind: "authentication" });
  await expect(
    failing(() => new Response("<html>")).list("upcoming_movies"),
  ).rejects.toMatchObject({ message: "tmdb: invalid-response" });
});
