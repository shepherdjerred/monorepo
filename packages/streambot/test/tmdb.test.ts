import { afterEach, describe, expect, test } from "bun:test";
import {
  createPosterFetcher,
  fetchPoster,
  pickPoster,
} from "@shepherdjerred/streambot/metadata/tmdb.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Install a fetch stub. `typeof fetch` carries a `preconnect` member (Bun), so supply a no-op one. */
function setFetch(
  impl: (input: string | URL | Request) => Promise<Response>,
): void {
  globalThis.fetch = Object.assign(impl, { preconnect: realFetch.preconnect });
}

function mockFetch(payload: unknown, status = 200): { calls: URL[] } {
  const calls: URL[] = [];
  setFetch((input) => {
    calls.push(new URL(input instanceof Request ? input.url : input));
    return Promise.resolve(Response.json(payload, { status }));
  });
  return { calls };
}

describe("pickPoster", () => {
  test("prefers the result whose year matches", () => {
    const poster = pickPoster(
      [
        { poster_path: "/old.jpg", title: "Title", release_date: "1982-06-25" },
        { poster_path: "/new.jpg", title: "Title", release_date: "2017-10-06" },
      ],
      2017,
    );
    expect(poster?.posterUrl).toBe("https://image.tmdb.org/t/p/w500/new.jpg");
  });

  test("falls back to the first result with a poster", () => {
    const poster = pickPoster(
      [
        { poster_path: null, title: "No Art" },
        {
          poster_path: "/p.jpg",
          name: "TV Show",
          first_air_date: "2001-01-01",
        },
      ],
      null,
    );
    expect(poster).toEqual({
      posterUrl: "https://image.tmdb.org/t/p/w500/p.jpg",
      tmdbTitle: "TV Show",
    });
  });

  test("returns null when no result has a poster", () => {
    expect(pickPoster([{ poster_path: null }], 2020)).toBeNull();
  });
});

describe("fetchPoster", () => {
  test("queries TMDB and returns a poster URL on a hit", async () => {
    const { calls } = mockFetch({
      results: [
        {
          poster_path: "/x.jpg",
          title: "Avengers: Endgame",
          release_date: "2019-04-24",
        },
      ],
    });
    const poster = await fetchPoster("KEY", "Avengers - Endgame", 2019);
    expect(poster).toEqual({
      posterUrl: "https://image.tmdb.org/t/p/w500/x.jpg",
      tmdbTitle: "Avengers: Endgame",
    });
    expect(calls[0]?.searchParams.get("query")).toBe("Avengers - Endgame");
    expect(calls[0]?.searchParams.get("year")).toBe("2019");
    expect(calls[0]?.searchParams.get("api_key")).toBe("KEY");
  });

  test("returns null on a non-OK response", async () => {
    mockFetch({}, 401);
    expect(await fetchPoster("KEY", "Anything", null)).toBeNull();
  });

  test("returns null when the request throws", async () => {
    setFetch(() => Promise.reject(new Error("network")));
    expect(await fetchPoster("KEY", "Anything", null)).toBeNull();
  });
});

describe("createPosterFetcher", () => {
  test("caches results so repeated lookups don't refetch", async () => {
    const { calls } = mockFetch({
      results: [
        { poster_path: "/c.jpg", title: "Cached", release_date: "2010-01-01" },
      ],
    });
    const fetcher = createPosterFetcher("KEY");
    const first = await fetcher("Cached", 2010);
    const second = await fetcher("Cached", 2010);
    expect(first).toEqual(second);
    expect(calls).toHaveLength(1);
  });

  test("caches null misses too", async () => {
    const { calls } = mockFetch({ results: [] });
    const fetcher = createPosterFetcher("KEY");
    expect(await fetcher("Missing", null)).toBeNull();
    expect(await fetcher("Missing", null)).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
