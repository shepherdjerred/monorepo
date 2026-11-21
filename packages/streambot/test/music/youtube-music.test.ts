import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import {
  musicProviderDroppedArtworkTotal,
  musicProviderDroppedItemsTotal,
  musicProviderRequestsTotal,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import { instrumentMusicSearch } from "@shepherdjerred/streambot/music/search-instrumentation.ts";
import { MusicSearchError } from "@shepherdjerred/streambot/music/search-provider.ts";
import { YouTubeMusicProvider } from "@shepherdjerred/streambot/music/youtube-music.ts";
import {
  ALBUM_ID,
  ALBUM_SEARCH,
  ARTIST_ID,
  ARTIST_SEARCH,
  CORRECTED_SEARCH,
  replayFetch,
  replayProvider,
  responses,
  creditAsPlainText,
  neverAnswers,
  shelfItems,
  SONG_SEARCH,
  stripVideoIds,
  SUGGEST,
  VIDEO_SEARCH,
  type ReplayCall,
} from "./youtube-music-fixture.ts";

const signal = () => new AbortController().signal;

async function metricValues(name: string) {
  const metrics = await register.getMetricsAsJSON();
  return metrics.find((candidate) => candidate.name === name)?.values ?? [];
}

async function dropped(operation: string): Promise<number> {
  const values = await metricValues(
    "streambot_music_provider_dropped_items_total",
  );
  return values
    .filter((value) => value.labels["operation"] === operation)
    .reduce((total, value) => total + value.value, 0);
}

beforeEach(() => {
  musicProviderDroppedItemsTotal.reset();
  musicProviderRequestsTotal.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("recorded YouTube Music responses", () => {
  test("songs become directly playable tracks with a music.youtube.com identity", async () => {
    const page = await replayProvider().search("song", "get lucky", signal());
    expect(page.correctedQuery).toBeUndefined();
    expect(page.items).toHaveLength(3);
    expect(page.items[0]).toMatchObject({
      kind: "song",
      track: {
        provider: "youtube-music",
        id: "4D7u5KF7SP8",
        title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
        artists: ["Daft Punk", "Pharrell Williams", "Nile Rodgers"],
        album: "Random Access Memories",
        durationSeconds: 370,
        canonicalUrl: "https://music.youtube.com/watch?v=4D7u5KF7SP8",
      },
    });
    expect(
      page.items.every(
        (item) =>
          item.kind === "song" &&
          new URL(item.track.artworkUrl ?? "").protocol === "https:",
      ),
    ).toBe(true);
  });

  test("videos, albums and artists keep their own shapes", async () => {
    const provider = replayProvider();
    const videos = await provider.search("video", "get lucky", signal());
    expect(videos.items[0]).toMatchObject({
      kind: "video",
      track: {
        id: "5NV6Rdv1a3I",
        artists: ["Daft Punk"],
        durationSeconds: 249,
      },
    });
    const albums = await provider.search("album", "daft punk", signal());
    expect(albums.items[0]).toMatchObject({
      kind: "album",
      id: ALBUM_ID,
      title: "Random Access Memories",
      artists: ["Daft Punk"],
      year: "2013",
    });
    const artists = await provider.search("artist", "daft punk", signal());
    expect(artists.items[0]).toMatchObject({
      kind: "artist",
      id: ARTIST_ID,
      name: "Daft Punk",
    });
  });

  test("a corrected query is reported and its leading section skipped", async () => {
    const page = await replayProvider().search(
      "song",
      "bohemian rapsody",
      signal(),
    );
    expect(page.correctedQuery).toBe("bohemian rhapsody");
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]).toMatchObject({
      kind: "song",
      track: { title: "Bohemian Rhapsody", artists: ["Queen"] },
    });
  });

  test("album tracks take their artists from the album header", async () => {
    const detail = await replayProvider().albumTracks(ALBUM_ID, signal());
    expect(detail.album).toMatchObject({
      id: ALBUM_ID,
      title: "Random Access Memories",
      artists: ["Daft Punk"],
      year: "2013",
    });
    expect(detail.tracks).toHaveLength(3);
    for (const track of detail.tracks) {
      expect(track.artists).toEqual(["Daft Punk"]);
      expect(track.durationSeconds).toBeGreaterThan(0);
    }
    expect(detail.tracks[0]?.title).toBe("Give Life Back to Music");
  });

  test("artist top songs carry no durations and albums come from the carousels", async () => {
    const detail = await replayProvider().artistTop(ARTIST_ID, signal());
    expect(detail.artist).toMatchObject({ id: ARTIST_ID, name: "Daft Punk" });
    expect(detail.songs.length).toBeGreaterThan(0);
    expect(
      detail.songs.every((song) => song.durationSeconds === undefined),
    ).toBe(true);
    expect(detail.albums.map((album) => album.title)).toContain(
      "Random Access Memories (Drumless Edition)",
    );
  });

  test("typeahead returns distinct suggestion strings", async () => {
    const result = await replayProvider().suggestions("get lu", signal());
    expect(result).toMatchObject({ kind: "suggestions" });
    if (result.kind !== "suggestions") return;
    expect(result.items).toContain("get lucky");
    expect(new Set(result.items).size).toBe(result.items.length);
  });
});

describe("artists the client cannot list", () => {
  test("a credit with no channel page is read from the item's second line", async () => {
    const data = responses();
    creditAsPlainText(data[SONG_SEARCH], 0, "Joyful Karaoke");
    const page = await replayProvider(data).search(
      "song",
      "get lucky",
      signal(),
    );
    expect(page.items[0]).toMatchObject({
      kind: "song",
      track: { artists: ["Joyful Karaoke"] },
    });
    expect(page.items).toHaveLength(3);
  });
});

describe("schema drift is contained", () => {
  test("a response full of unreadable nodes is empty, counted, and never logged", async () => {
    const data = responses();
    const items = shelfItems(data[SONG_SEARCH]);
    items.splice(0, items.length, ...items.map(() => ({ futureRenderer: 1 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      /* silenced */
    });
    const page = await replayProvider(data).search(
      "song",
      "get lucky",
      signal(),
    );
    expect(page.items).toEqual([]);
    expect(await dropped("parser")).toBeGreaterThanOrEqual(3);
    expect(warn).not.toHaveBeenCalled();
  });

  test("trailing nulls are filtered while real items survive", async () => {
    const data = responses();
    shelfItems(data[SONG_SEARCH]).push({ futureRenderer: {} });
    const page = await replayProvider(data).search(
      "song",
      "get lucky",
      signal(),
    );
    expect(page.items).toHaveLength(3);
    expect(await dropped("parser")).toBeGreaterThanOrEqual(1);
  });

  test("an item that fails strict validation is dropped and counted", async () => {
    const data = responses();
    stripVideoIds(data[SONG_SEARCH], [1]);
    const page = await replayProvider(data).search(
      "song",
      "get lucky",
      signal(),
    );
    expect(page.items).toHaveLength(2);
    expect(await dropped("search_song")).toBe(1);
  });

  test("a response in which nothing validates is a typed error, not an empty list", async () => {
    const data = responses();
    stripVideoIds(data[SONG_SEARCH]);
    const provider = instrumentMusicSearch(replayProvider(data));
    await expect(
      provider.search("song", "get lucky", signal()),
    ).rejects.toMatchObject({
      name: "MusicSearchError",
      failure: "invalid_response",
    });
    expect(await dropped("search_song")).toBe(3);
    const requests = await metricValues(
      "streambot_music_provider_requests_total",
    );
    expect(requests).toContainEqual(
      expect.objectContaining({
        labels: expect.objectContaining({
          provider: "youtube-music",
          operation: "search_song",
          outcome: "invalid",
        }),
        value: 1,
      }),
    );
  });

  test("a response the client cannot parse at all is a provider failure", async () => {
    const data = responses();
    data[ALBUM_SEARCH] = { contents: "unexpected" };
    await expect(
      replayProvider(data).search("album", "daft punk", signal()),
    ).rejects.toMatchObject({ name: "MusicSearchError" });
  });
});

describe("calls", () => {
  test("identical normalized queries are served from the cache", async () => {
    const calls: ReplayCall[] = [];
    const provider = replayProvider(responses(), calls);
    await provider.search("song", "get lucky", signal());
    await provider.search("song", "  Get   LUCKY ", signal());
    expect(calls.filter((call) => call.key === SONG_SEARCH)).toHaveLength(1);
    await provider.search("video", "get lucky", signal());
    expect(calls.map((call) => call.key)).toContain(VIDEO_SEARCH);
  });

  test("a malformed browse id is refused before any request", async () => {
    const calls: ReplayCall[] = [];
    const provider = replayProvider(responses(), calls);
    await expect(
      provider.albumTracks("../../x", signal()),
    ).rejects.toBeInstanceOf(MusicError);
    await expect(
      provider.artistTop("e9eafc07-7bb7-4e77-9814-4d139a94889d", signal()),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(calls).toEqual([]);
  });

  test("a call that outlives its deadline is a timeout", async () => {
    const provider = new YouTubeMusicProvider({
      session: "local",
      deadlines: { search: 30 },
      fetch: neverAnswers,
    });
    await expect(
      provider.search("song", "get lucky", signal()),
    ).rejects.toMatchObject({ name: "MusicSearchError", failure: "timeout" });
  });

  test("an upstream failure is unavailable and does not poison later calls", async () => {
    let failing = true;
    const good = replayFetch(responses());
    const provider = new YouTubeMusicProvider({
      session: "local",
      fetch: (input, init) =>
        failing
          ? Promise.resolve(new Response("{}", { status: 500 }))
          : good(input, init),
    });
    await expect(
      provider.search("song", "get lucky", signal()),
    ).rejects.toMatchObject({ failure: "unavailable" });
    failing = false;
    const recovered = await provider.search("song", "get lucky", signal());
    expect(recovered.items).toHaveLength(3);
  });

  test("a caller that leaves is aborted, not reported as a provider failure", async () => {
    const controller = new AbortController();
    const provider = new YouTubeMusicProvider({
      session: "local",
      fetch: neverAnswers,
    });
    const pending = provider.search("song", "get lucky", controller.signal);
    controller.abort();
    await expect(pending).rejects.not.toBeInstanceOf(MusicSearchError);
    expect(controller.signal.aborted).toBe(true);
  });

  test("concurrent upstream calls are bounded", async () => {
    let inFlight = 0;
    let peak = 0;
    const answer = responses()[SONG_SEARCH];
    const provider = new YouTubeMusicProvider({
      session: "local",
      fetch: async (input) => {
        if (!requestUrl(input).includes("/search"))
          return Response.json(answer);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return Response.json(answer);
      },
    });
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        provider.search("song", "query " + String(index), signal()),
      ),
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  test("the query never reaches an error message or a console line", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    const data = responses();
    data[CORRECTED_SEARCH] = { contents: 1 };
    const failure = await replayProvider(data)
      .search("song", "bohemian rapsody", signal())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MusicSearchError);
    expect(failure instanceof Error ? failure.message : "").not.toContain(
      "bohemian",
    );
    expect(lines.join("\n")).not.toContain("bohemian");
    expect(ARTIST_SEARCH).toContain("daft punk");
    expect(SUGGEST).toContain("get lu");
  });
});

function requestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : input.toString();
}

async function outcomeOf(pending: Promise<unknown>): Promise<string> {
  try {
    await pending;
    return "ok";
  } catch (error) {
    return error instanceof MusicSearchError ? error.failure : "other";
  }
}

function rehosted(from: string[]): ReturnType<typeof responses> {
  let text = JSON.stringify(responses());
  for (const host of from)
    text = text.replaceAll(host, "images.example.invalid");
  return JSON.parse(text);
}

async function droppedArtwork(): Promise<number> {
  const values = await metricValues(
    "streambot_music_provider_dropped_artwork_total",
  );
  return values.reduce((total, value) => total + value.value, 0);
}

describe("artwork is validated apart from the item", () => {
  test("an item whose thumbnail host is not allowed keeps everything but the artwork", async () => {
    musicProviderDroppedArtworkTotal.reset();
    const data = responses();
    const raw = JSON.stringify(data[SONG_SEARCH]);
    const first = raw.indexOf("yt3.googleusercontent.com");
    data[SONG_SEARCH] = JSON.parse(
      raw.slice(0, first) +
        "images.example.invalid" +
        raw.slice(first + "yt3.googleusercontent.com".length),
    );
    const page = await replayProvider(data).search(
      "song",
      "get lucky",
      signal(),
    );
    expect(page.items).toHaveLength(3);
    expect(page.items[0]).toMatchObject({
      kind: "song",
      track: { id: "4D7u5KF7SP8", title: expect.any(String) },
    });
    if (page.items[0]?.kind === "song")
      expect(page.items[0].track.artworkUrl).toBeUndefined();
    expect(await droppedArtwork()).toBe(1);
    expect(await dropped("search_song")).toBe(0);
  });

  test("a response where every thumbnail is disallowed still returns all items", async () => {
    musicProviderDroppedArtworkTotal.reset();
    const data = rehosted([
      "yt3.googleusercontent.com",
      "lh3.googleusercontent.com",
      "i.ytimg.com",
      "yt3.ggpht.com",
    ]);
    const provider = replayProvider(data);
    const songs = await provider.search("song", "get lucky", signal());
    const albums = await provider.search("album", "daft punk", signal());
    const artists = await provider.search("artist", "daft punk", signal());
    expect([
      songs.items.length,
      albums.items.length,
      artists.items.length,
    ]).toEqual([3, 3, 3]);
    const detail = await provider.albumTracks(ALBUM_ID, signal());
    expect(detail.tracks).toHaveLength(3);
    expect(detail.album.artworkUrl).toBeUndefined();
    expect(await droppedArtwork()).toBeGreaterThanOrEqual(9);
    expect(await dropped("search_song")).toBe(0);
  });
});

describe("upstream protection inside the adapter", () => {
  test("identical concurrent requests share one upstream call", async () => {
    let calls = 0;
    const answer = responses()[SONG_SEARCH];
    const provider = new YouTubeMusicProvider({
      session: "local",
      fetch: async (input) => {
        if (!requestUrl(input).includes("/search"))
          return Response.json(answer);
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return Response.json(answer);
      },
    });
    const pages = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        provider.search(
          "song",
          index % 2 === 0 ? "Get Lucky" : " get  lucky",
          signal(),
        ),
      ),
    );
    expect(calls).toBe(1);
    expect(pages.every((page) => page.items.length === 3)).toBe(true);
  });

  test("one caller leaving does not cancel the shared call", async () => {
    const answer = responses()[SONG_SEARCH];
    const provider = new YouTubeMusicProvider({
      session: "local",
      fetch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return Response.json(answer);
      },
    });
    const leaver = new AbortController();
    const leaving = provider.search("song", "get lucky", leaver.signal);
    const staying = provider.search("song", "get lucky", signal());
    leaver.abort();
    await expect(leaving).rejects.not.toBeInstanceOf(MusicSearchError);
    const page = await staying;
    expect(page.items).toHaveLength(3);
  });

  test("callers queue behind the cap and are refused past the bounded queue", async () => {
    let inFlight = 0;
    let peak = 0;
    const release = Promise.withResolvers<undefined>();
    const answer = responses()[SONG_SEARCH];
    const provider = new YouTubeMusicProvider({
      session: "local",
      deadlines: { search: 10_000 },
      fetch: async (input) => {
        if (!requestUrl(input).includes("/search"))
          return Response.json(answer);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await release.promise;
        inFlight -= 1;
        return Response.json(answer);
      },
    });
    // 4 run, 16 wait, so the 21st and 22nd distinct requests are refused.
    const calls = Array.from({ length: 22 }, (_, index) =>
      outcomeOf(provider.search("song", "query " + String(index), signal())),
    );
    await vi.waitFor(() => expect(inFlight).toBe(4));
    release.resolve(undefined);
    const outcomes = await Promise.all(calls);
    expect(peak).toBe(4);
    expect(outcomes.filter((outcome) => outcome === "ok")).toHaveLength(20);
    expect(
      outcomes.filter((outcome) => outcome === "unavailable"),
    ).toHaveLength(2);
  });
});
