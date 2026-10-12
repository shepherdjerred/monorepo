import { describe, expect, test, vi } from "vitest";
import {
  PlexArtwork,
  PlexArtworkUnavailableError,
} from "@shepherdjerred/streambot/metadata/plex.ts";

function fixture(movieCount = 1) {
  let version = 1;
  let failure = false;
  let imageSize = 3;
  let imageType = "image/jpeg";
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetcher = Object.assign(
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      calls.push({ url, init });
      if (failure) return Promise.resolve(new Response(null, { status: 503 }));
      if (url.pathname === "/library/sections")
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: 2,
              Directory: [
                { key: "1", type: "movie" },
                { key: "2", type: "show" },
              ],
            },
          }),
        );
      if (url.pathname === "/photo/:/transcode")
        return Promise.resolve(
          new Response(new Uint8Array(imageSize), {
            headers: { "content-type": imageType },
          }),
        );
      if (url.pathname === "/library/sections/1/all") {
        const offset = Number(url.searchParams.get("X-Plex-Container-Start"));
        const items = Array.from(
          { length: Math.min(500, movieCount - offset) },
          (_, index) => ({
            thumb: "/library/metadata/1/thumb/" + String(version),
            Media: [
              {
                Part: [
                  { file: `/data/movies/movie-${String(offset + index)}.mkv` },
                  {
                    file: `/data/movies/movie-${String(offset + index)}-alternate.mkv`,
                  },
                ],
              },
            ],
          }),
        );
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: items.length,
              totalSize: movieCount,
              Metadata: items,
            },
          }),
        );
      }
      if (url.pathname === "/library/sections/2/all")
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: 2,
              totalSize: 2,
              Metadata: [1, 2].map((episode) => ({
                thumb: "/library/metadata/99/thumb/1",
                grandparentThumb: "/library/metadata/2/thumb/1",
                Media: [
                  {
                    Part: [
                      { file: `/data/tv/Show/episode-${String(episode)}.mkv` },
                    ],
                  },
                ],
              })),
            },
          }),
        );
      throw new Error("Unexpected fixture endpoint");
    }),
    { preconnect: fetch.preconnect },
  );
  let now = 0;
  return {
    artwork: new PlexArtwork(
      { baseUrl: "http://plex.test", token: "fixture-token" },
      { fetch: fetcher, now: () => now },
    ),
    calls,
    fetcher,
    refresh: () => {
      now += 300_001;
      version += 1;
    },
    fail: (value: boolean) => {
      failure = value;
    },
    invalidImage: (size: number, type: string) => {
      imageSize = size;
      imageType = type;
    },
  };
}

