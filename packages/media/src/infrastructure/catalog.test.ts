import { expect, test, vi } from "vitest";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { IntegrationError, type FetchTransport } from "#integrations/http.ts";
import { TmdbClient } from "#integrations/tmdb.ts";
import { CatalogDetailSchema, CatalogSearchSchema } from "#shared/api.ts";
import type { CatalogLibraryState } from "#shared/catalog/contract.ts";
import { TmdbCatalogApplication } from "./catalog.ts";
import { createDatabase } from "./database.ts";
import { CATALOG_FEED_TTL_MS } from "./catalog-feeds/cache.ts";
import type { CatalogTitle } from "./library/views/catalog-state.ts";

// The household lookup is a stub here; the client connects only on a query.
const database = createDatabase("postgres://unused@127.0.0.1:1/unused");
const member: MediaActor = {
  id: "member",
  plexAccountId: "plex-member",
  displayName: "Member",
  role: "member",
  restricted: false,
  version: 0,
};
const owned: CatalogLibraryState = {
  mediaId: "media-11",
  availability: "available",
  episodes: null,
  requested: false,
  myInterest: "none",
};

function catalog(
  transport: FetchTransport,
  options: { now?: () => number; ownedMovie?: number } = {},
) {
  const library = vi.fn(
    (_actor: MediaActor, _titles: readonly CatalogTitle[]) =>
      Promise.resolve({
        libraryAccess: "current" as const,
        state: (title: CatalogTitle) =>
          title.kind === "movie" && title.externalId === options.ownedMovie
            ? owned
            : null,
      }),
  );
  const app = new TmdbCatalogApplication(
    database,
    new TmdbClient({ kind: "bearer", token: "fixture-token" }, transport),
    {},
    { library, ...(options.now === undefined ? {} : { now: options.now }) },
  );
  return { app, library };
}
function answering(payload: object) {
  return catalog(() => Promise.resolve(Response.json(payload)));
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
const movieItem = {
  externalId: 11,
  kind: "movie",
  title: "Fixture movie",
  overview: "A fixture.",
  date: "2020-01-01",
  posterPath: "/movie-poster.jpg",
  backdropPath: "/movie-backdrop.jpg",
  originalLanguage: "en",
};
const seriesItem = {
  externalId: 12,
  kind: "series",
  title: "Fixture series",
  overview: "",
  date: "2021-02-03",
  posterPath: null,
  backdropPath: null,
  originalLanguage: "ja",
};

test("search results carry the TMDB backdrop beside the poster, including its absence, and nothing the household lacks", async () => {
  const result = await answering({
    page: 1,
    total_pages: 1,
    results: [
      { ...movie, media_type: "movie" },
      { ...series, media_type: "tv" },
    ],
  }).app.search(member, "Fixture", 1);
  expect(CatalogSearchSchema.parse(result)).toEqual({
    page: 1,
    totalPages: 1,
    libraryAccess: "current",
    results: [
      { ...movieItem, library: null },
      { ...seriesItem, library: null },
    ],
  });
});

test("search asks TMDB for the requested page and never promises more than five", async () => {
  const pages: (string | null)[] = [];
  const { app, library } = catalog((url) => {
    pages.push(url.searchParams.get("page"));
    return Promise.resolve(
      Response.json({
        page: Number(url.searchParams.get("page")),
        total_pages: 37,
        results: [{ ...movie, media_type: "movie" }],
      }),
    );
  });
  expect(await app.search(member, "Fixture", 3)).toMatchObject({
    page: 3,
    totalPages: 5,
  });
  expect(pages).toEqual(["3"]);
  expect(library).toHaveBeenCalledExactlyOnceWith(member, [
    expect.objectContaining({ kind: "movie", externalId: 11 }),
  ]);
  await expect(app.search(member, "Fixture", 6)).rejects.toThrow();
  expect(pages).toEqual(["3"]);
});

test("movie and series detail carry the TMDB backdrop and the household's copy", async () => {
  const movieDetail = await catalog(
    () =>
      Promise.resolve(Response.json({ ...movie, imdb_id: null, runtime: 100 })),
    { ownedMovie: 11 },
  ).app.details(member, "movie", 11);
  expect(CatalogDetailSchema.parse(movieDetail)).toEqual({
    ...movieItem,
    seasons: [],
    library: owned,
    libraryAccess: "current",
  });
  const seriesDetail = await answering({
    ...series,
    backdrop_path: "/series-backdrop.jpg",
    seasons: [{ id: 1, season_number: 1, episode_count: 8, name: "Season 1" }],
  }).app.details(member, "series", 12);
  expect(CatalogDetailSchema.parse(seriesDetail)).toMatchObject({
    externalId: 12,
    posterPath: null,
    backdropPath: "/series-backdrop.jpg",
    seasons: [{ seasonNumber: 1, episodeCount: 8 }],
    library: null,
    libraryAccess: "current",
  });
});

test("a feed page is fetched once for the household while each reader gets their own library state", async () => {
  let now = 1_000_000;
  const paths: string[] = [];
  const { app, library } = catalog(
    (url) => {
      paths.push(`${url.pathname}?${url.searchParams.toString()}`);
      return Promise.resolve(
        Response.json({ page: 1, total_pages: 500, results: [movie] }),
      );
    },
    { now: () => now, ownedMovie: 11 },
  );
  const owner: MediaActor = { ...member, id: "owner", role: "owner" };
  const first = await app.discover(member, "upcoming_movies", 1);
  expect(CatalogSearchSchema.parse(first)).toEqual({
    page: 1,
    totalPages: 5,
    libraryAccess: "current",
    results: [{ ...movieItem, library: owned }],
  });
  expect(await app.discover(owner, "upcoming_movies", 1)).toEqual(first);
  expect(paths).toEqual(["/3/movie/upcoming?region=US&page=1"]);
  expect(library.mock.calls.map(([actor]) => actor.id)).toEqual([
    "member",
    "owner",
  ]);
  now += CATALOG_FEED_TTL_MS;
  await app.discover(member, "upcoming_movies", 1);
  expect(paths).toHaveLength(2);
});

test("an old tab's catalog contract still reads a response that carries the new fields", async () => {
  const before = z.object({
    page: z.number().int(),
    totalPages: z.number().int(),
    results: z.array(
      z.object({
        externalId: z.number().int(),
        kind: z.enum(["movie", "series"]),
        title: z.string(),
        overview: z.string(),
        date: z.string(),
        posterPath: z.string().nullable(),
        originalLanguage: z.string(),
      }),
    ),
  });
  const { backdropPath: _backdropPath, ...earlierItem } = movieItem;
  const { app } = catalog(
    () =>
      Promise.resolve(
        Response.json({
          page: 1,
          total_pages: 1,
          results: [{ ...movie, media_type: "movie" }],
        }),
      ),
    { ownedMovie: 11 },
  );
  // Through a real response body, as the browser receives it.
  const sent = Response.json(await app.search(member, "Fixture", 1));
  const response: unknown = await sent.json();
  expect(response).toMatchObject({
    libraryAccess: "current",
    results: [{ backdropPath: "/movie-backdrop.jpg", library: owned }],
  });
  expect(before.parse(response)).toEqual({
    page: 1,
    totalPages: 1,
    results: [earlierItem],
  });
});

test.each([
  ["down", new Response("provider body", { status: 503 })],
  [
    "throttling",
    new Response("provider body", {
      status: 429,
      headers: { "retry-after": "120" },
    }),
  ],
  ["unreadable", new Response("<html>", { status: 200 })],
  [
    "answering in a shape Media cannot read",
    Response.json({ page: 1, total_pages: 1, results: [{ id: 11 }] }),
  ],
])(
  "a TMDB that is %s surfaces as catalog_unavailable on every read",
  async (_label, response) => {
    const { app, library } = catalog(() => Promise.resolve(response.clone()));
    const unavailable = { code: "catalog_unavailable", status: 502 };
    await expect(app.search(member, "Fixture", 1)).rejects.toMatchObject(
      unavailable,
    );
    await expect(app.discover(member, "trending", 1)).rejects.toMatchObject(
      unavailable,
    );
    await expect(app.details(member, "series", 12)).rejects.toMatchObject(
      unavailable,
    );
    expect(library).not.toHaveBeenCalled();
  },
);

test("a title TMDB does not know is not found, and a rejected credential stays an internal failure", async () => {
  const missing = catalog(() =>
    Promise.resolve(new Response("{}", { status: 404 })),
  ).app;
  await expect(missing.details(member, "movie", 11)).rejects.toMatchObject({
    code: "catalog_title_not_found",
    status: 404,
  });
  await expect(missing.discover(member, "trending", 1)).rejects.toMatchObject({
    code: "catalog_unavailable",
  });
  const rejected = catalog(() =>
    Promise.resolve(new Response("{}", { status: 401 })),
  ).app;
  for (const read of [
    () => rejected.search(member, "Fixture", 1),
    () => rejected.discover(member, "trending", 1),
    () => rejected.details(member, "movie", 11),
  ]) {
    const failure = await read().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(IntegrationError);
    expect(failure).toMatchObject({ kind: "authentication" });
  }
});

test("a failed feed load is not remembered", async () => {
  let fail = true;
  const { app } = catalog(() =>
    Promise.resolve(
      fail
        ? new Response("provider body", { status: 503 })
        : Response.json({ page: 1, total_pages: 1, results: [series] }),
    ),
  );
  await expect(app.discover(member, "on_the_air", 1)).rejects.toMatchObject({
    code: "catalog_unavailable",
  });
  fail = false;
  expect(await app.discover(member, "on_the_air", 1)).toMatchObject({
    results: [{ ...seriesItem, library: null }],
  });
});
