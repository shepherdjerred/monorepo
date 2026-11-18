import { describe, expect, test, vi } from "vitest";
import {
  PlexArtwork,
  PlexArtworkUnavailableError,
  type LibraryMetadataProvider,
} from "@shepherdjerred/streambot/metadata/plex.ts";
import {
  MAX_SUMMARY_CHARS,
  truncateSummary,
  type PlexItemMetadata,
} from "@shepherdjerred/streambot/metadata/plex-catalog.ts";

function createCatalogFixture() {
  let now = 1000;
  let unavailable = false;
  let invalidPayload = false;
  let movieYear = 2022;
  const calls: URL[] = [];
  const longSummary =
    "A young chef from the fine dining world comes home to Chicago to run his family sandwich shop. ".repeat(
      4,
    );

  const fetcher = Object.assign(
    vi.fn((input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      calls.push(url);
      if (unavailable) {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      if (url.pathname === "/library/sections") {
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
      }
      if (url.pathname === "/library/sections/1/all") {
        if (invalidPayload) {
          return Promise.resolve(
            Response.json({
              MediaContainer: {
                size: 1,
                totalSize: 1,
                Metadata: [{ year: "not-a-number" }],
              },
            }),
          );
        }
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: 2,
              totalSize: 2,
              Metadata: [
                {
                  type: "movie",
                  title: "Everything Everywhere All at Once",
                  year: movieYear,
                  duration: 8_340_000,
                  summary: "  Multiverse chaos at the IRS office.  ",
                  Genre: [
                    { tag: "Action" },
                    { tag: "Comedy" },
                    { tag: " comedy " },
                  ],
                  thumb: "/library/metadata/10/thumb/1",
                  Media: [
                    {
                      Part: [
                        { file: "/data/movies/EEAAO (2022)/EEAAO.mkv" },
                        {
                          file: "/data/movies/EEAAO (2022)/EEAAO-directors-cut.mkv",
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "movie",
                  title: "Silent Short",
                  year: 0,
                  duration: 0,
                  summary: "   ",
                  Media: [{ Part: [{ file: "/data/movies/Silent.mkv" }] }],
                },
              ],
            },
          }),
        );
      }
      if (url.pathname === "/library/sections/2/all") {
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: 2,
              totalSize: 2,
              Metadata: [
                {
                  type: "episode",
                  title: "System",
                  grandparentTitle: "The Bear",
                  parentIndex: 1,
                  index: 1,
                  year: 2022,
                  duration: 1_740_000,
                  summary: longSummary,
                  Genre: [{ tag: "Comedy" }, { tag: "Drama" }],
                  thumb: "/library/metadata/201/thumb/1",
                  grandparentThumb: "/library/metadata/200/thumb/1",
                  Media: [
                    {
                      Part: [
                        {
                          file: "/data/tv/The Bear/Season 01/The Bear - S01E01.mkv",
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "episode",
                  title: "Holiday Special",
                  grandparentTitle: "The Bear",
                  parentIndex: 0,
                  index: 1,
                  duration: 2_400_000,
                  grandparentThumb: "/library/metadata/200/thumb/1",
                  Media: [
                    {
                      Part: [
                        {
                          file: "/data/tv/The Bear/Specials/The Bear - S00E01.mkv",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
        );
      }
      if (url.pathname === "/photo/:/transcode") {
        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "image/jpeg" },
          }),
        );
      }
      throw new Error(`Unexpected endpoint: ${url.pathname}`);
    }),
    { preconnect: fetch.preconnect },
  );

  const plex = new PlexArtwork(
    { baseUrl: "http://plex.test", token: "secret-plex-token" },
    { fetch: fetcher, now: () => now },
  );

  return {
    plex,
    provider: plex satisfies LibraryMetadataProvider,
    calls,
    advanceMs: (delta: number) => {
      now += delta;
    },
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
    setInvalidPayload: (value: boolean) => {
      invalidPayload = value;
    },
    setMovieYear: (value: number) => {
      movieYear = value;
    },
  };
}

describe("Plex catalog metadata indexing", () => {
  test("indexes movie and episode genres, durationSeconds, year, season/episode, and bounded summaries", async () => {
    const f = createCatalogFixture();
    expect(
      f.plex.cachedMetadataForPath("/media/movies/EEAAO (2022)/EEAAO.mkv"),
    ).toBeNull();

    const movie: PlexItemMetadata | null = await f.provider.metadataForPath(
      "/media/movies/EEAAO (2022)/EEAAO.mkv",
    );
    expect(movie).toEqual({
      sectionType: "movie",
      type: "movie",
      title: "Everything Everywhere All at Once",
      year: 2022,
      durationSeconds: 8340,
      summary: "Multiverse chaos at the IRS office.",
      genres: ["Action", "Comedy"],
    });

    // Alternate media parts point to the same indexed item.
    expect(
      f.plex.cachedMetadataForPath(
        "/media/movies/EEAAO (2022)/EEAAO-directors-cut.mkv",
      ),
    ).toEqual(movie);

    // Zero/blank optional attributes stay omitted rather than fabricating defaults.
    expect(await f.plex.metadataForPath("/media/movies/Silent.mkv")).toEqual({
      sectionType: "movie",
      type: "movie",
      title: "Silent Short",
      genres: [],
    });

    const episode = await f.plex.metadataForPath(
      "/media/tv/The Bear/Season 01/The Bear - S01E01.mkv",
    );
    expect(episode).toMatchObject({
      sectionType: "show",
      type: "episode",
      title: "System",
      series: "The Bear",
      season: 1,
      episode: 1,
      year: 2022,
      durationSeconds: 1740,
      genres: ["Comedy", "Drama"],
    });
    expect(episode?.summary?.length).toBe(MAX_SUMMARY_CHARS);

    const special = await f.plex.metadataForPath(
      "/media/tv/The Bear/Specials/The Bear - S00E01.mkv",
    );
    expect(special).toMatchObject({
      sectionType: "show",
      series: "The Bear",
      season: 0,
      episode: 1,
      durationSeconds: 2400,
      genres: [],
    });

    expect(
      await f.plex.metadataForPath("/media/movies/Missing.mkv"),
    ).toBeNull();
  });

  test("shares one 5-minute TTL section scan across poster lookups and metadata queries", async () => {
    const f = createCatalogFixture();

    const [poster, episodeMeta] = await Promise.all([
      f.plex.image("/media/movies/EEAAO (2022)/EEAAO.mkv"),
      f.plex.metadataForPath(
        "/media/tv/The Bear/Season 01/The Bear - S01E01.mkv",
      ),
    ]);
    expect(poster).toMatchObject({ contentType: "image/jpeg" });
    expect(episodeMeta?.series).toBe("The Bear");

    // Follow-up metadata + ensureIndexed calls within TTL issue zero HTTP requests.
    const indexed = await f.plex.ensureIndexed();
    expect(indexed.size).toBe(5);
    expect(
      f.plex.cachedMetadataForPath(
        "/media/tv/The Bear/Season 01/The Bear - S01E01.mkv",
      )?.title,
    ).toBe("System");

    const sectionScans = () =>
      f.calls.filter((url) => url.pathname === "/library/sections").length;
    expect(sectionScans()).toBe(1);

    // Advance just under 5 minutes: still cached.
    f.setMovieYear(2023);
    f.advanceMs(5 * 60_000 - 1);
    const cachedBeforeExpiry = await f.plex.metadataForPath(
      "/media/movies/EEAAO (2022)/EEAAO.mkv",
    );
    expect(cachedBeforeExpiry?.year).toBe(2022);
    expect(sectionScans()).toBe(1);

    // Advance past 5 minutes: synchronous cache expires, next async lookup rescans once.
    f.advanceMs(2);
    expect(
      f.plex.cachedMetadataForPath("/media/movies/EEAAO (2022)/EEAAO.mkv"),
    ).toBeNull();
    const refreshedAfterExpiry = await f.plex.metadataForPath(
      "/media/movies/EEAAO (2022)/EEAAO.mkv",
    );
    expect(refreshedAfterExpiry?.year).toBe(2023);
    expect(sectionScans()).toBe(2);
  });

  test("degrades gracefully when Plex is unreachable while still failing loudly on malformed contracts", async () => {
    const f = createCatalogFixture();
    f.setUnavailable(true);

    expect(
      await f.plex.metadataForPath("/media/movies/EEAAO (2022)/EEAAO.mkv"),
    ).toBeNull();
    const unavailableMap = await f.plex.ensureIndexed();
    expect(unavailableMap.size).toBe(0);
    await expect(
      f.plex.image("/media/movies/EEAAO (2022)/EEAAO.mkv"),
    ).rejects.toBeInstanceOf(PlexArtworkUnavailableError);

    // Failed scans are not cached: recovery succeeds immediately on the next call.
    f.setUnavailable(false);
    const recovered = await f.plex.metadataForPath(
      "/media/movies/EEAAO (2022)/EEAAO.mkv",
    );
    expect(recovered?.title).toBe("Everything Everywhere All at Once");

    // Expire TTL and return invalid schema data: contract violations still throw loudly.
    f.advanceMs(5 * 60_000 + 1);
    f.setInvalidPayload(true);
    await expect(f.plex.ensureIndexed()).rejects.toThrow();
    await expect(
      f.plex.metadataForPath("/media/movies/EEAAO (2022)/EEAAO.mkv"),
    ).rejects.toThrow();
  });

  test("truncateSummary avoids splitting trailing UTF-16 surrogate pairs", () => {
    const prefix = "a".repeat(MAX_SUMMARY_CHARS - 1);
    const withEmojiAtBoundary = `${prefix}🎬extra`;
    const truncated = truncateSummary(withEmojiAtBoundary);
    expect(truncated).toBe(prefix);
    expect(truncated?.length).toBe(MAX_SUMMARY_CHARS - 1);
  });
});