describe("Plex library artwork", () => {
  test("matches exact movie paths across pages and includes alternative media parts", async () => {
    const f = fixture(501);
    expect(
      await f.artwork.image("/media/movies/movie-500-alternate.mkv"),
    ).toMatchObject({ contentType: "image/jpeg" });
    expect(
      f.calls
        .filter((call) => call.url.pathname === "/library/sections/1/all")
        .map((call) => call.url.searchParams.get("X-Plex-Container-Start")),
    ).toEqual(["0", "500"]);
    const image = f.calls.find(
      (call) => call.url.pathname === "/photo/:/transcode",
    );
    expect(image?.url.searchParams.get("url")).toBe(
      "/library/metadata/1/thumb/1",
    );
    expect(image?.url.searchParams.get("width")).toBe("320");
    expect(image?.url.searchParams.get("height")).toBe("480");
    for (const call of f.calls) {
      expect(call.url.href).not.toContain("fixture-token");
      expect(new Headers(call.init?.headers).get("X-Plex-Token")).toBe(
        "fixture-token",
      );
      expect(call.init?.redirect).toBe("manual");
    }
  });

  test("uses the series poster and shares concurrent metadata and image requests", async () => {
    const f = fixture();
    await Promise.all([
      f.artwork.image("/media/tv/Show/episode-1.mkv"),
      f.artwork.image("/media/tv/Show/episode-2.mkv"),
    ]);
    expect(
      f.calls.filter((call) => call.url.pathname === "/library/sections"),
    ).toHaveLength(1);
    const images = f.calls.filter(
      (call) => call.url.pathname === "/photo/:/transcode",
    );
    expect(images).toHaveLength(1);
    expect(images[0]?.url.searchParams.get("url")).toBe(
      "/library/metadata/2/thumb/1",
    );
  });

  test("does not guess title matches for unknown files", async () => {
    const f = fixture();
    expect(await f.artwork.image("/videos/movie-0.mkv")).toBeNull();
    expect(
      await f.artwork.image("/media/movies/movie-0-other-edition.mkv"),
    ).toBeNull();
    expect(
      f.calls.some((call) => call.url.pathname === "/photo/:/transcode"),
    ).toBe(false);
  });

  test("refreshes chosen artwork after expiry and retries failed metadata", async () => {
    const f = fixture();
    f.fail(true);
    await expect(
      f.artwork.image("/media/movies/movie-0.mkv"),
    ).rejects.toBeInstanceOf(PlexArtworkUnavailableError);
    f.fail(false);
    await f.artwork.image("/media/movies/movie-0.mkv");
    f.refresh();
    await f.artwork.image("/media/movies/movie-0.mkv");
    expect(
      f.calls
        .filter((call) => call.url.pathname === "/photo/:/transcode")
        .map((call) => call.url.searchParams.get("url")),
    ).toEqual(["/library/metadata/1/thumb/1", "/library/metadata/1/thumb/2"]);
  });

  test("rejects HTML and oversized images as producer contract errors", async () => {
    const html = fixture();
    html.invalidImage(5, "text/html");
    await expect(
      html.artwork.image("/media/movies/movie-0.mkv"),
    ).rejects.toThrow("invalid poster response");
    const oversized = fixture();
    oversized.invalidImage(2 * 1024 * 1024 + 1, "image/jpeg");
    await expect(
      oversized.artwork.image("/media/movies/movie-0.mkv"),
    ).rejects.toThrow("image size limit");
  });

  test("refuses external metadata image targets without sending credentials", async () => {
    const fetcher = Object.assign(
      vi.fn((input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input);
        return Promise.resolve(
          Response.json(
            url.pathname === "/library/sections"
              ? {
                  MediaContainer: {
                    size: 1,
                    Directory: [{ key: "1", type: "movie" }],
                  },
                }
              : {
                  MediaContainer: {
                    size: 1,
                    totalSize: 1,
                    Metadata: [
                      {
                        thumb: "https://external.test/poster",
                        Media: [{ Part: [{ file: "/data/movies/movie.mkv" }] }],
                      },
                    ],
                  },
                },
          ),
        );
      }),
      { preconnect: fetch.preconnect },
    );
    const artwork = new PlexArtwork(
      { baseUrl: "http://plex.test", token: "fixture-token" },
      { fetch: fetcher },
    );
    await expect(artwork.image("/media/movies/movie.mkv")).rejects.toThrow(
      "unsupported poster path",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("bounds a stalled upstream request and leaves it retryable", async () => {
    const fetcher = Object.assign(
      (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          if (init?.signal === undefined || init.signal === null)
            throw new Error("Expected a deadline");
          init.signal.addEventListener(
            "abort",
            () => {
              reject(new Error("Fixture request deadline elapsed"));
            },
            { once: true },
          );
        }),
      { preconnect: fetch.preconnect },
    );
    const artwork = new PlexArtwork(
      { baseUrl: "http://plex.test", token: "fixture-token" },
      { fetch: fetcher },
    );
    await expect(
      artwork.image("/media/movies/movie.mkv"),
    ).rejects.toBeInstanceOf(PlexArtworkUnavailableError);
  }, 12_000);
});
